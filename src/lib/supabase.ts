import { createClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client. Only used for Realtime (WebSocket) room
 * channels — all database reads/writes go through the /api routes.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 60 } },
  },
);
