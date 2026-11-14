import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Controller from './pages/Controller';
import Landing from './pages/Landing';

// The viewer pulls in three.js — keep it out of the phone's bundle.
const Viewer = lazy(() => import('./pages/Viewer'));

function Loading() {
  return (
    <div className="sky-backdrop flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-ink">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-ink/20 border-t-coral" />
        <p className="font-display text-xl italic">Raising the isles…</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/controller" element={<Controller />} />
        <Route
          path="/viewer"
          element={
            <Suspense fallback={<Loading />}>
              <Viewer />
            </Suspense>
          }
        />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}
