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
    const [share, presentationMod, offerMod] = await Promise.all([
      import('../designer/engines/presentation-share.mjs'),
      import('../designer/engines/presentation.mjs'),
      import('../designer/engines/issued-offer.mjs')
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

    // ── THE CUSTOMER SEES WHAT THEY WERE SENT ──────────────────────────────
    //
    // This endpoint used to load the DESIGN, the CONTENT LIBRARY and NAC's
    // SETTINGS and rebuild the page from them on every open. That made an
    // issued quote a live document: correcting a room size or repricing a unit
    // silently changed a proposal somebody already had in their inbox, under
    // the same link, the same proposal number and the same revision.
    //
    // An issued quote is served from the copy frozen when it was issued.
    // Nothing below reads the design, the content library or the settings.
    // Correcting an issued quote means issuing a new revision, which
    // supersedes this one and gives the customer a new link.
    if (!offerMod.isOffer(issue.offer)) {
      // Issued before the offer was frozen. It cannot be rendered honestly —
      // rebuilding it now would show today's numbers under that day's date.
      return res.status(409).json({
        state: 'no_issued_copy',
        message: 'This quote was issued before quotes were stored as a fixed copy, '
          + 'so it cannot be reopened. Issue a new revision.'
      });
    }

    const view = offerMod.offerPresentation(issue.offer, {
      chosenSystemId: issue.chosenSystemId || null,
      selectedOptions: issue.selectedOptions || issue.selectedOptionIds || [],
      // Whether this quote can still be accepted is a fact about the ISSUE and
      // is applied over the frozen document. Without it an accepted proposal
      // went on offering the Accept button, because the copy was built before
      // anybody had answered it.
      issue,
      expired: access.expired === true
    });
    if (!view.ok) return res.status(409).json({ state: 'blocked', message: view.message || null });

    // Last line of defence: the structural audit still runs on the way out. It
    // passed at issue; this catches a frozen copy that has been tampered with
    // in storage rather than one that was built wrong.
    const audit = presentationMod.auditPresentation(view.presentation);
    if (!audit.ok) return res.status(500).json({ error: 'presentation_audit_failed' });

    const out = { ...view.presentation };
    delete out._internal;          // estimator-side notes are not customer data
    return res.status(200).json({ state: 'ok', presentation: out });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};

module.exports.validToken = validToken;
