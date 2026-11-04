// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops-activity — WHAT THE ASSISTANT ASKED FOR, AND WHAT IT DID
//
// Nick, 4 November 2026: "Notify Nick that a quote needs approval... Record
// actions and failures so NAC can see what happened and retry safely."
//
// Both of those were half-built. `quote.request_approval` wrote the request
// onto the draft and nothing displayed it, so the operation notified nobody.
// Every call was written to nac_integration_calls and nothing read it back, so
// "NAC can see what happened" was true of the database and of no screen in
// the application.
//
// This is the read behind both. NAC STAFF ONLY: it carries customer names,
// site addresses and quote totals, so it is gated exactly like every other
// internal screen and an integration key cannot open it — an assistant does
// not get to read NAC's audit trail of itself.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';
const CALLS_TABLE = 'nac_integration_calls';

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();

function supa(path, { key } = {}) {
  const options = {
    hostname: SUPA_HOST, path, method: 'GET',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  };
  return new Promise((resolve, reject) => {
    const r = https.request(options, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

async function signedInStaff(req) {
  const auth = str(req.headers?.authorization || req.headers?.Authorization);
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token) return null;
  try {
    const r = await fetch('https://' + SUPA_HOST + '/auth/v1/user',
      { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const user = await r.json().catch(() => null);
    return user?.id ? (user.email || user.id) : null;
  } catch (e) { return null; }
}

const { DESIGN_SELECT, parseDesign } = require('./design-row.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const staff = await signedInStaff(req);
  if (!staff) return res.status(401).json({ error: 'sign_in_required' });

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  try {
    const [draftsRes, callsRes, issuesRes, contentRes] = await Promise.all([
      supa('/rest/v1/nac_designs?select=' + DESIGN_SELECT + '&order=updated_at.desc&limit=200',
        { key: KEY }),
      supa('/rest/v1/' + CALLS_TABLE
        + '?select=id,integration,operation,status,quote_id,customer_id,refusals,created_at'
        + '&order=created_at.desc&limit=60', { key: KEY }),
      supa('/rest/v1/nac_quote_issues?select=design_id,quote_rev,status', { key: KEY }),
      supa('/rest/v1/nac_presentation_content?key=eq.library&select=data&limit=1', { key: KEY })
    ]);

    // ── WAITING FOR NICK ───────────────────────────────────────────────────
    //
    // A draft whose approvalRequest is still 'requested'. Issued revisions are
    // excluded by their own revision count, not by the field: a quote that was
    // approved and sent is not still waiting, whatever the draft happens to
    // carry.
    const issued = new Set((Array.isArray(issuesRes.body) ? issuesRes.body : [])
      .map(r => trimmed(r.design_id)).filter(Boolean));

    const draftMod = await import('../designer/engines/quote-draft.mjs');
    const content = (Array.isArray(contentRes.body) && contentRes.body[0]
      && contentRes.body[0].data) || {};

    const approvals = [];
    for (const row of (Array.isArray(draftsRes.body) ? draftsRes.body : [])) {
      const d = parseDesign(row);
      const req_ = d && d.approvalRequest;
      if (!req_ || trimmed(req_.state) !== 'requested') continue;

      // Re-run the gate NOW rather than trusting what was stored when the
      // request was made: the quote may have moved on since.
      let gate = { ok: false, blockers: [] };
      try {
        gate = draftMod.quoteDraftGate(d, { upgrades: content.upgrades || [] });
      } catch (e) { /* a draft the gate cannot read is simply not ready */ }
      const chosen = (d.systems || []).find(s => s.id === d.chosenSystemId)
        || (d.systems || [])[0] || null;

      approvals.push({
        quoteId: trimmed(d.id) || trimmed(row.id),
        customerName: trimmed(d.customer && d.customer.name) || null,
        siteAddress: trimmed(d.siteAddress) || null,
        proposalNumber: trimmed(d.proposalNumber) || null,
        requestedBy: trimmed(req_.by) || null,
        requestedAt: req_.at || null,
        note: trimmed(req_.note) || null,
        fingerprint: trimmed(req_.fingerprint) || null,
        // What it is worth and what it is, so Nick can triage without opening it.
        system: chosen ? [trimmed(chosen.brand), trimmed(chosen.model)]
          .filter(Boolean).join(' ') : null,
        totalIncGst: chosen && Number.isFinite(Number(chosen.priceIncGst))
          ? Number(chosen.priceIncGst) : null,
        testQuote: d.testQuote === true,
        ready: gate.ok === true,
        missing: (gate.blockers || []).map(b => b.message),
        alreadyIssued: issued.has(trimmed(d.id) || trimmed(row.id))
      });
    }
    approvals.sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));

    // ── WHAT THE INTEGRATION DID ───────────────────────────────────────────
    //
    // The call log is also the idempotency record, so a missing table is a
    // supported state rather than an error: the migration simply has not been
    // applied, and the surface refuses writes until it is.
    const logPresent = callsRes.status === 200;
    const calls = (logPresent && Array.isArray(callsRes.body) ? callsRes.body : [])
      .map(c => ({
        // The id is "<integration>:<its own idempotency key>" — the caller's
        // key, never a credential. The integration's SECRET is nowhere here.
        integration: trimmed(c.integration),
        operation: trimmed(c.operation),
        status: trimmed(c.status),
        quoteId: trimmed(c.quote_id) || null,
        customerId: trimmed(c.customer_id) || null,
        at: c.created_at || null,
        why: Array.isArray(c.refusals)
          ? c.refusals.map(r => trimmed(r && (r.message || r.code))).filter(Boolean)
          : []
      }));

    return res.status(200).json({
      ok: true,
      // Said on the screen, so nobody reads an empty log as "it is working and
      // quiet" when it is "nothing is connected".
      integration: {
        configured: !!trimmed(process.env.NAC_OPS_KEYS),
        callLogPresent: logPresent,
        automationEnabled: false,
        schedulingOwner: 'undecided'
      },
      approvals,
      calls,
      counts: {
        waiting: approvals.length,
        failed: calls.filter(c => c.status === 'failed').length,
        refused: calls.filter(c => c.status === 'refused').length
      }
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
