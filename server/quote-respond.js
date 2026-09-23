// ─────────────────────────────────────────────────────────────────────────────
// POST /api/quote-respond
//
// Accept, decline, or change the selected options on an issued quote.
//
// The total is recomputed here from the design and the content library. It is
// deliberately NOT taken from the request body: a price the browser sends is a
// price the customer's browser could have edited, and this is the number that
// ends up on an accepted record.
//
// Nick: "An accepted quote must become immutable. Later changes require a new
// revision and fresh customer acceptance."
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');
const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';

function supa(path, { method = 'GET', key, body = null } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    hostname: SUPA_HOST, path, method,
    headers: {
      apikey: key, Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
    }
  };
  return new Promise((resolve, reject) => {
    const r = https.request(options, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', () => reject(new Error('upstream_unavailable')));
    if (payload) r.write(payload);
    r.end();
  });
}

const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(t);
const clean = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = req.body || {};
  const token = body.token;
  const action = body.action;
  if (!validToken(token)) return res.status(400).json({ error: 'bad_token' });
  if (!['accept', 'decline', 'options'].includes(action)) {
    return res.status(400).json({ error: 'bad_action' });
  }
  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  try {
    const share = await import('../designer/engines/presentation-share.mjs');
    const pres = await import('../designer/engines/presentation.mjs');

    const found = await supa('/rest/v1/nac_quote_issues?token=eq.'
      + encodeURIComponent(token) + '&select=data&limit=1', { key: KEY });
    const row = Array.isArray(found.body) ? found.body[0] : null;
    if (!row || !row.data) return res.status(404).json({ error: 'not_found' });
    const issue = row.data;

    const selected = Array.isArray(body.selectedOptionIds)
      ? body.selectedOptionIds.map(x => clean(x, 64)).filter(Boolean).slice(0, 20) : [];

    let result;
    if (action === 'options') {
      result = share.changeOptions(issue, selected);
    } else if (action === 'decline') {
      result = share.declinePresentation(issue, { reason: clean(body.reason, 500) });
    } else {
      // Rebuild the presentation to get the AUTHORITATIVE total for this
      // revision and this option selection. Never trust the number the page
      // was showing — the page is on the other side of the wire.
      const designRes = await supa('/rest/v1/nac_designs?id=eq.'
        + encodeURIComponent(issue.designId || '') + '&select=data&limit=1', { key: KEY });
      const designRow = Array.isArray(designRes.body) ? designRes.body[0] : null;
      const design = designRow && (designRow.data?.design || designRow.data);
      if (!design) return res.status(404).json({ error: 'design_not_found' });

      const contentRes = await supa(
        '/rest/v1/nac_presentation_content?key=eq.library&select=data&limit=1', { key: KEY });
      const contentRow = Array.isArray(contentRes.body) ? contentRes.body[0] : null;
      const content = (contentRow && contentRow.data) || {};

      const built = pres.buildPresentation({
        design, customer: issue.customer || {}, job: issue.job || {}, content,
        revision: issue.quoteRevision, status: issue.status,
        selectedOptionIds: selected.length ? selected : (issue.selectedOptionIds || []),
        expiresAt: issue.expiresAt
      });
      if (!built.ok) return res.status(409).json({ state: 'blocked' });

      result = share.acceptPresentation(issue, {
        customerName: clean(body.customerName, 120),
        acknowledgedTerms: body.acknowledgedTerms === true,
        signature: body.signature ? clean(body.signature, 200000) : null,
        totalIncGst: built.presentation.investment.totalIncGst,
        selectedOptionIds: selected.length ? selected : (issue.selectedOptionIds || [])
      });
    }

    if (!result.ok) {
      return res.status(409).json({ state: result.reason, message: result.message || null,
        needsNewRevision: !!result.needsNewRevision });
    }

    const next = result.issue;
    await supa('/rest/v1/nac_quote_issues?token=eq.' + encodeURIComponent(token), {
      method: 'PATCH', key: KEY,
      body: { data: next, status: next.status,
              responded_at: next.respondedAt || null,
              updated_at: new Date().toISOString() }
    });

    return res.status(200).json({
      state: 'ok',
      status: next.status,
      // Echo back only what the page needs to update itself.
      acceptedTotal: next.acceptance ? next.acceptance.totalIncGst : null,
      selectedOptionIds: next.selectedOptionIds || []
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
