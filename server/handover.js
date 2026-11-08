// ─────────────────────────────────────────────────────────────────────────────
// /api/handover — TURNING A SIGNATURE INTO SOMETHING THE CREW CAN WORK FROM
//
// ── FIRST, THE CONTRADICTION IN MY OWN INSPECTION REPORT ────────────────────
//
// docs/inspection-quote-tool.md says, in section 3: "Handovers are prepared
// and stored locally. `sync.state` is `prepared`; it never claims to be
// synced." And in section 4: "Handovers have no endpoint. engines/handover.mjs
// builds and validates them; nothing persists or lists them yet."
//
// Both sentences cannot be true and the second one was. `handover.mjs` is a
// pure function: give it a frozen issued record and it returns a handover
// object. NOTHING called it. There was no table, no endpoint, no row, and
// nowhere a prepared handover could live — /dashboard.html passed
// `handovers: null` to the board and the board correctly reported the source
// as unreadable.
//
// "Stored locally" was wrong, and it was wrong in the flattering direction:
// it reads as "stored, just not synced yet", when the truth was "not stored".
// The engine was right, its tests were right, and the thing was unreachable.
// That is the whole finding, and this file is the fix.
//
// ── WHAT THIS ANSWERS ───────────────────────────────────────────────────────
//
//   GET  /api/handover                  the handovers, newest first
//   POST /api/handover {action:prepare} prepare one from an ACCEPTED revision
//   POST /api/handover {action:update}  confirm a fact, close a site check
//
// ── ONE HANDOVER PER ACCEPTED REVISION, AND NOT TWO ─────────────────────────
//
// The id is `<token>:<revision>`, so a second revision of the same quote gets
// its own handover and a repeated prepare gets the FIRST one back with
// `repeat: true` — the record, unchanged, confirmations intact. An acceptance
// retry must not wipe a confirmed deposit, and the customer page does retry:
// `quote-respond` has carried replay detection since acceptance existed and
// this follows the same rule. The database holds the primary key as well, so
// the guarantee does not depend on this code winning a race with itself.
//
// ── SERVICEM8 IS NOT CALLED FROM HERE ───────────────────────────────────────
//
// Nick, 8 November 2026: "Do not enable ServiceM8 writes in this task." So
// there is no sync operation in this file at all — not a disabled one, not one
// behind a flag. `sync.state` stays `prepared` and the record says "Prepared
// locally. Not sent to ServiceM8." The one function that can ever write
// `synced` is `recordSync`, and it refuses without a real job id.
//
// ── THE DEPOSIT IS THE ONE OWNERS-ONLY FACT ─────────────────────────────────
//
// A technician can confirm that the equipment is on site and that a date is
// agreed, because they are the person who knows. A deposit is money and is
// confirmed against Xero or the bank, so it needs the owner capability. Either
// way a confirmation with no source recorded is demoted to unknown by the
// engine — on an edit exactly as on creation.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { supa, tableMissing, readOk } = require('./pg.js');
const { requireCapability, whoIs } = require('./roles.js');
const { DESIGN_SELECT, parseDesign } = require('./design-row.js');

const TABLE = 'nac_handovers';

let hoPromise = null;
let rolesPromise = null;
const handoverEngine = () => (hoPromise = hoPromise
  || import('../designer/engines/handover.mjs'));
const rolesEngine = () => (rolesPromise = rolesPromise
  || import('../designer/engines/roles.mjs'));

const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const SELECT = 'id,quote_token,revision,design_id,state,sync_state,external_id,'
  + 'ready_to_book,prepared_by,prepared_at,updated_at,data';

/** Record → row. `data` holds the handover itself; the columns are for reading. */
async function toRow(h) {
  const mod = await handoverEngine();
  return {
    id: h.id,
    quote_token: h.quoteToken,
    revision: h.revision,
    design_id: h.designId,
    state: mod.handoverStage(h),
    sync_state: (h.sync || {}).state || mod.HANDOVER_STATE.PREPARED,
    external_id: (h.sync || {}).externalId || null,
    ready_to_book: h.readyToBook === true,
    prepared_by: h.preparedBy,
    prepared_at: h.preparedAt,
    updated_at: h.updatedAt || h.preparedAt,
    data: h
  };
}

function fromRow(row) {
  if (!row) return null;
  let d = row.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
  return (d && typeof d === 'object') ? d : null;
}

/** @returns {Promise<{state:'ok'|'absent'|'failed', rows:Array}>} */
async function readAll(key, limit = 200) {
  const r = await supa('/rest/v1/' + TABLE + '?select=' + SELECT
    + '&order=prepared_at.desc&limit=' + limit, { key });
  if (tableMissing(r)) return { state: 'absent', rows: [] };
  if (!readOk(r)) return { state: 'failed', rows: [] };
  return { state: 'ok', rows: r.body.map(fromRow).filter(Boolean) };
}

