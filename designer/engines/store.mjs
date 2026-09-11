// NAC AI HVAC DESIGNER — persistence.
//
// Reuses the storage the existing tool already relies on:
//   • Supabase `nac_settings`  (key/value)  — where Price Setup already writes
//                                             nac_brands_v4 / nac_ctrl_v4
//   • Supabase `nac_designs`   (optional)   — a dedicated table if NAC creates
//                                             it (see designer/schema.sql)
//   • Supabase `nac_quotes`    (existing)   — the quote the customer signs
//   • localStorage                          — offline fallback on the iPad
//
// If `nac_designs` does not exist the store transparently falls back to
// `nac_settings`, so nothing has to be migrated before the designer can be used.

const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
// A signed-in NAC user's token goes on every request, so the RLS policies in
// designer/rls.sql apply to them. Signed out, this falls back to the bare anon
// key — which, once RLS is applied, can no longer read designs or settings.
import { dbHeaders } from '../auth.mjs';
const H = () => dbHeaders();
const JH = () => ({ ...H(), 'Content-Type': 'application/json' });

const LS_PREFIX = 'nac_design_';
const SETTINGS_KEY_PREFIX = 'nac_design_';
export const SETTINGS_KEYS = {
  hvacSettings: 'nac_hvac_settings_v1',
  materialRates: 'nac_hvac_materials_v1',
  equipmentSpecs: 'nac_hvac_equipment_specs_v1',
  // The records the EXISTING quote tool already owns. Read only — the designer
  // never writes to these.
  brands: 'nac_brands_v4',
  brandsFallback: ['nac_brands_v3', 'nac_ducted_brands_v2'],
  controllers: 'nac_ctrl_v4',
  controllersFallback: ['nac_ctrl_v3']
};

let designsTableAvailable = null;   // null = untested, true/false once known

// ── nac_settings key/value (same shape the existing tool uses) ──────────────

export async function getSetting(key) {
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/nac_settings?key=eq.' + encodeURIComponent(key) + '&select=value', { headers: H() });
    // fetch resolves on a 4xx/5xx, so the status has to be read or a rejected
    // read looks like an empty result and quietly falls back to the device.
    if (r.ok) {
      const d = await r.json();
      if (d && d[0]) return d[0].value;
    }
  } catch (e) { /* fall through to local */ }
  try { return localStorage.getItem('nac_' + key); } catch (e) { return null; }
}

/**
 * Write a key/value setting.
 *
 * Returns TRUE only when the database accepted the write. Local storage is
 * written first so an iPad on a bad connection never loses work, but a local
 * write is not a save: it lives on that one device, and reporting it as saved
 * is how an estimator loses a job between the ute and the office.
 */
export async function setSetting(key, value) {
  try { localStorage.setItem('nac_' + key, value); } catch (e) { /* quota / private mode */ }
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/nac_settings', {
      method: 'POST',
      headers: { ...JH(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
    });
    if (r.ok) return true;
    lastStoreError = 'database returned ' + r.status;
    return false;
  } catch (e) {
    lastStoreError = 'could not reach the database: ' + e.message;
    return false;
  }
}

/** Why the last write did not reach the database, if it did not. */
let lastStoreError = null;
export function lastStorageError() { return lastStoreError; }

