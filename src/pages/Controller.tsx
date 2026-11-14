import { Crosshair, RotateCcw, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import JoinScreen from '../components/JoinScreen';
import { MotionPipeline, requestMotionPermission } from '../controller/sensors';
import type { ControlMode, InputFrame, Msg, ViewerState } from '../net/protocol';
import { RoomLink, type LinkStatus } from '../net/room';

type Sensor = 'idle' | 'ok' | 'denied' | 'unsupported';

const MODES: { id: ControlMode; label: string; blurb: string }[] = [
  { id: 'flick', label: 'Tilt + Flick', blurb: 'Tilt to walk. Flick the phone up to jump — flick again mid-air to spin-dash.' },
  { id: 'tap', label: 'Tilt + Tap', blurb: 'Tilt to walk. Tap the pad to jump — hold longer to jump higher.' },
  { id: 'stick', label: 'Thumbstick', blurb: 'Drag the stick to walk, tap the pad to jump. No motion needed.' },
];
const SENS = [
  { label: 'Gentle', deg: 30 },
  { label: 'Balanced', deg: 22 },
  { label: 'Snappy', deg: 15 },
];
const FLICK = [
  { label: 'Light', thr: 8 },
  { label: 'Medium', thr: 12 },
  { label: 'Firm', thr: 17 },
];
const STATUS: Record<LinkStatus, { text: string; dot: string }> = {
  connecting: { text: 'Connecting', dot: 'bg-sun animate-pulse' },
  waiting: { text: 'Waiting for screen', dot: 'bg-sun animate-pulse' },
  relay: { text: 'Linked · relay', dot: 'bg-sun' },
  direct: { text: 'Linked · direct', dot: 'bg-leaf' },
  error: { text: 'Connection lost', dot: 'bg-coral' },
};
const SETTINGS_KEY = 'tilt-isles-pad';
const vibrate = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* unsupported (iOS) */
  }
};
const loadSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as { sens?: number; flick?: number; invert?: boolean };
  } catch {
    return {};
  }
};

