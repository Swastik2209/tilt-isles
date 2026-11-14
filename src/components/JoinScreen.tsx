import { ArrowRight, Gamepad2, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface Props {
  initialCode: string | null;
  room: string | null;
  onJoined: (code: string) => void;
  asking: boolean;
  onEnableMotion: () => void;
  onUseStick: () => void;
  statusText: string;
}

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

/** Phone onboarding: enter / confirm the room code, then grant motion access. */
export default function JoinScreen({ initialCode, room, onJoined, asking, onEnableMotion, onUseStick, statusText }: Props) {
  const [code, setCode] = useState(clean(initialCode ?? ''));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);

  const join = useCallback(
    async (c: string) => {
      if (c.length !== 4) {
        setError('Room codes are four letters — check the big screen.');
        return;
      }
      setChecking(true);
      setError(null);
      try {
        const r = await api.getRoom(c);
        onJoined(r.code);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reach the room. Check your connection.');
      } finally {
        setChecking(false);
      }
    },
    [onJoined],
  );

  // Arrived via QR code: validate straight away.
  useEffect(() => {
    if (autoTried.current || room) return;
    autoTried.current = true;
    if (code.length === 4) void join(code);
  }, [code, room, join]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void join(code);
  };

  return (
    <div className="pad-backdrop flex min-h-full flex-col items-center justify-center gap-8 p-6 text-cream">
      <Link to="/" className="font-display text-4xl font-black tracking-tight">
        Tilt <span className="italic text-sun">Isles</span>
      </Link>

      {!room ? (
        <form onSubmit={submit} noValidate className="animate-rise w-full max-w-sm rounded-[2rem] bg-cream/10 p-6 backdrop-blur">
          <h1 className="font-display text-3xl font-bold">Join a room</h1>
          <p className="mt-1 text-cream/75">Type the four-letter code shown on the big screen.</p>
          <label htmlFor="room-code" className="sr-only">Room code</label>
          <input
            id="room-code"
            value={code}
            onChange={(e) => {
              setCode(clean(e.target.value));
              setError(null);
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={4}
            placeholder="ABCD"
            aria-invalid={!!error}
            aria-describedby={error ? 'room-code-error' : undefined}
            className="mt-5 w-full rounded-2xl border-2 border-cream/25 bg-deep/60 px-4 py-4 text-center font-display text-5xl font-black uppercase tracking-[0.3em] text-cream outline-none placeholder:text-cream/20 focus:border-sun"
          />
          {error && <p id="room-code-error" role="alert" className="mt-2 text-sm font-medium text-[#ffb4a8]">{error}</p>}
          <button
            type="submit"
            disabled={checking}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-coral py-4 text-lg font-bold text-ink transition-colors active:bg-sun disabled:opacity-60"
          >
            {checking ? 'Finding room…' : <>Join <ArrowRight size={20} /></>}
          </button>
          <p className="mt-4 text-center text-sm text-cream/60">
            No screen yet? Open <Link to="/viewer" className="font-semibold text-sun underline underline-offset-2">the viewer</Link> on a computer.
          </p>
        </form>
      ) : (
        <div className="animate-rise w-full max-w-sm rounded-[2rem] bg-cream/10 p-6 text-center backdrop-blur">
          <p className="inline-flex items-center gap-2 rounded-full bg-cream px-3 py-1 text-sm font-bold tracking-[0.2em] text-ink">
            ROOM {room}
          </p>
          <p className="mt-2 text-sm text-cream/65" role="status">{statusText}</p>

          <div className="mx-auto my-6 flex h-36 w-36 items-center justify-center rounded-full bg-deep/50" aria-hidden>
            <div className="animate-rock flex h-24 w-14 items-center justify-center rounded-xl border-2 border-cream bg-ink-soft shadow-xl">
              <Smartphone size={22} className="text-sun" />
            </div>
          </div>

          <h1 className="font-display text-3xl font-bold">Hold it like a tray</h1>
          <p className="mt-2 text-cream/75">
            Tilt to walk, flick up to jump. Your phone will ask for motion access — that’s the only thing it shares.
          </p>
          <button
            onClick={onEnableMotion}
            disabled={asking}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-coral py-4 text-lg font-bold text-ink transition-colors active:bg-sun disabled:opacity-60"
          >
            {asking ? 'Waiting for permission…' : 'Enable motion'}
          </button>
          <button onClick={onUseStick} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-cream/10 py-3.5 font-semibold active:bg-cream/20">
            <Gamepad2 size={18} /> Use a thumbstick instead
          </button>
        </div>
      )}
    </div>
  );
}
