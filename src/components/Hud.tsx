import { Flower2, Gem, Keyboard, QrCode, RotateCcw, Smartphone, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { formatTime } from '../lib/api';
import type { LinkStatus } from '../net/room';

export interface HudState {
  motes: number;
  total: number;
  blooms: number;
  bloomTotal: number;
  falls: number;
}

interface Props {
  game: Game | null;
  hud: HudState;
  hint: string | null;
  status: LinkStatus;
  code: string | null;
  soundOn: boolean;
  onToggleSound: () => void;
  onRestart: () => void;
  onShowPair: () => void;
}

const STATUS_TEXT: Record<LinkStatus, string> = {
  connecting: 'Opening room…',
  waiting: 'Waiting for phone',
  relay: 'Phone · relay',
  direct: 'Phone · direct link',
  error: 'Room offline',
};

export default function Hud({ game, hud, hint, status, code, soundOn, onToggleSound, onRestart, onShowPair }: Props) {
  const timeRef = useRef<HTMLSpanElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const [usingKeys, setUsingKeys] = useState(false);
  const [pulse, setPulse] = useState(0);

  // Timer and tilt widget update straight from the game each frame — no React re-renders.
  useEffect(() => {
    if (!game) return;
    let raf = 0;
    let lastKeys = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (timeRef.current) timeRef.current.textContent = formatTime(game.timeMs);
      if (phoneRef.current) {
        const { roll, pitch } = game.input;
        phoneRef.current.style.transform = `perspective(220px) rotateX(${(52 + pitch * 1.1).toFixed(1)}deg) rotateY(${(roll * 1.3).toFixed(1)}deg)`;
      }
      const keys = game.input.source === 'keys';
      if (keys !== lastKeys) {
        lastKeys = keys;
        setUsingKeys(keys);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  // Re-trigger the pop animation whenever the mote count changes.
  useEffect(() => {
    if (hud.motes > 0) setPulse((p) => p + 1);
  }, [hud.motes]);

  const linked = status === 'relay' || status === 'direct';
  const chip = 'glass flex items-center gap-2 rounded-full px-4 py-2 text-ink';
  const iconBtn =
    'glass flex h-10 w-10 items-center justify-center rounded-full text-ink transition-transform hover:scale-105 active:scale-95 focus-visible:outline-4 focus-visible:outline-ink';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        {/* Collectibles */}
        <div className="flex flex-col gap-2">
          <div className={chip} aria-label={`${hud.motes} of ${hud.total} sunmotes`}>
            <Gem size={18} className="text-[#e59a00]" fill="#ffc94d" />
            <span key={pulse} className="animate-pop tabular font-display text-xl font-bold leading-none">
              {hud.motes}
            </span>
            <span className="tabular text-sm text-ink/55">/ {hud.total}</span>
          </div>
          <div className={`${chip} w-fit`} aria-label={`${hud.blooms} of ${hud.bloomTotal} skyblooms`}>
            {Array.from({ length: hud.bloomTotal }, (_, i) => (
              <Flower2
                key={i}
                size={18}
                className={i < hud.blooms ? 'animate-pop text-[#e0559a]' : 'text-ink/25'}
                fill={i < hud.blooms ? '#ffd3e6' : 'none'}
              />
            ))}
          </div>
        </div>

        {/* Timer */}
        <div className="glass rounded-full px-5 py-2 text-ink">
          <span ref={timeRef} className="tabular font-display text-2xl font-bold leading-none">
            0:00.00
          </span>
        </div>

        {/* Connection + controls */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button className={iconBtn} onClick={onToggleSound} aria-label={soundOn ? 'Mute sound' : 'Turn sound on'} title={soundOn ? 'Mute' : 'Sound on'}>
              {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button className={iconBtn} onClick={onRestart} aria-label="Restart run" title="Restart run (R)">
              <RotateCcw size={18} />
            </button>
            <button className={iconBtn} onClick={onShowPair} aria-label="Show pairing code" title="Pair a phone">
              <QrCode size={18} />
            </button>
          </div>
          <div className={`${chip} text-sm font-semibold`}>
            {usingKeys ? <Keyboard size={16} /> : <Smartphone size={16} />}
            <span className={`h-2 w-2 rounded-full ${usingKeys ? 'bg-violet' : status === 'direct' ? 'bg-leaf' : linked ? 'bg-sun' : 'bg-coral'}`} />
            <span>{usingKeys ? 'Keyboard' : STATUS_TEXT[status]}</span>
            {code && <span className="tabular rounded-full bg-ink px-2 py-0.5 text-xs tracking-widest text-cream">{code}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        {/* Live phone tilt — proof that the link is real. */}
        <div className="glass flex h-20 w-20 items-center justify-center rounded-3xl" aria-hidden>
          <div ref={phoneRef} className="h-12 w-7 rounded-md border-2 border-ink bg-ink/85 shadow-lg" style={{ transformStyle: 'preserve-3d' }}>
            <div className="mx-auto mt-1 h-1 w-2 rounded-full bg-cream/60" />
          </div>
        </div>

        <div className="flex-1 text-center" aria-live="polite">
          {hint && (
            <p key={hint} className="glass animate-rise mx-auto inline-block max-w-md rounded-2xl px-5 py-2.5 font-display text-lg italic text-ink">
              {hint}
            </p>
          )}
        </div>

        <div className="glass hidden rounded-2xl px-3 py-2 text-xs leading-relaxed text-ink/75 sm:block">
          <p><b className="text-ink">WASD / arrows</b> move</p>
          <p><b className="text-ink">Space</b> jump · again mid-air to dash</p>
          <p><b className="text-ink">R</b> restart</p>
        </div>
      </div>
    </div>
  );
}