export default function Controller() {
  const [params, setParams] = useSearchParams();
  const [room, setRoom] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sensor, setSensor] = useState<Sensor>('idle');
  const [asking, setAsking] = useState(false);
  const [mode, setMode] = useState<ControlMode>('flick');
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [ping, setPing] = useState<number | null>(null);
  const [world, setWorld] = useState<ViewerState | null>(null);
  const [sheet, setSheet] = useState(false);
  const saved = useRef(loadSettings()).current;
  const [sens, setSens] = useState(saved.sens ?? 1);
  const [flick, setFlick] = useState(saved.flick ?? 1);
  const [invert, setInvert] = useState(saved.invert ?? false);
  const [calibrated, setCalibrated] = useState(0);

  const pipeline = useRef(new MotionPipeline()).current;
  const linkRef = useRef<RoomLink | null>(null);
  const live = useRef({ mode: 'flick' as ControlMode, invert: false, seq: 0, jumps: 0, held: false, sx: 0, sy: 0 });
  const orbRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  // Keep the hot-path refs in step with UI state.
  useEffect(() => {
    live.current.mode = mode;
    live.current.invert = invert;
    pipeline.flickEnabled = mode === 'flick';
    pipeline.maxTilt = SENS[sens].deg;
    pipeline.flickThreshold = FLICK[flick].thr;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sens, flick, invert }));
  }, [mode, sens, flick, invert, pipeline]);

  const sendFrame = useCallback(() => {
    const L = live.current;
    const s = pipeline.sample;
    const stick = L.mode === 'stick';
    const frame: InputFrame = {
      k: 'in',
      n: L.seq++,
      x: +(stick ? L.sx : s.x).toFixed(3),
      y: +(stick ? L.sy : s.y * (L.invert ? -1 : 1)).toFixed(3),
      r: +s.roll.toFixed(1),
      p: +s.pitch.toFixed(1),
      a: +s.accel.toFixed(1),
      j: L.jumps,
      h: L.held || (L.mode === 'flick' && pipeline.flickHeld) ? 1 : 0,
      m: L.mode,
      rb: +s.rawBeta.toFixed(1),
      rg: +s.rawGamma.toFixed(1),
    };
    linkRef.current?.send(frame);
  }, [pipeline]);

  const fireJump = useCallback(() => {
    live.current.jumps++;
    sendFrame(); // don't wait for the next tick
    vibrate(8);
  }, [sendFrame]);

  // ── Room link (opened as soon as the code is validated).
  useEffect(() => {
    if (!room) return;
    const link = new RoomLink(room, 'controller', {
      onStatus: setStatus,
      onMessage: (m: Msg) => {
        if (m.k === 'pong') setPing(Math.round(performance.now() - m.t));
        else if (m.k === 'fx') vibrate(m.v);
        else if (m.k === 'state') setWorld(m);
      },
    });
    linkRef.current = link;
    const pinger = window.setInterval(() => link.send({ k: 'ping', t: performance.now() }), 2000);
    return () => {
      window.clearInterval(pinger);
      link.close();
      linkRef.current = null;
    };
  }, [room]);

  // ── Send loop (~30 Hz) + UI loop + wake lock, only while playing.
  useEffect(() => {
    if (!playing) return;
    pipeline.onFlick = () => {
      if (live.current.mode === 'flick') fireJump();
    };
    const sender = window.setInterval(sendFrame, 33);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const L = live.current;
      const s = pipeline.sample;
      const stick = L.mode === 'stick';
      const x = stick ? L.sx : s.x;
      const y = stick ? L.sy : s.y;
      const r = (orbRef.current?.clientWidth ?? 240) * 0.36;
      if (dotRef.current) dotRef.current.style.transform = `translate(${(x * r).toFixed(1)}px, ${(-y * r).toFixed(1)}px)`;
      if (plateRef.current) {
        const rx = stick ? y * 14 : Math.max(-32, Math.min(32, s.pitch));
        const ry = stick ? x * 14 : Math.max(-32, Math.min(32, s.roll));
        plateRef.current.style.transform = `perspective(700px) rotateX(${rx.toFixed(1)}deg) rotateY(${ry.toFixed(1)}deg)`;
      }
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${Math.min(1, s.accel / (pipeline.flickThreshold * 1.6)).toFixed(3)})`;
    };
    raf = requestAnimationFrame(draw);

    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      window.clearInterval(sender);
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
      pipeline.onFlick = null;
    };
  }, [playing, pipeline, sendFrame, fireJump]);

  useEffect(() => () => pipeline.stop(), [pipeline]);

  /** Must run inside a tap: iOS only shows the motion prompt from a user gesture. */
  const enableMotion = async () => {
    setAsking(true);
    const result = await requestMotionPermission();
    setAsking(false);
    if (result !== 'granted') {
      setSensor(result);
      setMode('stick');
      setPlaying(true);
      return;
    }
    pipeline.start();
    pipeline.calibrate();
    setSensor('ok');
    setMode((m) => (m === 'stick' ? 'flick' : m));
    setPlaying(true);
    if (window.matchMedia('(pointer: coarse)').matches) {
      // Best effort: stop the screen rotating while tilting.
      document.documentElement
        .requestFullscreen?.()
        .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('portrait'))
        .catch(() => undefined);
    }
    // Some browsers "grant" but never deliver events (desktop, old Android).
    window.setTimeout(() => {
      if (!pipeline.alive) {
        setSensor('unsupported');
        setMode('stick');
      }
    }, 1800);
  };

  const pickMode = (m: ControlMode) => {
    if (m !== 'stick' && sensor !== 'ok') {
      void enableMotion();
      return;
    }
    setMode(m);
    vibrate(6);
  };

  const calibrate = () => {
    pipeline.calibrate();
    setCalibrated((n) => n + 1);
    vibrate(15);
  };

  // ── Thumbstick + jump pad pointer handling.
  const stickMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (live.current.mode !== 'stick' || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const r = rect.width * 0.36;
    let x = (e.clientX - (rect.left + rect.width / 2)) / r;
    let y = -(e.clientY - (rect.top + rect.height / 2)) / r;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    live.current.sx = x;
    live.current.sy = y;
  };
  const stickDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (live.current.mode !== 'stick') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stickMove(e);
  };
  const stickUp = () => {
    live.current.sx = 0;
    live.current.sy = 0;
  };
  const padDown = (e: RPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current.held = true;
    fireJump();
  };
  const padUp = () => {
    live.current.held = false;
    sendFrame();
  };

  if (!room || !playing) {
    return (
      <JoinScreen
        initialCode={params.get('room')}
        room={room}
        onJoined={(c) => {
          setRoom(c);
          setParams({ room: c }, { replace: true });
        }}
        asking={asking}
        onEnableMotion={enableMotion}
        onUseStick={() => {
          setMode('stick');
          setPlaying(true);
        }}
        statusText={STATUS[status].text}
      />
    );
  }

  const st = STATUS[status];
  const seg = (on: boolean) =>
    `flex-1 rounded-xl px-2 py-2.5 text-sm font-semibold transition-colors ${on ? 'bg-cream text-ink' : 'text-cream/75 active:bg-cream/10'}`;
  const pill = (on: boolean) => `flex-1 rounded-xl py-2.5 text-sm font-semibold ${on ? 'bg-teal text-ink' : 'bg-cream/10 text-cream'}`;

  return (
    <div className="pad-backdrop no-select fixed inset-0 flex touch-none flex-col gap-3 overflow-hidden p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-cream">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 rounded-full bg-cream/10 px-3 py-2 text-sm font-semibold" role="status">
          <span className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />
          {st.text}
          {ping !== null && (status === 'relay' || status === 'direct') && <span className="tabular text-cream/60">{ping} ms</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular rounded-full bg-cream px-3 py-2 font-display text-sm font-black tracking-[0.2em] text-ink">{room}</span>
          <button onClick={() => setSheet(true)} aria-label="Controller settings" className="flex h-10 w-10 items-center justify-center rounded-full bg-cream/10 active:bg-cream/20">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <div className="flex gap-1 rounded-2xl bg-cream/10 p-1" role="tablist" aria-label="Control mode">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => pickMode(m.id)} className={seg(mode === m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="min-h-[2.5rem] text-center text-sm leading-snug text-cream/70">
        {sensor === 'denied' && mode === 'stick'
          ? 'Motion access was declined, so you’re on the thumbstick. To use tilt, allow Motion & Orientation for this site and tap a tilt mode.'
          : sensor === 'unsupported' && mode === 'stick'
            ? 'No motion sensors detected on this device — the thumbstick works everywhere.'
            : MODES.find((m) => m.id === mode)?.blurb}
      </p>

      {/* Tilt visualiser / thumbstick */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          ref={orbRef}
          onPointerDown={stickDown}
          onPointerMove={stickMove}
          onPointerUp={stickUp}
          onPointerCancel={stickUp}
          className="relative aspect-square h-full max-h-[min(100%,78vw)]"
          aria-label={mode === 'stick' ? 'Thumbstick' : 'Tilt indicator'}
        >
          <div ref={plateRef} className="absolute inset-0 rounded-full border border-cream/15 bg-gradient-to-br from-cream/15 to-cream/0 shadow-[inset_0_0_60px_rgba(31,191,174,0.25)] will-change-transform">
            <div className="absolute inset-[14%] rounded-full border border-dashed border-cream/20" />
            <div className="absolute inset-[32%] rounded-full border border-cream/15" />
            <div className="absolute left-1/2 top-[6%] h-[88%] w-px -translate-x-1/2 bg-cream/10" />
            <div className="absolute left-[6%] top-1/2 h-px w-[88%] -translate-y-1/2 bg-cream/10" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div ref={dotRef} className="h-[22%] w-[22%] rounded-full bg-gradient-to-br from-sun to-coral shadow-[0_0_40px_rgba(255,201,77,0.65)] will-change-transform" />
            </div>
          </div>
          {calibrated > 0 && <div key={calibrated} className="pointer-events-none absolute inset-0 animate-[pop_0.5s_ease-out_reverse_both] rounded-full border-4 border-teal" />}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <button onClick={calibrate} disabled={mode === 'stick'} className="inline-flex items-center gap-2 rounded-full bg-cream/10 px-4 py-2.5 font-semibold active:bg-cream/20 disabled:opacity-35">
          <Crosshair size={16} /> Recalibrate
        </button>
        {world && (
          <span className="tabular rounded-full bg-cream/10 px-4 py-2.5 font-semibold" aria-label="Progress">
            ◆ {world.motes}/{world.total} · ✿ {world.blooms}/{world.bloomTotal}
          </span>
        )}
      </div>

      {/* Jump pad — in flick mode it doubles as a fallback and shows flick energy. */}
      <button
        onPointerDown={padDown}
        onPointerUp={padUp}
        onPointerCancel={padUp}
        className="relative mb-2.5 h-[24%] min-h-24 shrink-0 overflow-hidden rounded-[2rem] bg-coral text-ink shadow-[0_10px_0_#b83a2b] transition-transform active:translate-y-2 active:shadow-[0_2px_0_#b83a2b]"
      >
        {mode === 'flick' && <div ref={meterRef} className="absolute inset-0 origin-left bg-sun/70 will-change-transform" style={{ transform: 'scaleX(0)' }} />}
        <span className="relative block font-display text-4xl font-black italic">{mode === 'flick' ? 'Flick!' : 'Jump'}</span>
        <span className="relative block text-sm font-semibold opacity-80">{mode === 'flick' ? 'or tap here · again mid-air to dash' : 'hold for height · again mid-air to dash'}</span>
      </button>

      {sheet && (
        <div className="absolute inset-0 z-20 flex items-end bg-deep/70" onClick={() => setSheet(false)}>
          <div role="dialog" aria-label="Controller settings" className="animate-rise w-full touch-auto space-y-4 rounded-t-[2rem] bg-ink-soft p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold">Tune the feel</h2>
              <button onClick={() => setSheet(false)} aria-label="Close settings" className="flex h-10 w-10 items-center justify-center rounded-full bg-cream/10"><X size={18} /></button>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-cream/70">Tilt sensitivity</legend>
              <div className="flex gap-2">{SENS.map((s, i) => <button key={s.label} aria-pressed={sens === i} onClick={() => setSens(i)} className={pill(sens === i)}>{s.label}</button>)}</div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-cream/70">Flick strength needed</legend>
              <div className="flex gap-2">{FLICK.map((s, i) => <button key={s.label} aria-pressed={flick === i} onClick={() => setFlick(i)} className={pill(flick === i)}>{s.label}</button>)}</div>
            </fieldset>
            <button aria-pressed={invert} onClick={() => setInvert((v) => !v)} className="flex w-full items-center justify-between rounded-xl bg-cream/10 px-4 py-3 text-sm font-semibold">
              Invert forward / back <span className={`rounded-full px-2.5 py-0.5 ${invert ? 'bg-teal text-ink' : 'bg-cream/15'}`}>{invert ? 'On' : 'Off'}</span>
            </button>
            <button
              onClick={() => {
                linkRef.current?.send({ k: 'cmd', c: 'restart' }, true);
                setSheet(false);
                vibrate(20);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cream py-3 font-semibold text-ink"
            >
              <RotateCcw size={16} /> Restart the run
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
