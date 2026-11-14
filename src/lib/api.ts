/** Thin typed wrappers around the serverless API routes. */

export interface Room {
  code: string;
  created_at: string;
  last_active: string;
}

export interface Run {
  id: number;
  name: string;
  time_ms: number;
  motes: number;
  blooms: number;
  falls: number;
  control_mode: string | null;
  kind: 'player' | 'target';
  created_at: string;
}

export interface Board {
  targets: Run[];
  runs: Run[];
}

async function json<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

const post = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  createRoom: () => fetch('/api/rooms', post('POST', {})).then((r) => json<Room>(r)),
  getRoom: (code: string) => fetch(`/api/rooms?code=${encodeURIComponent(code)}`).then((r) => json<Room>(r)),
  touchRoom: (code: string) => fetch('/api/rooms', post('PUT', { code })).then((r) => json<Room>(r)),
  getBoard: (limit = 25) => fetch(`/api/runs?limit=${limit}`).then((r) => json<Board>(r)),
  submitRun: (run: {
    name: string;
    time_ms: number;
    motes: number;
    blooms: number;
    falls: number;
    control_mode: string;
  }) => fetch('/api/runs', post('POST', run)).then((r) => json<{ run: Run; rank: number }>(r)),
};

/** 83450 -> "1:23.45" */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
