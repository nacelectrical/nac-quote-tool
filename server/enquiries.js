// ─────────────────────────────────────────────────────────────────────────────
// /api/enquiries — THE SMALLEST USEFUL CHANGE IN THE PROJECT
//
// Nick, 8 November 2026: "Enquiries have no store of their own."
//
// `api/intake-submit.js` writes a row into nac_quotes with the customer's
// phone number and the AI sizing pack inside the free-text `notes` column, and
// nothing could read it back as a record. /dashboard.html said "could not be
// read" on its enquiry panel — accurately, because there was nothing to read.
//
// ── WHAT THIS ANSWERS ───────────────────────────────────────────────────────
//
//   GET  /api/enquiries            the open enquiries, newest first
//   POST /api/enquiries            link one to the assessment or quote that
//                                  came out of it
//
// ── THE OLD RECORDS ARE NOT LEFT BEHIND, AND NOT MIGRATED ───────────────────
//
// Every enquiry NAC has already taken is a nac_quotes row whose notes begin
// `INTAKE DRAFT`. This reads those in place, through
// `enquiryFromLegacyQuoteRow`, and marks them `legacy_quote_notes`. Nothing is
// rewritten, so there is no migration to get half way through, and applying
// the new table does not put NAC's history at risk. New enquiries land in
// `nac_enquiries`; the two lists are merged with the real table winning on a
// shared id.
//
// ── A TABLE THAT DOES NOT EXIST YET IS NOT A FAILURE ────────────────────────
//
// `nac_enquiries` ships in designer/enquiries-handovers-schema.sql and is NOT
// applied. Until it is, this endpoint serves the legacy rows and says which
// source it used. A read that genuinely FAILED is a different answer again:
// `available: false` and a null count, never an empty list. The ops
// assistant's briefing has the same rule, and the join lies at exactly the
// wrong moment if either side breaks it.
//
// ── WHO MAY READ IT ─────────────────────────────────────────────────────────
//
// NAC staff, technicians included: taking an enquiry and starting the
// assessment is their job. There are no costs or margins in an enquiry, so
// nothing here is owner-only. Customer contact details ARE here — that is what
// an enquiry mostly is — which is why it needs a sign-in and why the ops
// assistant's own view of the same records (quote.board) leaves them out.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { supa, tableMissing, readOk } = require('./pg.js');
const { requireCapability } = require('./roles.js');

const ENQUIRIES_TABLE = 'nac_enquiries';

let enginePromise = null;
function engine() {
  if (!enginePromise) enginePromise = import('../designer/engines/enquiry.mjs');
  return enginePromise;
}

const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();

/**
 * Read the enquiry table.
 *
 * @returns {Promise<{state:'ok'|'absent'|'failed', rows:Array}>}
 */
async function readTable(key, limit) {
  const mod = await engine();
  const r = await supa('/rest/v1/' + ENQUIRIES_TABLE + '?select=' + mod.ENQUIRY_SELECT
    + '&order=received_at.desc&limit=' + limit, { key });
  if (tableMissing(r)) return { state: 'absent', rows: [] };
  if (!readOk(r)) return { state: 'failed', rows: [] };
  return { state: 'ok', rows: r.body.map(mod.fromRow).filter(Boolean) };
}

/**
 * Read the enquiries that were written before the table existed.
 *
 * `notes=like.INTAKE DRAFT*` does the filtering in the database rather than
 * pulling every quote NAC has ever written across the wire.
 */
async function readLegacy(key, limit) {
  const mod = await engine();
  const r = await supa('/rest/v1/nac_quotes?select=id,client,notes,accepted,created_at,updated_at'
    + '&notes=like.' + encodeURIComponent(mod.LEGACY_MARKER + '*')
    + '&order=id.desc&limit=' + limit, { key });
  if (tableMissing(r)) return { state: 'absent', rows: [] };
  if (!readOk(r)) return { state: 'failed', rows: [] };
  return {
    state: 'ok',
    rows: r.body.filter(mod.isLegacyEnquiryRow).map(mod.enquiryFromLegacyQuoteRow).filter(Boolean)
  };
}

/**
 * Both sources, merged.
 *
 * `available` is false only when a source that EXISTS could not be read. Two
 * absent tables with nothing in them is a successful read of nothing, and says
 * count 0 — which is a real answer and is allowed to mean "no enquiries".
 */
