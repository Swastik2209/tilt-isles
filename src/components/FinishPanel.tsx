import { Flower2, Gem, RotateCcw, Skull, Trophy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { FinishStats } from '../game/Game';
import { api, formatTime, type Board } from '../lib/api';
import Leaderboard, { MedalChip, medalFor } from './Leaderboard';

interface Props {
  stats: FinishStats;
  board: Board | null;
  boardLoading: boolean;
  boardError: string | null;
  refreshBoard: () => Promise<void> | void;
  onAgain: () => void;
}

const NAME_KEY = 'tilt-isles-name';

export default function FinishPanel({ stats, board, boardLoading, boardError, refreshBoard, onAgain }: Props) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: number; rank: number } | null>(null);

  const medal = board ? medalFor(stats.timeMs, board.targets) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setError('Enter a name to put this run on the board.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.submitRun({
        name: clean,
        time_ms: stats.timeMs,
        motes: stats.motes,
        blooms: stats.blooms,
        falls: stats.falls,
        control_mode: stats.mode,
      });
      localStorage.setItem(NAME_KEY, clean);
      setSaved({ id: res.run.id, rank: res.rank });
      await refreshBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your run.');
    } finally {
      setSaving(false);
    }
  };

  const stat = 'flex items-center gap-2 rounded-2xl bg-ink/5 px-3 py-2 text-sm font-semibold';

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-ink/25 p-4">
      <div role="dialog" aria-label="Run complete" className="glass animate-rise my-auto grid w-full max-w-3xl !bg-cream/95 gap-6 rounded-[2rem] p-6 text-ink sm:p-8 md:grid-cols-2">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cream">
            <Trophy size={14} className="text-sun" /> Beacon lit
          </p>
          <p className="tabular mt-3 font-display text-6xl font-black leading-none sm:text-7xl">{formatTime(stats.timeMs)}</p>
          <div className="mt-2 h-6">
            {medal ? (
              <span className="inline-flex items-center gap-2 text-sm text-ink/70">
                <MedalChip name={medal.name} /> beat the {medal.name.toLowerCase()} target of {formatTime(medal.time_ms)}
              </span>
            ) : board ? (
              <span className="text-sm text-ink/70">No medal this time — the bronze target is waiting.</span>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={stat}><Gem size={16} className="text-[#e59a00]" fill="#ffc94d" /> {stats.motes} / {stats.total}</span>
            <span className={stat}><Flower2 size={16} className="text-[#e0559a]" fill="#ffd3e6" /> {stats.blooms} / {stats.bloomTotal}</span>
            <span className={stat}><Skull size={16} className="text-ink/60" /> {stats.falls} {stats.falls === 1 ? 'fall' : 'falls'}</span>
          </div>

          {saved ? (
            <p className="animate-pop mt-5 rounded-2xl bg-leaf/40 px-4 py-3 font-semibold">
              Saved — you’re #{saved.rank} on the board.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-5" noValidate>
              <label htmlFor="run-name" className="text-sm font-semibold">Sign your run</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="run-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={16}
                  autoComplete="nickname"
                  placeholder="Your name"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'run-name-error' : undefined}
                  className="min-w-0 flex-1 rounded-xl border-2 border-ink/20 bg-paper px-3 py-2.5 font-semibold text-ink outline-none placeholder:text-ink/35 focus:border-coral"
                />
                <button type="submit" disabled={saving} className="rounded-xl bg-coral px-4 py-2.5 font-semibold text-ink transition-colors hover:bg-sun disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {error && <p id="run-name-error" role="alert" className="mt-1.5 text-sm font-medium text-[#b3261e]">{error}</p>}
            </form>
          )}

          <button onClick={onAgain} className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 font-semibold text-cream transition-colors hover:bg-ink-soft focus-visible:outline-4 focus-visible:outline-coral">
            <RotateCcw size={18} /> Run it again
          </button>
        </div>

        <div>
          <h2 className="mb-3 font-display text-2xl font-bold">Fastest climbs</h2>
          <Leaderboard board={board} loading={boardLoading} error={boardError} onRetry={() => void refreshBoard()} highlightId={saved?.id} limit={8} />
        </div>
      </div>
    </div>
  );
}
