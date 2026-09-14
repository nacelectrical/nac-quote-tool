// NAC — reading and writing customers and jobs.
//
// The tables in designer/crm-schema.sql are OPTIONAL. This probes for them once
// and, if they are not there, falls back to the existing nac_settings key/value
// store — the same posture the designer already takes with nac_designs. So the
// customer and job records work before anyone has run any SQL, and get faster
// and searchable once the tables exist.
//
// Every write reports whether the DATABASE accepted it. A write that only
// reached the device is not a save, and saying otherwise is how a customer
// record is lost between the ute and the office.

import { dbHeaders } from '../auth.mjs';
import { getJson, setJson } from './store.mjs';
import { normaliseCustomer, normaliseJob } from './crm.mjs';

const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
const H = () => dbHeaders();
const JH = () => ({ ...H(), 'Content-Type': 'application/json' });

export const FALLBACK_KEYS = { customers: 'nac_customers_v1', jobs: 'nac_jobs_v1' };

const available = { nac_customers: null, nac_jobs: null };

/** Does the table exist and can this user read it? Asked once per table. */
export async function tableAvailable(table) {
  if (available[table] !== null) return available[table];
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/' + table + '?select=id&limit=1', { headers: H() });
    available[table] = r.ok;
  } catch (e) { available[table] = false; }
  return available[table];
}

/** For tests: forget what was probed. */
export function _resetAvailability() { available.nac_customers = null; available.nac_jobs = null; }

const toRowCustomer = (c) => ({
  id: c.id, name: c.name, email: c.email || null, phone: c.phone || null,
  address: c.address || null, notes: c.notes || null, updated_at: new Date().toISOString()
});
const fromRowCustomer = (r) => normaliseCustomer({
  id: r.id, name: r.name, email: r.email, phone: r.phone, address: r.address,
  notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at
});
const toRowJob = (j) => ({
  id: j.id, customer_id: j.customerId || null, description: j.description || null,
  site_address: j.siteAddress || null, status: j.status || 'open',
  servicem8_job_id: j.servicem8JobId || null, notes: j.notes || null,
  updated_at: new Date().toISOString()
});
const fromRowJob = (r) => normaliseJob({
  id: r.id, customerId: r.customer_id, description: r.description, siteAddress: r.site_address,
  status: r.status, servicem8JobId: r.servicem8_job_id, notes: r.notes,
  createdAt: r.created_at, updatedAt: r.updated_at
});

// ── Reading ────────────────────────────────────────────────────────────────

export async function listCustomers({ limit = 500 } = {}) {
  if (await tableAvailable('nac_customers')) {
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/nac_customers?select=*&order=name.asc&limit=' + limit,
        { headers: H() });
      if (r.ok) return (await r.json() || []).map(fromRowCustomer);
    } catch (e) { /* fall through */ }
  }
  return ((await getJson(FALLBACK_KEYS.customers, [])) || []).map(normaliseCustomer);
}

export async function listJobs({ customerId = null, limit = 500 } = {}) {
  if (await tableAvailable('nac_jobs')) {
    try {
      const q = '?select=*&order=updated_at.desc&limit=' + limit +
        (customerId ? '&customer_id=eq.' + encodeURIComponent(customerId) : '');
      const r = await fetch(SUPA_URL + '/rest/v1/nac_jobs' + q, { headers: H() });
      if (r.ok) return (await r.json() || []).map(fromRowJob);
    } catch (e) { /* fall through */ }
  }
  const all = ((await getJson(FALLBACK_KEYS.jobs, [])) || []).map(normaliseJob);
  return customerId ? all.filter(j => j.customerId === customerId) : all;
}

// ── Writing ────────────────────────────────────────────────────────────────

/** @returns {{ok:boolean, synced:boolean, error:string|null, customer:Object}} */
export async function saveCustomer(customer) {
  const c = normaliseCustomer(customer);
  if (!c.id) return { ok: false, synced: false, error: 'A customer needs an id.', customer: c };

  if (await tableAvailable('nac_customers')) {
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/nac_customers', {
        method: 'POST',
        headers: { ...JH(), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(toRowCustomer(c))
      });
      if (r.ok) return { ok: true, synced: true, error: null, customer: c };
      return { ok: false, synced: false, customer: c,
               error: 'the database returned ' + r.status + ' ' + (await r.text()).slice(0, 160) };
    } catch (e) {
      return { ok: false, synced: false, error: 'could not reach the database: ' + e.message, customer: c };
    }
  }
  // Fallback store. setJson reports whether the database took it.
  const all = await listCustomers();
  const next = [...all.filter(x => x.id !== c.id), c];
  const synced = await setJson(FALLBACK_KEYS.customers, next);
  return { ok: true, synced, customer: c,
           error: synced ? null : 'saved on this device only — it has not reached the database' };
}

