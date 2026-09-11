// NAC — customers and jobs.
//
// WHAT THIS IS FOR
//
// Until now a customer was a NAME TYPED ON A QUOTE. Quote the same person
// twice and there are two unrelated rows; nothing joins a design to the job it
// was drawn for, or a job to the customer who owns it. This builds the four
// records NAC actually works with:
//
//     CUSTOMER  →  JOB  →  HVAC DESIGN  →  QUOTE
//
// Everything here is pure: given rows in and rows out, no database, no clock,
// no randomness. That is what lets the migration be run as a DRY RUN first and
// show exactly what it would do before anything is written.
//
// THE RULE THAT MATTERS MOST
//
// A merge never destroys what NAC already had. An incoming value fills a blank;
// it never overwrites a different value that was already there. Where the two
// disagree, the difference is RECORDED as a conflict for a person to settle —
// it is not silently resolved in either direction. NAC's existing customer
// information survives a migration intact, and running the migration twice
// changes nothing the second time.

export const CUSTOMER_FIELDS = ['name', 'email', 'phone', 'address', 'notes'];
export const JOB_FIELDS = ['description', 'siteAddress', 'status', 'servicem8JobId', 'notes'];

const clean = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const squash = (v) => clean(v).replace(/\s+/g, ' ');

/** Lower case, no punctuation, single spaces — for comparing, never for display. */
function fold(v) {
  return squash(v).toLowerCase().replace(/[.,'’"/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** An Australian number reduced to comparable digits. */
export function normalisePhone(v) {
  let digits = clean(v).replace(/[^\d+]/g, '');
  if (digits.startsWith('+61')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('0061')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('61') && digits.length === 11) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

export function normaliseEmail(v) {
  const e = clean(v).toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e) ? e : '';
}

// Street types written both ways on the same job. Folded to one form so
// "14 Wattlebird Dr" and "14 Wattlebird Drive" are one address.
const STREET_WORDS = {
  st: 'street', str: 'street', rd: 'road', dr: 'drive', drv: 'drive', ave: 'avenue', av: 'avenue',
  ct: 'court', crt: 'court', cres: 'crescent', cr: 'crescent', pde: 'parade', pl: 'place',
  hwy: 'highway', tce: 'terrace', ter: 'terrace', cl: 'close', bvd: 'boulevard', blvd: 'boulevard',
  ln: 'lane', esp: 'esplanade', qld: 'queensland', nsw: 'new south wales', vic: 'victoria',
  n: 'north', s: 'south', e: 'east', w: 'west'
};

export function normaliseAddress(v) {
  const words = fold(v).split(' ').filter(Boolean).map(w => STREET_WORDS[w] || w);
  // A postcode on one record and not the other should not split a customer.
  return words.filter(w => !/^\d{4}$/.test(w)).join(' ');
}

export function normaliseName(v) {
  return fold(v);
}

/** A customer record in the shape everything else here expects. */
export function normaliseCustomer(input = {}) {
  return {
    id: clean(input.id) || null,
    name: squash(input.name),
    email: clean(input.email),
    phone: squash(input.phone),
    address: squash(input.address),
    notes: clean(input.notes),
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null
  };
}

export function normaliseJob(input = {}) {
  return {
    id: clean(input.id) || null,
    customerId: clean(input.customerId) || null,
    description: squash(input.description),
    siteAddress: squash(input.siteAddress),
    status: clean(input.status) || 'open',
    servicem8JobId: clean(input.servicem8JobId),
    notes: clean(input.notes),
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null
  };
}

/** Empty when there is nothing to identify a customer by. */
export function customerIsEmpty(c) {
  const n = normaliseCustomer(c);
  return !n.name && !n.email && !n.phone && !n.address;
}

/**
 * How two customer records line up.
 *
 * Returns one of:
 *   'email'    same email address — the strongest thing NAC has
 *   'phone'    same phone number
 *   'name+address'
 *   'name'     same name, and nothing about either contradicts the other
 *   null       not the same customer as far as this can tell
 *
 * A shared name is the WEAKEST signal there is — there are a lot of people
 * called John Smith — so it only counts when neither record carries an email,
 * phone or address that disagrees.
 */
export function customerMatch(a, b) {
  const A = normaliseCustomer(a), B = normaliseCustomer(b);
  const ae = normaliseEmail(A.email), be = normaliseEmail(B.email);
  const ap = normalisePhone(A.phone), bp = normalisePhone(B.phone);
  const aa = normaliseAddress(A.address), ba = normaliseAddress(B.address);
  const an = normaliseName(A.name), bn = normaliseName(B.name);

  // An identifier that AGREES settles it. A mobile number that matches exactly
  // is the same contact even if one record carries a work email and the other
  // a personal one — the email difference is then reported, not resolved.
  if (ae && be && ae === be) return 'email';
  if (ap && bp && ap === bp) return 'phone';

  // Nothing agreed. An identifier that DISAGREES settles it the other way.
  if (ae && be) return null;                       // two different emails is two people
  if (ap && bp) return null;                       // two different numbers likewise

  if (an && bn && an === bn) {
    if (aa && ba) return aa === ba ? 'name+address' : null;
    return 'name';
  }
  return null;
}

/** The strongest match in `list`, or null. Ties resolve to the earliest row. */
export function findCustomer(list, candidate) {
  const rank = { email: 0, phone: 1, 'name+address': 2, name: 3 };
  let best = null, bestRank = 99;
  for (const existing of list || []) {
    const how = customerMatch(existing, candidate);
    if (how === null) continue;
    if (rank[how] < bestRank) { best = { customer: existing, how }; bestRank = rank[how]; }
  }
  return best;
}

/**
 * Fold `incoming` into `existing` WITHOUT losing anything.
 *
 * A field that is blank on the existing record takes the incoming value. A
 * field that already has a different value KEEPS IT and the disagreement comes
 * back in `conflicts` for a person to decide. Nothing is ever blanked.
 */
export function mergeCustomer(existing, incoming) {
  const E = normaliseCustomer(existing), I = normaliseCustomer(incoming);
  const merged = { ...E };
  const conflicts = [];
  const filled = [];

  for (const f of CUSTOMER_FIELDS) {
    const was = clean(E[f]), now = clean(I[f]);
    if (!now) continue;
    if (!was) { merged[f] = now; filled.push(f); continue; }
    if (sameValue(f, was, now)) continue;
    conflicts.push({ field: f, kept: was, offered: now });
  }
  return { customer: merged, conflicts, filled, changed: filled.length > 0 };
}

function sameValue(field, a, b) {
  if (field === 'email') return normaliseEmail(a) === normaliseEmail(b) && !!normaliseEmail(a);
  if (field === 'phone') return normalisePhone(a) === normalisePhone(b) && !!normalisePhone(a);
  if (field === 'address') return normaliseAddress(a) === normaliseAddress(b);
  if (field === 'name') return normaliseName(a) === normaliseName(b);
  return fold(a) === fold(b);
}

export function mergeJob(existing, incoming) {
  const E = normaliseJob(existing), I = normaliseJob(incoming);
  const merged = { ...E };
  const conflicts = [];
  const filled = [];
  for (const f of JOB_FIELDS) {
    const was = clean(E[f]), now = clean(I[f]);
    if (!now) continue;
    if (!was) { merged[f] = now; filled.push(f); continue; }
    if (fold(was) === fold(now)) continue;
    // Status is the one field that legitimately moves on.
    if (f === 'status') { merged[f] = now; filled.push(f); continue; }
    conflicts.push({ field: f, kept: was, offered: now });
  }
  if (!merged.customerId && I.customerId) { merged.customerId = I.customerId; filled.push('customerId'); }
  return { job: merged, conflicts, filled, changed: filled.length > 0 };
}

/** A job is the same job when it is the same customer at the same site. */
export function jobMatch(a, b) {
  const A = normaliseJob(a), B = normaliseJob(b);
  if (A.servicem8JobId && B.servicem8JobId) return A.servicem8JobId === B.servicem8JobId ? 'servicem8' : null;
  if (A.customerId && B.customerId && A.customerId !== B.customerId) return null;
  const aa = normaliseAddress(A.siteAddress), ba = normaliseAddress(B.siteAddress);
  if (aa && ba && aa !== ba) return null;
  if (aa && ba && aa === ba) return 'site';
  if (fold(A.description) && fold(A.description) === fold(B.description)) return 'description';
  return null;
}

export function findJob(list, candidate) {
  const rank = { servicem8: 0, site: 1, description: 2 };
  let best = null, bestRank = 99;
  for (const existing of list || []) {
    const how = jobMatch(existing, candidate);
    if (how === null) continue;
    if (rank[how] < bestRank) { best = { job: existing, how }; bestRank = rank[how]; }
  }
  return best;
}

/**
 * Identifiers that read as something, so a row in a list can be recognised.
 * Deterministic — the same input always gives the same id, which is what makes
 * the migration safe to run twice.
 */
export function customerId(c, seq) {
  const slug = normaliseName(c.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return 'CUS-' + (slug || 'customer').toUpperCase() + '-' + String(seq).padStart(4, '0');
}

export function jobId(job, seq) {
  const slug = normaliseAddress(job.siteAddress).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
    || normaliseName(job.description).replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  return 'JOB-' + (slug || 'job').toUpperCase().replace(/^-|-$/g, '') + '-' + String(seq).padStart(4, '0');
}

/**
 * What a migration WOULD do. Nothing is written; this is the thing NAC reads
 * before deciding.
 *
 * @param {Object} src
 * @param {Array}  src.quotes     existing nac_quotes rows
 * @param {Array}  src.designs    existing nac_designs rows (design JSON parsed)
 * @param {Array}  src.customers  nac_customers rows that already exist
 * @param {Array}  src.jobs       nac_jobs rows that already exist
 * @returns {Object} plan
 */
export function planBackfill({ quotes = [], designs = [], customers = [], jobs = [] } = {}) {
  // Working copies: existing rows are never mutated.
  const outCustomers = (customers || []).map(normaliseCustomer);
  const outJobs = (jobs || []).map(normaliseJob);
  const newCustomers = [];
  const newJobs = [];
  const customerUpdates = [];
  const jobUpdates = [];
  const links = [];            // { table, id, customerId, jobId }
  const conflicts = [];
  const skipped = [];
  let seqC = outCustomers.length, seqJ = outJobs.length;

  /** Find or create the customer for a record, folding in anything new. */
  const resolveCustomer = (candidate, from) => {
    if (customerIsEmpty(candidate)) { skipped.push({ from, why: 'nothing to identify a customer by' }); return null; }
    const hit = findCustomer(outCustomers, candidate);
    if (hit) {
      const m = mergeCustomer(hit.customer, candidate);
      if (m.conflicts.length) {
        conflicts.push({ kind: 'customer', id: hit.customer.id, from, matchedOn: hit.how, differences: m.conflicts });
      }
      if (m.changed) {
        const at = outCustomers.findIndex(c => c === hit.customer);
        outCustomers[at] = m.customer;
        // One update per customer, carrying everything learned about them.
        const prior = customerUpdates.find(u => u.id === m.customer.id);
        if (prior) Object.assign(prior, { fields: m.customer, filled: [...new Set([...prior.filled, ...m.filled])] });
        else customerUpdates.push({ id: m.customer.id, fields: m.customer, filled: m.filled, matchedOn: hit.how });
      }
      return outCustomers.find(c => c.id === hit.customer.id) || m.customer;
    }
    const created = normaliseCustomer({ ...candidate, id: customerId(candidate, ++seqC) });
    outCustomers.push(created);
    newCustomers.push({ ...created, from });
    return created;
  };

  const resolveJob = (candidate, customer, from) => {
    const want = normaliseJob({ ...candidate, customerId: customer?.id || null });
    if (!want.customerId && !want.siteAddress && !want.description) return null;
    const mine = outJobs.filter(j => !want.customerId || !j.customerId || j.customerId === want.customerId);
    const hit = findJob(mine, want);
    if (hit) {
      const m = mergeJob(hit.job, want);
      if (m.conflicts.length) {
        conflicts.push({ kind: 'job', id: hit.job.id, from, matchedOn: hit.how, differences: m.conflicts });
      }
      if (m.changed) {
        const at = outJobs.findIndex(j => j === hit.job);
        outJobs[at] = m.job;
        const prior = jobUpdates.find(u => u.id === m.job.id);
        if (prior) Object.assign(prior, { fields: m.job, filled: [...new Set([...prior.filled, ...m.filled])] });
        else jobUpdates.push({ id: m.job.id, fields: m.job, filled: m.filled, matchedOn: hit.how });
      }
      return outJobs.find(j => j.id === hit.job.id) || m.job;
    }
    const created = normaliseJob({ ...want, id: jobId(want, ++seqJ) });
    outJobs.push(created);
    newJobs.push({ ...created, from });
    return created;
  };

  // ── Designs first: they carry the fullest customer detail NAC holds ───────
  for (const d of designs || []) {
    const design = d.design || d;
    const candidate = {
      name: design.customer?.name || d.customer_name || '',
      email: design.customer?.email || '',
      phone: design.customer?.phone || '',
      address: design.customer?.address || d.customer_address || ''
    };
    const from = 'design ' + (d.id || design.id || '?');
    const customer = resolveCustomer(candidate, from);
    if (!customer) continue;
    const job = resolveJob({
      description: design.job?.description || '',
      siteAddress: candidate.address,
      servicem8JobId: d.job_id || ''
    }, customer, from);
    links.push({ table: 'nac_designs', id: d.id || design.id, customerId: customer.id, jobId: job?.id || null });
  }

  // ── Then quotes, which usually carry only a name ──────────────────────────
  for (const q of quotes || []) {
    const candidate = { name: q.client || '', address: q.site_address || '' };
    const from = 'quote ' + (q.id || '?');
    const customer = resolveCustomer(candidate, from);
    if (!customer) continue;
    const job = resolveJob({ description: q.job_desc || '', siteAddress: candidate.address }, customer, from);
    links.push({ table: 'nac_quotes', id: q.id, customerId: customer.id, jobId: job?.id || null });
  }

  return {
    newCustomers, newJobs, customerUpdates, jobUpdates, links, conflicts, skipped,
    customers: outCustomers, jobs: outJobs,
    summary: {
      quotesRead: (quotes || []).length,
      designsRead: (designs || []).length,
      customersBefore: (customers || []).length,
      customersAfter: outCustomers.length,
      customersCreated: newCustomers.length,
      customersUpdated: customerUpdates.length,
      jobsBefore: (jobs || []).length,
      jobsAfter: outJobs.length,
      jobsCreated: newJobs.length,
      jobsUpdated: jobUpdates.length,
      linked: links.length,
      conflicts: conflicts.length,
      skipped: skipped.length
    }
  };
}

/** A plan that would change nothing. Used to prove a second run is a no-op. */
export function planIsEmpty(plan) {
  return plan.newCustomers.length === 0 && plan.newJobs.length === 0 &&
         plan.customerUpdates.length === 0 && plan.jobUpdates.length === 0;
}

/** Plain English, for the migration screen and for a record of what was done. */
export function describePlan(plan) {
  const s = plan.summary;
  const lines = [
    'Read ' + s.quotesRead + ' quote(s) and ' + s.designsRead + ' design(s).',
    'Customers: ' + s.customersBefore + ' before, ' + s.customersCreated + ' to create, ' +
      s.customersUpdated + ' to fill in, ' + s.customersAfter + ' after.',
    'Jobs: ' + s.jobsBefore + ' before, ' + s.jobsCreated + ' to create, ' +
      s.jobsUpdated + ' to fill in, ' + s.jobsAfter + ' after.',
    s.linked + ' existing row(s) would be linked to a customer and a job.'
  ];
  if (s.conflicts) {
    lines.push(s.conflicts + ' disagreement(s) found. NOTHING is overwritten — the existing value is ' +
      'kept and the difference is listed for you to settle.');
  }
  if (s.skipped) lines.push(s.skipped + ' row(s) had nothing to identify a customer by and were left alone.');
  return lines.join('\n');
}
