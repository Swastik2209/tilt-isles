import supabase from './db-client.js';

const MODES = ['flick', 'tap', 'stick', 'keys'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const [targets, runs] = await Promise.all([
        supabase.from('runs').select('*').eq('kind', 'target').order('time_ms', { ascending: true }),
        supabase.from('runs').select('*').eq('kind', 'player').order('time_ms', { ascending: true }).limit(limit),
      ]);
      if (targets.error) throw targets.error;
      if (runs.error) throw runs.error;
      return res.status(200).json({ targets: targets.data, runs: runs.data });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const name = String(b.name || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
      const time_ms = Math.round(Number(b.time_ms));
      const motes = Math.round(Number(b.motes));
      const blooms = Math.round(Number(b.blooms));
      const falls = Math.round(Number(b.falls));
      const control_mode = MODES.includes(b.control_mode) ? b.control_mode : 'keys';

      if (!name) return res.status(400).json({ error: 'Please enter a name.' });
      if (!Number.isFinite(time_ms) || time_ms < 5000 || time_ms > 3600000) {
        return res.status(400).json({ error: 'That time does not look valid.' });
      }
      if (![motes, blooms, falls].every((n) => Number.isFinite(n) && n >= 0 && n <= 999)) {
        return res.status(400).json({ error: 'Run stats are invalid.' });
      }

      const { data, error } = await supabase
        .from('runs')
        .insert({ name, time_ms, motes, blooms, falls, control_mode, kind: 'player' })
        .select()
        .single();
      if (error) throw error;

      const { count, error: countError } = await supabase
        .from('runs')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'player')
        .lt('time_ms', time_ms);
      if (countError) throw countError;

      return res.status(201).json({ run: data, rank: (count || 0) + 1 });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
}
