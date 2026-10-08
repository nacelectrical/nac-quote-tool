// ─────────────────────────────────────────────────────────────────────────────
// GET /api/quote-list — THE QUOTES NAC HAS SENT
//
// Nick: "Also need to have the spot for our quotes to be saved in the portal."
//
// They WERE being saved — nac_quote_issues has held them since quotes could be
// issued. What there was no way to do was LOOK at them. An estimator who
// issued a link had no list of what was out, who had opened it, who had
// accepted, at what price, or whether the ServiceM8 job came through. The row
// existed and nobody could see it.
//
// NAC STAFF ONLY. Every row here is a customer's name, their address and the
// price they were quoted. The token is deliberately included — it is the link
// NAC sends — which is precisely why this endpoint requires a sign-in and the
// table has no anon policy at all.
//
// THE FROZEN OFFER IS NOT RETURNED. It is the whole proposal for every system
// on offer, and a list of forty quotes would be tens of megabytes. The summary
// is read off the record; the proposal itself is read by opening the link.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');
const { requireStaff } = require('./staff-auth.js');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';

function supa(path, key) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: SUPA_HOST, path, method: 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', () => reject(new Error('upstream_unavailable')));
    r.end();
  });
}

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * One row of the list. Everything an estimator needs to know at a glance, and
 * nothing a customer's browser should ever see.
 */
function summarise(row) {
  const d = row.data || {};
  const c = d.customer || {};
  const a = d.acceptance || null;
  const sm8 = d.servicem8 || null;
  const offer = d.offer || null;

  return {
    token: d.token || row.token,
    designId: d.designId || row.design_id || null,
    proposalNumber: str(d.proposalNumber) || null,
    revision: n(d.quoteRevision) ?? n(row.quote_rev) ?? 1,
    status: str(row.status) || str(d.status) || 'issued',

    customerName: str(c.name) || null,
    siteAddress: str((d.job || {}).siteAddress) || str(c.address) || null,

    issuedAt: row.issued_at || d.issuedAt || null,
    issuedBy: str(d.issuedBy) || null,
    expiresAt: row.expires_at || d.expiresAt || null,
    firstViewedAt: d.firstViewedAt || null,
    lastViewedAt: d.lastViewedAt || null,
    viewCount: n(d.viewCount) ?? 0,

    /** What it was issued at, and what was actually signed for. */
    quotedTotalIncGst: n(d.totalIncGst),
    acceptedTotalIncGst: a ? n(a.totalIncGst) : null,
    acceptedBy: a ? str(a.customerName) || null : null,
    acceptedAt: a ? a.acceptedAt || null : null,
    signed: !!(a && a.signature),
    chosenSystemId: str(d.chosenSystemId) || null,
    selectedOptionIds: Array.isArray(d.selectedOptionIds) ? d.selectedOptionIds : [],

    gstRate: offer ? n(offer.gstRate) : null,
    /** A quote issued before offers were frozen cannot be reopened at all. */
    hasIssuedCopy: !!(offer && offer.schema),

    supersedes: str(d.supersedes) || null,
    supersededBy: str(d.supersededBy) || null,

    // Whether the booking actually reached ServiceM8, said plainly, because
    // "accepted" and "in the calendar" are different facts.
    servicem8: sm8 ? {
      ok: sm8.ok === true,
      jobId: str(sm8.generatedJobId) || null,
      jobUuid: str(sm8.jobUuid) || null,
      reason: sm8.ok === true ? null : (str(sm8.reason) || 'unknown'),
      message: sm8.ok === true ? null : (str(sm8.message) || null),
      at: sm8.at || null
    } : null
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!await requireStaff(req, res, 'the list of issued quotes')) return;

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  const q = req.query || {};
  const limit = Math.max(1, Math.min(200, parseInt(q.limit, 10) || 100));
  const status = str(q.status).trim();

  try {
    const filter = status && status !== 'all'
      ? '&status=eq.' + encodeURIComponent(status) : '';
    const r = await supa('/rest/v1/nac_quote_issues?select=token,design_id,quote_rev,status,'
      + 'issued_at,expires_at,responded_at,data&order=issued_at.desc&limit=' + limit + filter, KEY);

    if (r.status === 404) {
      return res.status(502).json({ error: 'issues_table_missing',
        message: 'nac_quote_issues does not exist yet. Apply '
          + 'designer/quote-presentation-schema.sql — open /setup.html.' });
    }
    if (r.status >= 300 || !Array.isArray(r.body)) {
      return res.status(502).json({ error: 'read_failed' });
    }

    const quotes = r.body.map(summarise);
    const accepted = quotes.filter(x => x.status === 'accepted');
    return res.status(200).json({
      ok: true,
      quotes,
      counts: {
        total: quotes.length,
        issued: quotes.filter(x => x.status === 'issued' || x.status === 'viewed').length,
        accepted: accepted.length,
        declined: quotes.filter(x => x.status === 'declined').length,
        superseded: quotes.filter(x => x.status === 'superseded').length,
        // The number worth a banner: accepted, but not in ServiceM8.
        notInServiceM8: accepted.filter(x => !x.servicem8 || !x.servicem8.ok).length
      },
      acceptedValueIncGst: Math.round(
        accepted.reduce((s, x) => s + (x.acceptedTotalIncGst || 0), 0) * 100) / 100
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};

module.exports.summarise = summarise;