async function collect(key, limit) {
  const [table, legacy] = await Promise.all([
    readTable(key, limit), readLegacy(key, limit)
  ]);

  if (table.state === 'failed' || legacy.state === 'failed') {
    return {
      available: false, enquiries: null, count: null,
      sources: { table: table.state, legacy: legacy.state },
      note: 'An enquiry source could not be read, so the count is unknown rather '
        + 'than zero.'
    };
  }

  // The real table wins: a legacy row that has since been written into
  // nac_enquiries must appear once, with its links, not twice.
  const byId = new Map();
  for (const e of legacy.rows) if (e.id) byId.set(e.id, e);
  for (const e of table.rows) if (e.id) byId.set(e.id, e);

  const all = [...byId.values()].sort(
    (a, b) => str(b.receivedAt).localeCompare(str(a.receivedAt)));

  return {
    available: true, enquiries: all, count: all.length,
    sources: { table: table.state, legacy: legacy.state },
    note: table.state === 'absent'
      ? 'nac_enquiries has not been created yet, so these are read out of the '
        + 'intake notes on nac_quotes. Apply '
        + 'designer/enquiries-handovers-schema.sql to give enquiries their own store.'
      : null
  };
}

/** Write one enquiry, link included. Used by the link operation. */
async function upsert(key, enquiry) {
  const mod = await engine();
  const row = mod.toRow(enquiry);
  const r = await supa('/rest/v1/' + ENQUIRIES_TABLE, {
    method: 'POST', key, body: [row],
    prefer: 'resolution=merge-duplicates,return=representation'
  });
  if (tableMissing(r)) return { ok: false, reason: 'table_absent' };
  if (r.status >= 300) return { ok: false, reason: 'write_failed', status: r.status };
  return { ok: true, row: Array.isArray(r.body) ? r.body[0] : null };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const mod = await engine();
  const { CAPABILITIES } = await import('../designer/engines/roles.mjs');

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!await requireCapability(req, res, CAPABILITIES.ASSESS, 'the enquiry list')) return;

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  // ── READ ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const q = req.query || {};
    const limit = Math.max(1, Math.min(500, parseInt(q.limit, 10) || 200));
    const result = await collect(KEY, limit);

    if (!result.available) {
      // 502 AND an explicit available:false. A caller that only looks at the
      // status still cannot mistake this for "no enquiries".
      return res.status(502).json({
        ok: false, error: 'enquiries_unreadable', available: false,
        enquiries: null, count: null, sources: result.sources, note: result.note
      });
    }

    const open = result.enquiries.filter(
      e => e.state === mod.ENQUIRY_STATE.NEW || e.state === mod.ENQUIRY_STATE.ASSESSING);

    return res.status(200).json({
      ok: true, available: true,
      /** The TRUE total, not the length of the list below. */
      count: result.count,
      openCount: open.length,
      enquiries: result.enquiries,
      sources: result.sources,
      note: result.note
    });
  }

  // ── LINK ──────────────────────────────────────────────────────────────
  //
  // The point of the whole exercise: an enquiry you can follow to the
  // assessment and the quote that came out of it. The builder calls this on
  // its first save against an intake, and the issue endpoint on the token.
  const body = req.body || {};
  const id = str(body.id);
  if (!id) return res.status(400).json({ error: 'id_required' });

  const link = body.link || body;
  const result = await collect(KEY, 500);
  if (!result.available) {
    return res.status(502).json({ ok: false, error: 'enquiries_unreadable',
      message: 'The enquiry could not be read, so it was not linked. Nothing was written.' });
  }

  const existing = result.enquiries.find(e => e.id === id) || null;
  if (!existing) return res.status(404).json({ error: 'enquiry_not_found', id });

  const next = mod.linkEnquiry(existing, {
    designId: link.designId, quoteId: link.quoteId, issuedToken: link.issuedToken,
    closedReason: link.closedReason
  });

  // A LINK IS NOT SILENTLY REPLACED. Two assessments against one enquiry is
  // either a mistake worth seeing or a second enquiry wearing the first one's
  // id, and overwriting hides both.
  if (next.conflicts.length) {
    return res.status(409).json({
      ok: false, error: 'link_conflict', id, conflicts: next.conflicts,
      message: 'This enquiry is already linked to something else. Nothing was changed.'
    });
  }

  const written = await upsert(KEY, next);
  if (!written.ok) {
    return res.status(written.reason === 'table_absent' ? 409 : 502).json({
      ok: false, error: written.reason,
      message: written.reason === 'table_absent'
        ? 'nac_enquiries does not exist yet, so a link cannot be stored. Apply '
          + 'designer/enquiries-handovers-schema.sql.'
        : 'The link was not written.'
    });
  }

  return res.status(200).json({ ok: true, id, state: next.state, links: next.links });
};

module.exports.collect = collect;
