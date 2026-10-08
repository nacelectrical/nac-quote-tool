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

function supa(path, { method = 'GET', key, body = null, prefer = null } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    hostname: SUPA_HOST, path, method,
    headers: {
      apikey: key, Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
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

/** Money compares to the cent. Floating point does not compare at all. */
const cents = (v) => Math.round(Number(v) * 100);
const sameMoney = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  && cents(a) === cents(b);

/**
 * Is this request the SAME acceptance that is already on file?
 *
 * A customer on a bad connection presses Accept, the request lands, the reply
 * does not, and they press it again. Refusing that with "this proposal has
 * already been answered" is correct but reads as a failure for something that
 * in fact succeeded. Replaying the identical acceptance returns the record
 * that exists.
 *
 * A DIFFERENT acceptance — another name, another system, other options, a
 * different total — is not a replay. It is a second, contradictory answer to
 * a signed contract, and it is refused.
 */
function isSameAcceptance(existing, asked) {
  if (!existing) return false;
  if (clean(existing.customerName, 120).toLowerCase() !== clean(asked.customerName, 120).toLowerCase()) {
    return false;
  }
  if (!sameMoney(existing.totalIncGst, asked.totalIncGst)) return false;
  if ((existing.chosenSystemId || null) !== (asked.chosenSystemId || null)) return false;
  const a = [...(existing.selectedOptionIds || [])].sort().join('|');
  const b = [...(asked.selectedOptionIds || [])].sort().join('|');
  return a === b;
}

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

    // The STATUS COLUMN is read as well as the record, because the conditional
    // write below filters on the column. Taking the guard value from the JSON
    // would compare one thing and filter on another.
    const found = await supa('/rest/v1/nac_quote_issues?token=eq.'
      + encodeURIComponent(token) + '&select=data,status&limit=1', { key: KEY });
    const row = Array.isArray(found.body) ? found.body[0] : null;
    if (!row || !row.data) return res.status(404).json({ error: 'not_found' });
    const issue = row.data;
    const statusColumn = row.status || issue.status;

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
    // ── THE LINK IS NOT A LICENCE TO ANSWER A DIFFERENT QUOTE ──────────────
    //
    // If the page tells us which revision and which frozen copy it is looking
    // at, those have to be the ones on file. A stale tab left open across a
    // new revision is the ordinary case: the customer is answering a document
    // that is no longer the offer, and must be shown the current one rather
    // than have their answer recorded against it.
    const askedRevision = body.quoteRevision === undefined || body.quoteRevision === null
      ? null : Number(body.quoteRevision);
    if (askedRevision !== null && Number(issue.quoteRevision) !== askedRevision) {
      return res.status(409).json({ state: 'revision_mismatch',
        message: 'This page is showing revision ' + askedRevision + ' and the current proposal is '
          + 'revision ' + issue.quoteRevision + '. Please reload before answering.',
        quoteRevision: issue.quoteRevision });
    }
    const askedFrozenAt = clean(body.offerFrozenAt, 64);
    if (askedFrozenAt && askedFrozenAt !== clean(issue.offer.frozenAt, 64)) {
      return res.status(409).json({ state: 'offer_mismatch',
        message: 'This page was built from a different copy of the proposal. Please reload '
          + 'before answering.' });
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

    // ── THE PRICE ON THE SCREEN MUST BE THE PRICE ON THE RECORD ────────────
    //
    // The authoritative total has always been computed here, so a tampered
    // body could never RAISE or LOWER what NAC is held to. What it could do is
    // succeed quietly: a customer accepts believing one number while another
    // is recorded, because their page was stale or had been edited. So the
    // page states the figure it is showing, and a disagreement is refused
    // rather than resolved in silence.
    const asserted = body.expectedTotalIncGst;
    if (asserted !== undefined && asserted !== null && asserted !== '') {
      if (!sameMoney(asserted, priced.totalIncGst)) {
        return res.status(409).json({ state: 'total_mismatch',
          message: 'The total on this page is out of date. It now comes to $'
            + priced.totalIncGst.toFixed(2) + '. Please reload and check it before accepting.',
          totalIncGst: priced.totalIncGst });
      }
    }

    // ── PRESSING ACCEPT TWICE IS NOT TWO ACCEPTANCES ───────────────────────
    if (action === 'accept' && issue.status === 'accepted' && issue.acceptance) {
      const replay = isSameAcceptance(issue.acceptance, {
        customerName: body.customerName, totalIncGst: priced.totalIncGst,
        chosenSystemId: priced.chosenSystemId, selectedOptionIds: priced.selectedOptionIds
      });
      if (replay) {
        return res.status(200).json({
          state: 'ok', repeat: true, status: issue.status,
          acceptedTotal: issue.acceptance.totalIncGst,
          selectedOptionIds: issue.selectedOptionIds || [],
          chosenSystemId: issue.chosenSystemId || null,
          totalIncGst: priced.totalIncGst, deposit: priced.deposit,
          message: 'This proposal was already accepted. Nothing was changed.'
        });
      }
      return res.status(409).json({ state: 'already_answered',
        message: 'This proposal has already been accepted, on different terms to the ones on '
          + 'this page. Please contact us — changing an accepted quote needs a new revision.',
        needsNewRevision: true });
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

    // ── TWO ANSWERS CANNOT BOTH WIN ────────────────────────────────────────
    //
    // Read-then-write is not safe on a link a customer may have open on a
    // phone and a laptop at once: both reads see `issued`, both accept, and
    // the second write silently replaces the first acceptance — a different
    // name, or a different total, over the top of a record somebody had
    // already been told was final.
    //
    // The update is made CONDITIONAL on the status that was read. PostgREST
    // applies the filter in the UPDATE itself, so the database decides the
    // winner, and `return=representation` tells us whether this request was
    // it. An answer that loses the race changes nothing and is reported
    // against the state that actually landed.
    const answering = action === 'accept' || action === 'decline';
    const guard = answering
      ? '&status=eq.' + encodeURIComponent(statusColumn)
      : '';
    const wrote = await supa('/rest/v1/nac_quote_issues?token=eq.' + encodeURIComponent(token)
      + guard, {
      method: 'PATCH', key: KEY, prefer: 'return=representation',
      body: { data: next, status: next.status,
              responded_at: next.respondedAt || null,
              updated_at: new Date().toISOString() }
    });

    if (answering && Array.isArray(wrote.body) && wrote.body.length === 0) {
      // Somebody else answered between the read and the write. Say what is now
      // on file rather than claiming this answer succeeded.
      const fresh = await supa('/rest/v1/nac_quote_issues?token=eq.'
        + encodeURIComponent(token) + '&select=data&limit=1', { key: KEY });
      const now = Array.isArray(fresh.body) && fresh.body[0] ? fresh.body[0].data : null;
      const acc = now && now.acceptance;
      const replay = action === 'accept' && acc && isSameAcceptance(acc, {
        customerName: body.customerName, totalIncGst: priced.totalIncGst,
        chosenSystemId: priced.chosenSystemId, selectedOptionIds: priced.selectedOptionIds
      });
      if (replay) {
        return res.status(200).json({ state: 'ok', repeat: true, status: now.status,
          acceptedTotal: acc.totalIncGst,
          selectedOptionIds: now.selectedOptionIds || [],
          chosenSystemId: now.chosenSystemId || null,
          totalIncGst: priced.totalIncGst, deposit: priced.deposit,
          message: 'This proposal was already accepted. Nothing was changed.' });
      }
      return res.status(409).json({ state: 'already_answered',
        message: 'This proposal was answered from another device a moment ago. Please reload '
          + 'to see what was recorded.',
        status: now ? now.status : null });
    }
    if (wrote.status >= 300) {
      return res.status(502).json({ error: 'store_failed',
        message: 'Your answer could not be saved. Nothing was changed.' });
    }

    return res.status(200).json({
      state: 'ok',
      status: next.status,
      // Echo back only what the page needs to update itself.
      acceptedTotal: next.acceptance ? next.acceptance.totalIncGst : null,
      selectedOptionIds: next.selectedOptionIds || [],
      chosenSystemId: next.chosenSystemId || null,
      totalIncGst: priced.totalIncGst,
      deposit: priced.deposit,
      quoteRevision: next.quoteRevision,
      offerFrozenAt: issue.offer.frozenAt,
      gstRate: issue.offer.gstRate
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
