// ─────────────────────────────────────────────────────────────────────────────
// READING A DESIGN OUT OF nac_designs
//
// One rule, in one place, because the last time it was written out three times
// it was written out wrong three times.
//
// The table (designer/schema.sql, and the same definition in
// production-setup.sql) is:
//
//     create table public.nac_designs (
//       id text primary key, ..., design text not null, ... );
//
// `design` is TEXT holding the DuctDesign as a JSON string — that is what
// designer/engines/store.mjs saveDesign writes and what loadDesign reads back.
//
// The three quote endpoints asked PostgREST for a column called `data`. There
// is no such column in either schema file, so against the real database the
// request came back 400 and issuing a quote could never succeed. The bug was
// invisible in development because every browser test stubs the REST call.
//
// A row is also accepted with `design` already parsed (some PostgREST setups
// and every test fixture hand back an object), and the legacy `data` shape is
// still read if it is ever encountered, so a project that did somehow store
// one is not stranded.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

/** The column list every caller should ask for. */
const DESIGN_SELECT = 'id,design,updated_at';

/**
 * @param {object|null} row a row from nac_designs
 * @returns {object|null} the DuctDesign, or null when there is not one
 */
function parseDesign(row) {
  if (!row || typeof row !== 'object') return null;

  const candidates = [row.design, row.data];
  for (const raw of candidates) {
    if (raw === null || raw === undefined || raw === '') continue;
    let value = raw;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (e) { continue; }
    }
    if (!value || typeof value !== 'object') continue;
    // A legacy row wrapped the design one level down.
    const design = (value.design && typeof value.design === 'object') ? value.design : value;
    // A design has rooms or an id; an empty object is not one.
    if (Object.keys(design).length === 0) continue;
    return design;
  }
  return null;
}

/** When the design row last changed, for the issued offer's audit trail. */
function designUpdatedAt(row) {
  if (!row || typeof row !== 'object') return null;
  const v = row.updated_at || row.updatedAt || null;
  return v ? String(v) : null;
}

module.exports = { DESIGN_SELECT, parseDesign, designUpdatedAt };
