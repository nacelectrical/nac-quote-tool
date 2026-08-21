// NAC — Looks up a GHL contact so the intake form can pre-fill their details.
export default async function handler(req, res) {
  const id = (req.query.c || req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'contact id required' });

  const KEY = process.env.GHL_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'GHL API key not configured' });

  const LOCATION = process.env.GHL_LOCATION_ID || 'F9lqSglbu2mMtfJYp22L';

  const attempts = [
    {
      url: 'https://services.leadconnectorhq.com/contacts/' + encodeURIComponent(id),
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Version': '2021-07-28',
        'Accept': 'application/json',
        'LocationId': LOCATION
      }
    },
    {
      url: 'https://rest.gohighlevel.com/v1/contacts/' + encodeURIComponent(id),
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Accept': 'application/json'
      }
    }
  ];

  let lastError = '';

  for (let i = 0; i < attempts.length; i++) {
    try {
      const r = await fetch(attempts[i].url, { headers: attempts[i].headers });
      if (!r.ok) { lastError = 'HTTP ' + r.status + ' from attempt ' + (i + 1); continue; }
      const data = await r.json();
      const c = data.contact || data || {};

      const first = (c.firstName || c.first_name || '').trim();
      const last = (c.lastName || c.last_name || '').trim();
      let name = (c.contactName || c.name || (first + ' ' + last)).trim();
      if (!name) name = first;

      return res.status(200).json({
        ok: true,
        name: name,
        phone: (c.phone || '').trim(),
        email: (c.email || '').trim()
      });
    } catch (e) {
      lastError = e.message;
    }
  }

  return res.status(502).json({ error: 'Could not fetch contact', detail: lastError });
}
