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
    const offerMod = await import('../designer/engines/issued-offer.mjs');

    const found = await supa('/rest/v1/nac_quote_issues?token=eq.'
      + encodeURIComponent(token) + '&select=data&limit=1', { key: KEY });
    const row = Array.isArray(found.body) ? found.body[0] : null;
    if (!row || !row.data) return res.status(404).json({ error: 'not_found' });
    const issue = row.data;

    // What the page says the customer wants. Ids, or ids with a quantity for
    // the upgrades bought by the unit. Nothing here is trusted as a PRICE —
    // every figure comes from the frozen offer below.
    const asked = Array.isArray(body.selectedOptionIds) ? body.selectedOptionIds.slice(0, 20) : [];
    const selection = asked.map(x => (x && typeof x === 'object')
      ? { id: clean(x.id, 64), quantity: Number(x.quantity) }
      : { id: clean(x, 64), quantity: null }).filter(o => o.id);
    const selected = selection.map(o => o.id);
    const chosenSystemId = body.chosenSystemId !== undefined
      ? clean(body.chosenSystemId, 64) : undefined;

    // ── THE OFFER IS THE AUTHORITY ─────────────────────────────────────────
    //
    // This endpoint used to reload the design and the content library and
    // rebuild the presentation to get the accepted total — so the figure NAC
    // would be held to was whatever the live data said at the moment the
    // customer pressed the button, not what they were shown. It also rebuilt
    // WITHOUT the settings and WITHOUT the system choice, so the total it
    // recorded was the designed unit's price under no commercial terms.
    //
    // The price now comes from the copy frozen at issue, which is the same
    // copy the page was rendered from.
    if (!offerMod.isOffer(issue.offer)) {
      return res.status(409).json({ state: 'no_issued_copy',
        message: 'This quote was issued before quotes were stored as a fixed copy. '
          + 'Issue a new revision.' });
    }
    const priced = offerMod.priceSelection(issue.offer, {
      chosenSystemId: chosenSystemId !== undefined
        ? chosenSystemId : (issue.chosenSystemId || null),
      selectedOptions: selection.length ? selection
        : (issue.selectedOptions || issue.selectedOptionIds || [])
    });
    if (!priced.ok) {
      return res.status(409).json({ state: 'blocked', message: priced.message || null });
    }

    let result;
    if (action === 'options') {
      result = share.changeOptions(issue, priced.selectedOptionIds,
        { selectedOptions: priced.lines, chosenSystemId: priced.chosenSystemId });
    } else if (action === 'decline') {
      result = share.declinePresentation(issue, { reason: clean(body.reason, 500) });
    } else {
      result = share.acceptPresentation(issue, {
        customerName: clean(body.customerName, 120),
        acknowledgedTerms: body.acknowledgedTerms === true,
        signature: body.signature ? clean(body.signature, 200000) : null,
        // The authoritative total: the frozen base for the system they chose,
        // plus the frozen price of each upgrade they ticked. Never the number
        // the page was showing — the page is on the other side of the wire.
        totalIncGst: priced.totalIncGst,
        selectedOptionIds: priced.selectedOptionIds,
        selectedOptions: priced.lines,
        chosenSystemId: priced.chosenSystemId,
        offerFrozenAt: issue.offer.frozenAt
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
      selectedOptionIds: next.selectedOptionIds || [],
      chosenSystemId: next.chosenSystemId || null,
      totalIncGst: priced.totalIncGst,
      deposit: priced.deposit
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
