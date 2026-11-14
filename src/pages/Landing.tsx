import { ArrowRight, Monitor, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Leaderboard from '../components/Leaderboard';
import { useBoard } from '../lib/useBoard';

const STEPS = [
  { n: '1', title: 'Open the world', body: 'Start the viewer on a laptop or desktop. It shows a QR code and a four-letter room code.' },
  { n: '2', title: 'Pair your phone', body: 'Scan the code. Your phone becomes the controller — no app, no account.' },
  { n: '3', title: 'Tilt, flick, climb', body: 'Tilt to walk, flick to jump, flick again mid-air to spin-dash. Reach the Beacon.' },
];

export default function Landing() {
  const { board, loading, error, refresh } = useBoard(8);
  // Suggest the right role for the device in hand.
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900);
  }, []);

  const card = 'group relative flex flex-col gap-3 rounded-3xl p-6 transition-transform duration-200 hover:-translate-y-1 focus-visible:outline-4 focus-visible:outline-ink';

  return (
    <div className="sky-backdrop relative min-h-full overflow-hidden text-ink">
      {/* Decorative drifting isles */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-drift absolute -left-10 top-[58%] h-24 w-64 rounded-[50%] bg-white/50 blur-2xl" />
        <div className="animate-drift absolute right-[-4rem] top-[22%] h-28 w-80 rounded-[50%] bg-white/45 blur-2xl [animation-delay:-4s]" />
        <div className="animate-drift absolute left-[38%] top-[80%] h-24 w-96 rounded-[50%] bg-white/50 blur-2xl [animation-delay:-2s]" />
      </div>

      <main className="relative mx-auto flex max-w-6xl flex-col gap-10 px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <header className="animate-rise max-w-3xl">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cream">
            <span className="h-2 w-2 rounded-full bg-sun" /> Phone-controlled 3D platformer
          </p>
          <h1 className="font-display text-6xl font-black leading-[0.92] tracking-tight sm:text-8xl">
            Tilt <span className="italic text-coral-deep">Isles</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink/80 sm:text-xl">
            Your phone is the controller. Your big screen is a chain of floating islands. Lean, flick and bounce a
            small creature named Pip all the way up to the Beacon.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2" aria-label="Choose this device's role">
          <Link
            to="/viewer"
            className={`${card} animate-rise bg-ink text-cream shadow-2xl shadow-ink/30 [animation-delay:80ms] ${touch ? 'order-2' : ''}`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sun text-ink">
              <Monitor size={24} />
            </span>
            <h2 className="font-display text-3xl font-bold">This is the screen</h2>
            <p className="text-cream/75">Open the game world here. Best on a laptop, desktop or TV browser.</p>
            <span className="mt-auto inline-flex items-center gap-2 pt-2 font-semibold text-sun">
              Open viewer <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </span>
            {!touch && <span className="absolute right-5 top-5 rounded-full bg-cream/15 px-2.5 py-1 text-xs font-semibold">Start here</span>}
          </Link>

          <Link
            to="/controller"
            className={`${card} glass animate-rise [animation-delay:160ms] ${touch ? 'order-1 ring-4 ring-coral' : ''}`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-coral text-cream">
              <Smartphone size={24} />
            </span>
            <h2 className="font-display text-3xl font-bold">This is the controller</h2>
            <p className="text-ink/75">Join a room with its four-letter code and steer with motion.</p>
            <span className="mt-auto inline-flex items-center gap-2 pt-2 font-semibold text-coral-deep">
              Enter room code <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </span>
            {touch && <span className="absolute right-5 top-5 rounded-full bg-coral px-2.5 py-1 text-xs font-semibold text-cream">You’re on a phone</span>}
          </Link>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="glass animate-rise rounded-3xl p-6 [animation-delay:240ms]">
            <h2 className="font-display text-2xl font-bold">How it works</h2>
            <ol className="mt-4 grid gap-4 sm:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="font-display text-4xl font-black italic text-coral-deep">{s.n}</span>
                  <h3 className="mt-1 font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink/70">{s.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-5 rounded-2xl bg-ink/5 px-4 py-3 text-sm text-ink/75">
              No phone nearby? The viewer also plays with a keyboard — WASD or arrows to move, Space to jump.
            </p>
          </div>

          <div className="glass animate-rise rounded-3xl p-6 [animation-delay:320ms]">
            <h2 className="mb-3 font-display text-2xl font-bold">Fastest climbs</h2>
            <Leaderboard board={board} loading={loading} error={error} onRetry={refresh} limit={6} />
          </div>
        </section>
      </main>
    </div>
  );
}
