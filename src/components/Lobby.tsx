import { Keyboard, RefreshCw, Smartphone, Volume2, X } from 'lucide-react';
import type { Board } from '../lib/api';
import type { LinkStatus } from '../net/room';
import Leaderboard from './Leaderboard';

interface Props {
  code: string | null;
  qr: string | null;
  joinUrl: string | null;
  roomError: string | null;
  onRetryRoom: () => void;
  status: LinkStatus;
  soundOn: boolean;
  /** Full lobby (before the run) or the small re-pair dialog during play. */
  variant: 'lobby' | 'dialog';
  onKeyboard?: () => void;
  onClose?: () => void;
  board: Board | null;
  boardLoading: boolean;
  boardError: string | null;
  onRetryBoard: () => void;
}

function PairCard({ code, qr, joinUrl, roomError, onRetryRoom, status }: Pick<Props, 'code' | 'qr' | 'joinUrl' | 'roomError' | 'onRetryRoom' | 'status'>) {
  const linked = status === 'relay' || status === 'direct';
  if (roomError) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="font-display text-2xl font-bold">Couldn’t open a room</p>
        <p className="max-w-xs text-sm text-ink/70">{roomError} You can still play with the keyboard.</p>
        <button onClick={onRetryRoom} className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-cream hover:bg-ink-soft">
          <RefreshCw size={16} /> Try again
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-stretch sm:gap-6">
      <div className="relative h-44 w-44 shrink-0 overflow-hidden rounded-2xl bg-cream p-2 ring-4 ring-ink">
        {qr ? (
          <img src={qr} alt={`QR code to join room ${code}`} className="h-full w-full" />
        ) : (
          <div className="h-full w-full animate-pulse rounded-xl bg-ink/10" />
        )}
        {linked && (
          <div className="animate-pop absolute inset-0 flex flex-col items-center justify-center gap-1 bg-leaf/95 text-ink">
            <Smartphone size={36} />
            <span className="font-display text-xl font-bold">Linked!</span>
          </div>
        )}
      </div>
      <div className="flex flex-col justify-center text-center sm:text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Room code</p>
        <p className="tabular font-display text-6xl font-black leading-none tracking-[0.12em] text-ink">
          {code ?? '····'}
        </p>
        <ol className="mt-3 space-y-1 text-sm text-ink/75">
          <li><b className="text-ink">1.</b> Scan the code with your phone camera</li>
          <li><b className="text-ink">2.</b> Tap <i>Enable motion</i> and hold it like a tray</li>
          <li><b className="text-ink">3.</b> Tilt to walk, flick to jump</li>
        </ol>
        {joinUrl && (
          <p className="mt-2 break-all text-xs text-ink/55">
            or open <span className="font-semibold text-ink/80">{joinUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}</span> and enter the code
          </p>
        )}
      </div>
    </div>
  );
}

export default function Lobby(props: Props) {
  const { variant, status, soundOn, onKeyboard, onClose } = props;
  const linked = status === 'relay' || status === 'direct';

  if (variant === 'dialog') {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
        <div role="dialog" aria-label="Pair a phone" className="glass animate-pop relative rounded-3xl p-6 text-ink" onClick={(e) => e.stopPropagation()}>
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink/10">
            <X size={18} />
          </button>
          <h2 className="mb-4 font-display text-2xl font-bold">Pair a phone</h2>
          <PairCard {...props} />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/35 via-transparent to-ink/45" />
      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col justify-between gap-6 p-5 sm:p-8">
        <header className="animate-rise text-cream drop-shadow-[0_3px_12px_rgba(16,34,46,0.55)]">
          <h1 className="font-display text-6xl font-black leading-[0.9] tracking-tight sm:text-8xl">
            Tilt <span className="italic text-sun">Isles</span>
          </h1>
          <p className="mt-2 max-w-md text-lg font-medium text-cream/95">
            Your phone is the controller. Climb the Hanging Isles and light the Beacon.
          </p>
        </header>

        <div className="grid items-end gap-4 lg:grid-cols-[auto_1fr_20rem]">
          <section className="glass animate-rise rounded-3xl p-5 text-ink [animation-delay:100ms] sm:p-6">
            <PairCard {...props} />
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-4">
              <button
                onClick={onKeyboard}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:bg-ink-soft focus-visible:outline-4 focus-visible:outline-coral"
              >
                <Keyboard size={16} /> Play with keyboard
                <kbd className="rounded bg-cream/20 px-1.5 text-xs">Enter</kbd>
              </button>
              <span className="text-sm text-ink/70" aria-live="polite">
                {linked ? 'Phone linked — starting…' : 'Waiting for a phone to join…'}
              </span>
            </div>
          </section>

          <div />

          <section className="glass animate-rise rounded-3xl p-5 text-ink [animation-delay:200ms]">
            <h2 className="mb-3 font-display text-xl font-bold">Fastest climbs</h2>
            <Leaderboard board={props.board} loading={props.boardLoading} error={props.boardError} onRetry={props.onRetryBoard} limit={5} compact />
            {!soundOn && (
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-sun/50 px-3 py-2 text-xs font-medium">
                <Volume2 size={14} /> Click anywhere on this page to switch sound on.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