export async function saveJob(job) {
  const j = normaliseJob(job);
  if (!j.id) return { ok: false, synced: false, error: 'A job needs an id.', job: j };

  if (await tableAvailable('nac_jobs')) {
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/nac_jobs', {
        method: 'POST',
        headers: { ...JH(), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(toRowJob(j))
      });
      if (r.ok) return { ok: true, synced: true, error: null, job: j };
      return { ok: false, synced: false, job: j,
               error: 'the database returned ' + r.status + ' ' + (await r.text()).slice(0, 160) };
    } catch (e) {
      return { ok: false, synced: false, error: 'could not reach the database: ' + e.message, job: j };
    }
  }
  const all = await listJobs();
  const next = [...all.filter(x => x.id !== j.id), j];
  const synced = await setJson(FALLBACK_KEYS.jobs, next);
  return { ok: true, synced, job: j,
           error: synced ? null : 'saved on this device only — it has not reached the database' };
}

/**
 * Point an existing quote or design row at a customer and a job.
 *
 * This is a PATCH of two nullable columns and nothing else — no other field on
 * the row is sent, so nothing already there can be overwritten.
 */
export async function linkRow(table, id, { customerId = null, jobId = null } = {}) {
  if (!id) return { ok: false, error: 'no row id' };
  const patch = {};
  if (customerId) patch.customer_id = customerId;
  if (jobId) patch.job_ref = jobId;
  if (!Object.keys(patch).length) return { ok: true, skipped: true };
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH', headers: JH(), body: JSON.stringify(patch)
    });
    if (r.ok) return { ok: true };
    return { ok: false, error: table + ' ' + id + ': HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120) };
  } catch (e) {
    return { ok: false, error: table + ' ' + id + ': ' + e.message };
  }
}

/** Everything the migration needs to read, in one call. */
export async function loadMigrationSources({ limit = 1000 } = {}) {
  const out = { quotes: [], designs: [], customers: [], jobs: [], errors: [] };

  try {
    const r = await fetch(SUPA_URL + '/rest/v1/nac_quotes?select=id,client,job_desc&limit=' + limit,
      { headers: H() });
    if (r.ok) out.quotes = await r.json() || [];
    else out.errors.push('nac_quotes: HTTP ' + r.status);
  } catch (e) { out.errors.push('nac_quotes: ' + e.message); }

  try {
    const r = await fetch(SUPA_URL + '/rest/v1/nac_designs?select=id,customer_name,customer_address,job_id,design&limit=' + limit,
      { headers: H() });
    if (r.ok) {
      out.designs = (await r.json() || []).map(row => {
        let design = null;
        try { design = JSON.parse(row.design); } catch (e) { /* a row we cannot read is still a row */ }
        return { ...row, design };
      });
    } else out.errors.push('nac_designs: HTTP ' + r.status);
  } catch (e) { out.errors.push('nac_designs: ' + e.message); }

  out.customers = await listCustomers();
  out.jobs = await listJobs();
  return out;
}

/**
 * Apply a plan from crm.mjs. Creates and fills in customers and jobs, then
 * links the existing rows.
 *
 * Stops at the first failure and reports exactly how far it got, so a half-run
 * migration can be re-run: the plan is idempotent, so a second pass picks up
 * only what is still missing.
 */
export async function applyPlan(plan, { onProgress = null } = {}) {
  const done = { customers: 0, jobs: 0, links: 0 };
  const errors = [];
  const step = (what) => { if (onProgress) onProgress(what, done); };

  for (const c of plan.newCustomers) {
    const r = await saveCustomer(c);
    if (!r.ok || !r.synced) { errors.push('customer ' + c.id + ': ' + (r.error || 'not synced')); return { done, errors }; }
    done.customers++; step('customer ' + c.id);
  }
  for (const u of plan.customerUpdates) {
    const r = await saveCustomer(u.fields);
    if (!r.ok || !r.synced) { errors.push('customer ' + u.id + ': ' + (r.error || 'not synced')); return { done, errors }; }
    done.customers++; step('customer ' + u.id);
  }
  for (const j of plan.newJobs) {
    const r = await saveJob(j);
    if (!r.ok || !r.synced) { errors.push('job ' + j.id + ': ' + (r.error || 'not synced')); return { done, errors }; }
    done.jobs++; step('job ' + j.id);
  }
  for (const u of plan.jobUpdates) {
    const r = await saveJob(u.fields);
    if (!r.ok || !r.synced) { errors.push('job ' + u.id + ': ' + (r.error || 'not synced')); return { done, errors }; }
    done.jobs++; step('job ' + u.id);
  }
  for (const l of plan.links) {
    const r = await linkRow(l.table, l.id, { customerId: l.customerId, jobId: l.jobId });
    if (!r.ok) { errors.push(r.error); return { done, errors }; }
    done.links++; step('link ' + l.table + ' ' + l.id);
  }
  return { done, errors };
}