export async function getJson(key, fallback = null) {
  const v = await getSetting(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

export const setJson = (key, obj) => setSetting(key, JSON.stringify(obj));

/** Load the prices the existing Price Setup screen has already saved. */
export async function loadNacBrands() {
  for (const key of [SETTINGS_KEYS.brands, ...SETTINGS_KEYS.brandsFallback]) {
    const v = await getJson(key);
    if (v) return v;
  }
  return null;
}

export async function loadNacControllers() {
  for (const key of [SETTINGS_KEYS.controllers, ...SETTINGS_KEYS.controllersFallback]) {
    const v = await getJson(key);
    if (v) return v;
  }
  return null;
}

// ── Designs ────────────────────────────────────────────────────────────────

async function tryDesignsTable() {
  if (designsTableAvailable !== null) return designsTableAvailable;
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/nac_designs?select=id&limit=1', { headers: H() });
    designsTableAvailable = r.ok;
  } catch (e) { designsTableAvailable = false; }
  return designsTableAvailable;
}

function localKey(id) { return LS_PREFIX + id; }

export async function saveDesign(design) {
  const payload = { ...design, updatedAt: new Date().toISOString(), designId: design.designId || design.id };
  const json = JSON.stringify(payload);

  // Local first, so an iPad on a bad connection never loses a site visit.
  try { localStorage.setItem(localKey(payload.id), json); } catch (e) { /* ignore */ }
  try {
    const index = JSON.parse(localStorage.getItem(LS_PREFIX + 'index') || '[]')
      .filter(x => x.id !== payload.id);
    index.unshift({ id: payload.id, customer: payload.customer?.name || '', updatedAt: payload.updatedAt,
                    status: payload.status, quoteId: payload.quoteId || null });
    localStorage.setItem(LS_PREFIX + 'index', JSON.stringify(index.slice(0, 200)));
  } catch (e) { /* ignore */ }

  if (await tryDesignsTable()) {
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/nac_designs', {
        method: 'POST',
        headers: { ...JH(), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: payload.id,
          customer_name: payload.customer?.name || '',
          customer_address: payload.customer?.address || '',
          quote_id: payload.quoteId || null,
          job_id: payload.jobId || null,
          status: payload.status,
          design: json,
          updated_at: payload.updatedAt
        })
      });
      if (r.ok) return { ok: true, storage: 'nac_designs', synced: true };
      lastStoreError = 'nac_designs returned ' + r.status;
    } catch (e) { lastStoreError = 'could not reach nac_designs: ' + e.message; }
  }
  const ok = await setSetting(SETTINGS_KEY_PREFIX + payload.id, json);
  // `synced` is the only thing that means the work left this device.
  return { ok, synced: ok, storage: ok ? 'nac_settings' : 'local_only',
           error: ok ? null : lastStoreError };
}

export async function loadDesign(id) {
  if (await tryDesignsTable()) {
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/nac_designs?id=eq.' + encodeURIComponent(id) + '&select=design', { headers: H() });
      const d = await r.json();
      if (d && d[0]?.design) return JSON.parse(d[0].design);
    } catch (e) { /* fall through */ }
  }
  const v = await getSetting(SETTINGS_KEY_PREFIX + id);
  if (v) { try { return JSON.parse(v); } catch (e) { /* fall through */ } }
  try {
    const local = localStorage.getItem(localKey(id));
    if (local) return JSON.parse(local);
  } catch (e) { /* ignore */ }
  return null;
}

export async function listDesigns(limit = 50) {
  const out = new Map();
  if (await tryDesignsTable()) {
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/nac_designs?select=id,customer_name,status,quote_id,updated_at' +
        '&order=updated_at.desc&limit=' + limit, { headers: H() });
      const d = await r.json();
      (d || []).forEach(x => out.set(x.id, { id: x.id, customer: x.customer_name, status: x.status,
                                             quoteId: x.quote_id, updatedAt: x.updated_at, storage: 'nac_designs' }));
    } catch (e) { /* fall through */ }
  }
  try {
    JSON.parse(localStorage.getItem(LS_PREFIX + 'index') || '[]')
      .forEach(x => { if (!out.has(x.id)) out.set(x.id, { ...x, storage: 'local' }); });
  } catch (e) { /* ignore */ }
  return [...out.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
}

// ── Intake handoff ─────────────────────────────────────────────────────────

const DESIGN_NOTES_MARK = '--- NAC AI HVAC DESIGNER ---';

/**
 * Load the draft the intake form created, so a design can start from the
 * customer's own submission instead of re-keying it and re-uploading the plan.
 *
 * The intake writes a `nac_quotes` row whose notes look like:
 *     INTAKE DRAFT | 0400 000 000 | 12 Smith St
 *     <the AI sizing pack>
 *     PHOTOS:
 *     https://…/plan-…      <- the floor plan, labelled `plan` on upload
 *     https://…/photo-…
 */
export async function loadIntakeDraft(quoteId) {
  const row = await fetchQuote(quoteId);
  return row ? parseIntakeDraft(row) : null;
}

/** The parsing half of loadIntakeDraft, separated so it can be tested. */
export function parseIntakeDraft(row) {
  if (!row) return null;
  const notes = String(row.notes || '');
  const header = (notes.match(/^INTAKE DRAFT\s*\|([^\n]*)/) || [])[1] || '';
  const [phone = '', address = ''] = header.split('|').map(x => x.trim());

  const urls = (notes.split('PHOTOS:')[1] || '')
    .split('\n').map(x => x.trim()).filter(x => x.startsWith('http'));
  // /api/upload labels the floor plan `plan` and the site pictures `photo`.
  const planUrl = urls.find(u => /\/plan-/.test(decodeURIComponent(u))) || null;
  const photoUrls = urls.filter(u => u !== planUrl);

  // The intake's own sizing pack, minus the photo list.
  const pack = notes.split('PHOTOS:')[0].replace(/^INTAKE DRAFT[^\n]*\n?/, '').trim();

  let intakeOptions = [];
  try { intakeOptions = JSON.parse(row.line_items || '[]'); } catch (e) { /* ignore */ }

  return {
    quoteId: row.id,
    customer: { name: row.client || '', address, phone, email: '' },
    jobDescription: row.job_desc || 'Ducted AC Supply & Install',
    planUrl,
    photoUrls,
    intakePack: pack,
    intakeOptions,
    accepted: !!row.accepted
  };
}

