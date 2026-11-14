import supabase from './db-client.js';

// Short pairing codes: 4 letters, no I/O to avoid confusion when read aloud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const code = String(req.query.code || '').toUpperCase().trim();
      if (!/^[A-Z]{4}$/.test(code)) return res.status(400).json({ error: 'Room codes are 4 letters.' });
      const { data, error } = await supabase.from('rooms').select('*').eq('code', code).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'No room with that code.' });
      if (Date.now() - new Date(data.last_active).getTime() > ROOM_TTL_MS) {
        return res.status(404).json({ error: 'That room has expired.' });
      }
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      // Opportunistic cleanup of stale rooms.
      const cutoff = new Date(Date.now() - ROOM_TTL_MS).toISOString();
      await supabase.from('rooms').delete().lt('last_active', cutoff);

      for (let attempt = 0; attempt < 8; attempt++) {
        const code = makeCode();
        const { data, error } = await supabase.from('rooms').insert({ code }).select().single();
        if (!error) return res.status(201).json(data);
        if (error.code !== '23505') throw error; // 23505 = code collision, try again
      }
      return res.status(500).json({ error: 'Could not allocate a room code.' });
    }

    if (req.method === 'PUT') {
      const code = String(req.body?.code || '').toUpperCase().trim();
      if (!/^[A-Z]{4}$/.test(code)) return res.status(400).json({ error: 'Room codes are 4 letters.' });
      const { data, error } = await supabase
        .from('rooms')
        .update({ last_active: new Date().toISOString() })
        .eq('code', code)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'No room with that code.' });
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const code = String(req.body?.code || '').toUpperCase().trim();
      const { error } = await supabase.from('rooms').delete().eq('code', code);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
}
