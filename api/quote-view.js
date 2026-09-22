// ─────────────────────────────────────────────────────────────────────────────
// GET /api/quote-view?token=…
//
// The only way a customer's browser reaches an issued quote.
//
// Everything that matters happens on this side of the wire: the token is looked
// up with the SERVICE-ROLE key, the design is loaded, the presentation is built
// and audited, and what goes back is the finished view model — no design, no
// bill of materials, no commercials object, no warnings. The browser is handed
// a document, not a database.
//
// Nick: "Do not expose service-role keys or other private credentials to the
// browser." The key is read from the environment here and never appears in the
// response, in a log line, or in an error message.
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';

function supa(path, { method = 'GET', key, body = null } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    hostname: SUPA_HOST, path, method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
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
        resolve({ status: resp.statusCode, body: parsed, raw: data });
      });
    });
    // The message is deliberately generic: a connection error can carry host
    // and credential detail that has no business reaching a customer's browser.
    r.on('error', () => reject(new Error('upstream_unavailable')));
    if (payload) r.write(payload);
    r.end();
  });
}

/** Tokens are base64url and fixed-length. Anything else is not looked up. */
function validToken(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(t);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const token = (req.query && req.query.token) || (req.body && req.body.token) || '';
  if (!validToken(token)) return res.status(400).json({ error: 'bad_token' });

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  try {
    const [share, presentationMod] = await Promise.all([
      import('../designer/engines/presentation-share.mjs'),
      import('../designer/engines/presentation.mjs')
    ]);

    const found = await supa('/rest/v1/nac_quote_issues?token=eq.'
      + encodeURIComponent(token) + '&select=data&limit=1', { key: KEY });
    const row = Array.isArray(found.body) ? found.body[0] : null;
    if (!row || !row.data) return res.status(404).json({ error: 'not_found' });

    let issue = row.data;
    const access = share.resolveAccess(issue);
    if (!access.ok) {
      // A superseded link is not an error — the customer is pointed forward.
      return res.status(access.reason === 'superseded' ? 200 : 410).json({
        state: access.reason,
        message: access.message,
        redirectToken: access.redirectToken || null
      });
    }

    // Record the view before rendering, so a page that fails to render still
    // shows in the audit trail as having been opened.
    issue = share.recordView(issue);
    await supa('/rest/v1/nac_quote_issues?token=eq.' + encodeURIComponent(token),
      { method: 'PATCH', key: KEY, body: { data: issue, updated_at: new Date().toISOString() } });

    const designRes = await supa('/rest/v1/nac_designs?id=eq.'
      + encodeURIComponent(issue.designId || '') + '&select=data&limit=1', { key: KEY });
    const designRow = Array.isArray(designRes.body) ? designRes.body[0] : null;
    const design = designRow && (designRow.data?.design || designRow.data);
    if (!design) return res.status(404).json({ error: 'design_not_found' });

    const contentRes = await supa('/rest/v1/nac_presentation_content?key=eq.library&select=data&limit=1',
      { key: KEY });
    const contentRow = Array.isArray(contentRes.body) ? contentRes.body[0] : null;
    const content = (contentRow && contentRow.data) || {};

    const built = presentationMod.buildPresentation({
      design,
      customer: issue.customer || {},
      job: issue.job || {},
      content,
      proposalNumber: issue.proposalNumber || '',
      preparedAt: issue.issuedAt,
      expiresAt: issue.expiresAt,
      revision: issue.quoteRevision,
      status: issue.status,
      selectedOptionIds: issue.selectedOptionIds || [],
      privacy: issue.privacy || {},
      intro: issue.intro || '',
      heroImage: content.heroImage || null,
      productImage: issue.productImage || null
    });

    // A quote that the gate blocks is never published, even if somebody
    // managed to issue a link for it.
    if (!built.ok) return res.status(409).json({ state: 'blocked' });

    // Last line of defence: the structural audit runs on the way out, and a
    // leak fails the request rather than reaching the customer.
    const audit = presentationMod.auditPresentation(built.presentation);
    if (!audit.ok) return res.status(500).json({ error: 'presentation_audit_failed' });

    const out = { ...built.presentation };
    delete out._internal;          // estimator-side notes are not customer data
    return res.status(200).json({ state: 'ok', presentation: out });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};

module.exports.validToken = validToken;
