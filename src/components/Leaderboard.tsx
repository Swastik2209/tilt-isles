import { Keyboard, Smartphone } from 'lucide-react';
import { formatTime, type Board, type Run } from '../lib/api';

const MEDAL_COLORS: Record<string, string> = {
  Gold: 'bg-sun text-ink',
  Silver: 'bg-mist text-ink',
  Bronze: 'bg-[#e8a877] text-ink',
};

/** Best medal earned for a time, judged against the target rows from the database. */
export function medalFor(timeMs: number, targets: Run[]): Run | null {
  const sorted = [...targets].sort((a, b) => a.time_ms - b.time_ms);
  return sorted.find((t) => timeMs <= t.time_ms) ?? null;
}

export function MedalChip({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${MEDAL_COLORS[name] ?? 'bg-ink/10 text-ink'} ${className}`}
    >
      {name}
    </span>
  );
}

interface Props {
  board: Board | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  highlightId?: number | null;
  limit?: number;
  compact?: boolean;
}

export default function Leaderboard({ board, loading, error, onRetry, highlightId, limit = 8, compact }: Props) {
  if (loading && !board) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-ink/10" />
        ))}
      </div>
    );
  }
  if (error && !board) {
    return (
      <div className="rounded-xl bg-coral/15 p-3 text-sm text-ink">
        <p>Couldn’t load the best times. {error}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 font-semibold underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    );
  }
  if (!board) return null;

  const runs = board.runs.slice(0, limit);
  return (
    <div className="text-ink">
      {board.targets.length > 0 && (
        <div className={`mb-3 flex flex-wrap gap-x-4 gap-y-1 ${compact ? 'text-xs' : 'text-sm'}`}>
          {board.targets.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1.5">
              <MedalChip name={t.name} />
              <span className="tabular text-ink/70">under {formatTime(t.time_ms)}</span>
            </span>
          ))}
        </div>
      )}
      {runs.length === 0 ? (
        <p className="rounded-xl bg-ink/5 px-3 py-4 text-center text-sm text-ink/70">
          No runs recorded yet — reach the Beacon and yours will be the first.
        </p>
      ) : (
        <ol className="space-y-1">
          {runs.map((r, i) => {
            const medal = medalFor(r.time_ms, board.targets);
            const mine = r.id === highlightId;
            return (
              <li
                key={r.id}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${mine ? 'bg-sun/60 ring-2 ring-coral' : i % 2 ? '' : 'bg-ink/5'}`}
              >
                <span className="tabular w-5 text-right font-bold text-ink/50">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                {medal && !compact && <MedalChip name={medal.name} />}
                <span className="text-ink/45" title={r.control_mode === 'keys' ? 'Keyboard' : `Phone · ${r.control_mode}`}>
                  {r.control_mode === 'keys' ? <Keyboard size={14} /> : <Smartphone size={14} />}
                </span>
                <span className="tabular font-bold">{formatTime(r.time_ms)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