async function readOne(key, id) {
  const r = await supa('/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id)
    + '&select=' + SELECT + '&limit=1', { key });
  if (tableMissing(r)) return { state: 'absent', row: null };
  if (!readOk(r)) return { state: 'failed', row: null };
  return { state: 'ok', row: r.body.length ? fromRow(r.body[0]) : null };
}

async function write(key, h) {
  const row = await toRow(h);
  const r = await supa('/rest/v1/' + TABLE, {
    method: 'POST', key, body: [row],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  if (tableMissing(r)) return { ok: false, reason: 'table_absent' };
  if (r.status >= 300) return { ok: false, reason: 'write_failed', status: r.status };
  return { ok: true };
}

/**
 * The site checks the assessment raised, recomputed from the stored draft.
 *
 * They are NOT part of the frozen offer and must not be: the offer is what the
 * customer was shown, and "a bedroom has no dimension on file" is NAC's
 * problem, not a term of sale. So they are read off the design at prepare
 * time, through `sizingReadiness()` — the same notes the sizing step shows the
 * estimator, which until now went no further than that screen. The crew who
 * turn up to install never saw them.
 *
 * A draft that cannot be read yields NO site checks and says so, rather than
 * an empty list that reads as "nothing to check".
 */
async function siteChecksFor(key, designId) {
  if (!designId) return { checks: [], read: false, why: 'This revision has no design id.' };
  const r = await supa('/rest/v1/nac_designs?id=eq.' + encodeURIComponent(designId)
    + '&select=' + DESIGN_SELECT + '&limit=1', { key });
  if (!readOk(r) || !r.body.length) {
    return { checks: [], read: false,
             why: 'The design could not be read, so no site checks were carried over.' };
  }
  const design = parseDesign(r.body[0]);
  if (!design) {
    return { checks: [], read: false, why: 'The design row held nothing readable.' };
  }
  try {
    const [sizingMod, settingsMod, hoMod] = await Promise.all([
      import('../designer/engines/plan-sizing.mjs'),
      import('../designer/engines/settings.mjs'),
      handoverEngine()
    ]);
    const sizing = sizingMod.preliminarySizing(design.rooms || [], {
      settings: settingsMod.DEFAULT_SETTINGS,
      method: design.sizing?.method,
      override: design.sizing?.override || null,
      printedFloorAreaSqM: design.plan?.printedFloorAreaSqM || null
    });
    return { checks: hoMod.siteChecksFromReadiness(sizingMod.sizingReadiness(sizing)),
             read: true, why: null };
  } catch (e) {
    return { checks: [], read: false, why: 'The sizing could not be recomputed.' };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const { CAPABILITIES } = await rolesEngine();
  const who = await requireCapability(req, res, CAPABILITIES.PREPARE_HANDOVER, 'handovers');
  if (!who) return;

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  const mod = await handoverEngine();
  const rolesMod = await rolesEngine();

  // ── READ ──────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const limit = Math.max(1, Math.min(500, parseInt((req.query || {}).limit, 10) || 200));
    const all = await readAll(KEY, limit);
    if (all.state === 'failed') {
      return res.status(502).json({ ok: false, error: 'handovers_unreadable',
        available: false, handovers: null, count: null,
        note: 'The handover table could not be read, so the count is unknown rather than zero.' });
    }
    if (all.state === 'absent') {
      // NOT an error and NOT an empty list pretending to be an answer. The
      // table is a deployment step and the caller is told which one.
      return res.status(200).json({
        ok: true, available: false, handovers: null, count: null,
        error: 'handovers_table_missing',
        note: 'nac_handovers does not exist yet. Apply '
          + 'designer/enquiries-handovers-schema.sql. Until then no handover can be '
          + 'stored, and this reports unknown rather than none.'
      });
    }
    return res.status(200).json({
      ok: true, available: true, count: all.rows.length,
      handovers: all.rows.map(h => ({ ...h, stage: mod.handoverStage(h) }))
    });
  }

  const body = req.body || {};
  const action = str(body.action) || 'prepare';

  // ── PREPARE ───────────────────────────────────────────────────────────
  if (action === 'prepare') {
    const token = str(body.token);
    if (!token) return res.status(400).json({ error: 'token_required' });

    const issued = await supa('/rest/v1/nac_quote_issues?token=eq.'
      + encodeURIComponent(token) + '&select=token,design_id,quote_rev,status,data&limit=1',
      { key: KEY });
    if (!readOk(issued) || !issued.body.length) {
      return res.status(404).json({ error: 'issued_revision_not_found', token });
    }
    const row = issued.body[0];
    const record = row.data || {};
    const revision = n(row.quote_rev) ?? n(record.quoteRevision) ?? 1;

    // A HANDOVER IS A CONSEQUENCE OF AN ACCEPTANCE. Preparing one for a quote
    // nobody has accepted would put a job in the crew's list on the strength
    // of a quote that is still out.
    if (row.status !== 'accepted' || !record.acceptance) {
      return res.status(409).json({
        error: 'not_accepted',
        message: 'This revision has not been accepted, so there is nothing to hand '
          + 'over. Its status is "' + str(row.status) + '".'
      });
    }

    const id = token + ':' + revision;
    const found = await readOne(KEY, id);
    if (found.state === 'failed') {
      return res.status(502).json({ ok: false, error: 'handovers_unreadable',
        message: 'The handover table could not be read, so nothing was written — a '
          + 'second handover might already exist.' });
    }
    // ── THE DUPLICATE RULE ──────────────────────────────────────────
    // The existing record, exactly as it stands. Confirmations are not reset,
    // site checks are not reopened and the prepared-by name is not replaced.
    if (found.row) {
      return res.status(200).json({
        ok: true, repeat: true, id,
        handover: { ...found.row, stage: mod.handoverStage(found.row) },
        message: 'A handover already exists for this accepted revision. It was returned '
          + 'unchanged.'
      });
    }

    const checks = await siteChecksFor(KEY, row.design_id || record.designId);
    const handover = mod.buildHandover(
      { ...record, token, quoteRevision: revision, designId: row.design_id || record.designId },
      { siteChecks: checks.checks, access: str(body.access), preparedBy: who.email }
    );

    const written = await write(KEY, handover);
    if (!written.ok) {
      return res.status(written.reason === 'table_absent' ? 409 : 502).json({
        ok: false, error: written.reason,
        message: written.reason === 'table_absent'
          ? 'nac_handovers does not exist yet, so the handover was NOT stored. Apply '
            + 'designer/enquiries-handovers-schema.sql.'
          : 'The handover was not stored.',
        /** Shown anyway, so the work is not lost while the table is missing. */
        handover
      });
    }

    return res.status(201).json({
      ok: true, repeat: false, id,
      handover: { ...handover, stage: mod.handoverStage(handover) },
      siteChecksCarriedOver: checks.read ? checks.checks.length : null,
      siteChecksNote: checks.read ? null : checks.why
    });
  }

  // ── UPDATE ────────────────────────────────────────────────────────────
  if (action === 'update') {
    const id = str(body.id);
    if (!id) return res.status(400).json({ error: 'id_required' });

    const found = await readOne(KEY, id);
    if (found.state === 'failed') {
      return res.status(502).json({ ok: false, error: 'handovers_unreadable' });
    }
    if (found.state === 'absent' || !found.row) {
      return res.status(404).json({ error: 'handover_not_found', id });
    }

    // Money needs the owner. Equipment and the date do not: the person who
    // knows whether the unit is on site is the person who is on site.
    if (body.deposit !== undefined && body.deposit !== null
        && !rolesMod.can(who.role, CAPABILITIES.CONFIRM_DEPOSIT)) {
      return res.status(403).json({
        error: 'role_not_permitted', required: CAPABILITIES.CONFIRM_DEPOSIT, role: who.role,
        message: 'A deposit is confirmed against the payment, so only the business owner '
          + 'may record it. The equipment and the installation date are yours to confirm.'
      });
    }

    const next = mod.updateHandover(found.row, {
      deposit: body.deposit, equipment: body.equipment, scheduling: body.scheduling,
      siteChecks: body.siteChecks, access: body.access, attachments: body.attachments,
      by: who.email
    });

    const written = await write(KEY, next);
    if (!written.ok) {
      return res.status(502).json({ ok: false, error: written.reason,
        message: 'The change was not stored.' });
    }
    return res.status(200).json({
      ok: true, id,
      handover: { ...next, stage: mod.handoverStage(next) },
      /** Said plainly, because a demotion is easy to miss. */
      demoted: ['deposit', 'equipment', 'scheduling'].filter(k =>
        body[k] && str(body[k].state) === mod.CONFIRMATION.CONFIRMED
        && next[k].state !== mod.CONFIRMATION.CONFIRMED)
    });
  }

  return res.status(400).json({ error: 'unknown_action', action,
    message: 'Known actions: prepare, update. There is deliberately no sync action — '
      + 'ServiceM8 writes are not enabled.' });
};

module.exports.readAll = readAll;
