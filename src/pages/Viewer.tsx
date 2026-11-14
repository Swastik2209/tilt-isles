import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import FinishPanel from '../components/FinishPanel';
import Hud, { type HudState } from '../components/Hud';
import Lobby from '../components/Lobby';
import { Game, type FinishStats, type GameEvent, type Phase } from '../game/Game';
import { api } from '../lib/api';
import { useBoard } from '../lib/useBoard';
import type { Msg } from '../net/protocol';
import { RoomLink, type LinkStatus } from '../net/room';

const ROOM_KEY = 'tilt-isles-room';

/**
 * Desktop side: hosts the 3D game, opens a room, and feeds the phone's input
 * stream into the game. React only renders the overlays; the game runs itself.
 */
export default function Viewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const linkRef = useRef<RoomLink | null>(null);
  const hudRef = useRef<HudState>({ motes: 0, total: 0, blooms: 0, bloomTotal: 3, falls: 0 });
  const phaseRef = useRef<Phase>('attract');

  const [game, setGame] = useState<Game | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomAttempt, setRoomAttempt] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [phase, setPhase] = useState<Phase>('attract');
  const [hud, setHud] = useState<HudState>(hudRef.current);
  const [hint, setHint] = useState<string | null>(null);
  const [finish, setFinish] = useState<FinishStats | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [showPair, setShowPair] = useState(false);
  const [flash, setFlash] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const board = useBoard(25);

  const joinUrl = code ? `${window.location.origin}/controller?room=${code}` : null;

  /** Tell the phone what's happening so it can mirror progress. */
  const sendState = useCallback(() => {
    const h = hudRef.current;
    linkRef.current?.send(
      { k: 'state', phase: phaseRef.current, motes: h.motes, total: h.total, blooms: h.blooms, bloomTotal: h.bloomTotal },
      true,
    );
  }, []);

  // ── Game lifecycle.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onEvent = (e: GameEvent) => {
      switch (e.type) {
        case 'hud':
          hudRef.current = { motes: e.motes, total: e.total, blooms: e.blooms, bloomTotal: e.bloomTotal, falls: e.falls };
          setHud(hudRef.current);
          sendState();
          break;
        case 'hint':
          setHint(e.text);
          break;
        case 'phase':
          phaseRef.current = e.phase;
          setPhase(e.phase);
          sendState();
          break;
        case 'respawn':
          setFlash((f) => f + 1);
          break;
        case 'finish':
          setFinish(e.stats);
          break;
        case 'haptic':
          linkRef.current?.send({ k: 'fx', v: e.pattern });
          break;
      }
    };
    let g: Game;
    try {
      g = new Game(mount, onEvent);
    } catch (err) {
      console.error(err);
      setGlError('This browser could not start WebGL, which the game needs. Try a recent Chrome, Edge, Firefox or Safari.');
      return;
    }
    gameRef.current = g;
    // Debug handle for poking at the game from the console.
    (window as unknown as { __tiltIsles?: Game }).__tiltIsles = g;
    setGame(g);
    return () => {
      g.dispose();
      gameRef.current = null;
      setGame(null);
    };
  }, [sendState]);

  // ── Room: reuse this tab's room across reloads, otherwise create one.
  useEffect(() => {
    let alive = true;
    setRoomError(null);
    (async () => {
      try {
        let c: string | null = sessionStorage.getItem(ROOM_KEY);
        if (c) {
          try {
            await api.touchRoom(c);
          } catch {
            c = null;
          }
        }
        if (!c) {
          c = (await api.createRoom()).code;
          sessionStorage.setItem(ROOM_KEY, c);
        }
        if (alive) setCode(c);
      } catch (err) {
        if (alive) setRoomError(err instanceof Error ? err.message : 'The room service did not respond.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomAttempt]);

  useEffect(() => {
    if (!joinUrl) return;
    let alive = true;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 440, color: { dark: '#10222e', light: '#fff6e6' } })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [joinUrl]);

  // ── Realtime link to the phone.
  useEffect(() => {
    if (!code) return;
    const link = new RoomLink(code, 'viewer', {
      onStatus: setStatus,
      onMessage: (m: Msg) => {
        const g = gameRef.current;
        if (!g) return;
        if (m.k === 'in') g.input.setRemote(m);
        else if (m.k === 'ping') link.send({ k: 'pong', t: m.t });
        else if (m.k === 'hello') {
          g.input.resetRemote();
          sendState();
        } else if (m.k === 'cmd' && m.c === 'restart') restartRef.current();
      },
    });
    linkRef.current = link;
    return () => {
      link.close();
      linkRef.current = null;
      setStatus('connecting');
    };
  }, [code, sendState]);

  const linked = status === 'relay' || status === 'direct';

  // Phone joined → slide out of the lobby. Phone lost mid-run → say so.
  const wasLinked = useRef(false);
  useEffect(() => {
    if (linked && phase === 'attract') {
      const id = window.setTimeout(() => gameRef.current?.begin(), 1100);
      return () => window.clearTimeout(id);
    }
    if (linked) {
      setShowPair(false);
      setNotice(null);
    } else if (wasLinked.current && phase === 'play') {
      setNotice('Phone disconnected — reopen the controller to rejoin, or carry on with the keyboard.');
    }
    wasLinked.current = linked;
  }, [linked, phase]);

  const restart = useCallback(() => {
    setFinish(null);
    setShowFinish(false);
    setHint(null);
    gameRef.current?.restart();
  }, []);
  const restartRef = useRef(restart);
  restartRef.current = restart;

  // ── Page-level keys + audio unlock (browsers need a gesture on THIS page).
  useEffect(() => {
    const unlock = () => {
      const g = gameRef.current;
      if (!g) return;
      g.sfx.unlock();
      if (!g.sfx.muted) setSoundOn(true);
    };
    const onKey = (e: KeyboardEvent) => {
      unlock();
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const g = gameRef.current;
      if (!g) return;
      const startKeys = ['Enter', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (g.phase === 'attract' && startKeys.includes(e.code)) g.begin();
      else if (e.code === 'KeyR' && g.phase !== 'attract') restartRef.current();
      else if (e.code === 'Escape') setShowPair(false);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Hints fade on their own; the finish card waits for the fanfare.
  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(null), 6000);
    return () => window.clearTimeout(id);
  }, [hint]);
  useEffect(() => {
    if (!finish) return;
    const id = window.setTimeout(() => setShowFinish(true), 2400);
    return () => window.clearTimeout(id);
  }, [finish]);
  useEffect(() => {
    if (phase === 'play' && hudRef.current.motes === 0) {
      setHint(linked ? 'Tilt to walk · flick or tap to jump' : 'WASD or arrows to move · Space to jump');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const toggleSound = () => {
    const g = gameRef.current;
    if (!g) return;
    g.sfx.unlock();
    const next = !soundOn;
    g.sfx.setMuted(!next);
    setSoundOn(next);
  };

  const pairProps = {
    code,
    qr,
    joinUrl,
    roomError,
    onRetryRoom: () => setRoomAttempt((n) => n + 1),
    status,
    soundOn,
    board: board.board,
    boardLoading: board.loading,
    boardError: board.error,
    onRetryBoard: () => void board.refresh(),
  };

  return (
    <div className="no-select relative h-full w-full overflow-hidden bg-[#8fd0ee]">
      <div ref={mountRef} className="absolute inset-0" />

      {glError && (
        <div className="sky-backdrop absolute inset-0 z-40 flex items-center justify-center p-6 text-center text-ink">
          <p className="glass max-w-md rounded-3xl p-6 font-semibold">{glError}</p>
        </div>
      )}

      {/* Soft white wash when Pip is whisked back to a checkpoint. */}
      {flash > 0 && <div key={flash} className="pointer-events-none absolute inset-0 z-10 animate-[rise_0.6s_ease-out_reverse_both] bg-cream/70" />}

      {phase === 'attract' ? (
        <Lobby {...pairProps} variant="lobby" onKeyboard={() => gameRef.current?.begin()} />
      ) : (
        <Hud
          game={game}
          hud={hud}
          hint={showFinish ? null : hint}
          status={status}
          code={code}
          soundOn={soundOn}
          onToggleSound={toggleSound}
          onRestart={restart}
          onShowPair={() => setShowPair(true)}
        />
      )}

      {notice && phase === 'play' && (
        <div role="status" className="glass animate-rise absolute left-1/2 top-20 z-20 w-[min(92%,30rem)] -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-sm font-semibold text-ink">
          {notice}
          <button onClick={() => setNotice(null)} className="ml-3 underline underline-offset-2">Dismiss</button>
        </div>
      )}

      {showPair && phase !== 'attract' && <Lobby {...pairProps} variant="dialog" onClose={() => setShowPair(false)} />}

      {finish && showFinish && (
        <FinishPanel
          stats={finish}
          board={board.board}
          boardLoading={board.loading}
          boardError={board.error}
          refreshBoard={board.refresh}
          onAgain={restart}
        />
      )}
    </div>
  );
}