// ── Quote handoff (PART 23) ────────────────────────────────────────────────

/**
 * Write the design into the EXISTING nac_quotes pipeline — the same row shape
 * admin.html writes and sign.html renders. No new quote format, no duplicate
 * margin logic.
 */
export async function pushDesignToQuote(design, { quoteId = null, notes = '' } = {}) {
  const id = quoteId || design.quoteId ||
    ('NAC-' + String(design.customer?.name || 'DESIGN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10) + '-' + Date.now());

  // When the design came from an intake draft, keep what the customer sent —
  // their photos and the intake sizing pack — and replace only the design block.
  let existingNotes = '';
  if (quoteId || design.quoteId) {
    const row = await fetchQuote(id);
    existingNotes = String(row?.notes || '').split(DESIGN_NOTES_MARK)[0].trim();
  }

  const payload = {
    id,
    client: design.customer?.name || '',
    job_desc: design.job?.description || 'Ducted AC Supply & Install',
    line_items: JSON.stringify(design.quoteLineItems || []),
    notes: [existingNotes, notes, DESIGN_NOTES_MARK, designNotesBlock(design)]
      .filter(Boolean).join('\n\n'),
    accepted: false
  };

  const r = await fetch(SUPA_URL + '/rest/v1/nac_quotes', {
    method: 'POST',
    headers: { ...JH(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error('Could not save the quote (HTTP ' + r.status + ')');
  return { quoteId: id, signUrl: location.origin + '/sign.html?q=' + encodeURIComponent(id) };
}

/** The design summary that travels with the quote, for whoever picks it up. */
export function designNotesBlock(d) {
  const s = d.systemLoad, u = d.selectedUnit;
  const lines = ['NAC AI HVAC DESIGNER — ' + d.id];
  // Every line is optional. This block is built on the way to creating the
  // customer's quote, so a design missing a stage — an older saved one, or one
  // pushed before every tab was filled in — must produce a SHORTER summary,
  // never an exception that loses the quote.
  if (s) lines.push('Conditioned area: ' + s.totalConditionedAreaSqM + ' m²  ·  Design load: ' + s.designKw + ' kW' +
    (s.legacy?.kw !== undefined ? '  (NAC 145 W/m² rule: ' + s.legacy.kw + ' kW)' : ''));
  if (u) lines.push('System: ' + u.brandName + ' ' + u.model + ' — ' + u.capacityKw + ' kW ' + u.phase);
  if (d.airflow) lines.push('Total airflow: ' + d.airflow.allocatedAirflowLs + ' L/s');
  if (d.outlets?.totals) lines.push('Outlets: ' + d.outlets.totals.total);
  if (d.zones) lines.push('Zones: ' + d.zones.zoneCount + (d.controller ? '  ·  ' + d.controller.name : ''));
  if (d.network) lines.push('Ductwork: ' + d.network.totalDuctLengthM + ' m');
  if (d.returnDesign?.returns) lines.push('Return: ' + d.returnDesign.returnCount + ' × ' +
    (d.returnDesign.returns[0]?.grilleSize || '') + ' @ ' + d.returnDesign.perReturnLs + ' L/s');
  if (d.pressure) lines.push('Estimated static: ' + d.pressure.estimatedRequirementPa + ' Pa' +
    (d.pressure.unitAvailableStaticPa ? ' of ' + d.pressure.unitAvailableStaticPa + ' Pa available' : '') +
    '  (' + d.pressure.disclaimer + ')');
  const crit = (d.warnings || []).filter(w => w.severity === 'CRITICAL');
  if (crit.length) lines.push('CRITICAL WARNINGS: ' + crit.map(w => w.code).join(', '));
  return lines.join('\n');
}

/** PART 23 — what would change if the quote were refreshed from this design. */
export async function fetchQuote(quoteId) {
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/nac_quotes?id=eq.' + encodeURIComponent(quoteId) + '&select=*', { headers: H() });
    const d = await r.json();
    return d && d[0] ? d[0] : null;
  } catch (e) { return null; }
}
