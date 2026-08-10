// NAC — Server-side upload to Supabase Storage (bypasses storage RLS).
export const config = { api: { bodyParser: { sizeLimit: '25mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key not configured' });

  const b = req.body || {};
  const files = Array.isArray(b.files) ? b.files : [];
  if (files.length === 0) return res.status(400).json({ error: 'no files' });

  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const urls = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i] || {};
    const rawName = (f.name || ('file' + i)).replace(/[^a-zA-Z0-9._-]/g, '_');
    const label = f.label || 'photo';
    const path = label + '-' + stamp + '-' + i + '-' + rawName;
    const contentType = f.type || 'application/octet-stream';

    try {
      const buffer = Buffer.from(f.data || '', 'base64');
      if (buffer.length === 0) { errors.push(path + ': empty'); continue; }

      const r = await fetch(SUPA_URL + '/storage/v1/object/intake-uploads/' + encodeURIComponent(path), {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'apikey': SERVICE_KEY,
          'Content-Type': contentType,
          'x-upsert': 'true'
        },
        body: buffer
      });

      if (!r.ok) {
        const txt = await r.text();
        errors.push(path + ': ' + r.status + ' ' + txt.slice(0, 120));
        continue;
      }

      urls.push(SUPA_URL + '/storage/v1/object/public/intake-uploads/' + encodeURIComponent(path));
    } catch (e) {
      errors.push(path + ': ' + e.message);
    }
  }

  return res.status(200).json({ ok: true, urls: urls, errors: errors });
}
