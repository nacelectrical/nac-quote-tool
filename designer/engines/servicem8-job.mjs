// ─────────────────────────────────────────────────────────────────────────────
// AN ACCEPTED QUOTE BECOMES A SERVICEM8 JOB
//
// Nick: "Need acceptance button with signature to upload a job into ServiceM8
// with all fields filled out so it's set up without having to do anything
// manually."
//
// What existed was api/servicem8.js: twenty-nine lines that LOOK UP a job
// somebody had already typed in by hand. Nothing created one.
//
// This module is the mapping, and only the mapping. It takes the issue record
// as it stands after acceptance and returns the exact payloads ServiceM8 wants,
// with no network in it at all — so the field mapping can be tested against
// real expectations rather than against a mock's opinion of them.
//
// WHAT IT WILL NOT DO is invent a field. ServiceM8 will accept a job with an
// empty address and an empty description; a job like that costs somebody an
// afternoon on site with no idea what they are installing. So the mapping
// REPORTS what is missing and the caller decides, rather than quietly posting
// a half-filled job and reporting success.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const money = (v) => Math.round(Number(v) * 100) / 100;

/** ServiceM8 job statuses. A signed quote is work that is going to happen. */
export const JOB_STATUS = Object.freeze({
  QUOTE: 'Quote', WORK_ORDER: 'Work Order', UNSUCCESSFUL: 'Unsuccessful'
});

/** Split a person's name the way ServiceM8 stores it: first, then the rest. */
export function splitName(full) {
  const parts = trimmed(full).split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Everything the job needs, and what is missing.
 *
 * `blockers` stop the job being created at all — without them it would be a
 * job nobody can work from. `warnings` are things worth knowing that do not
 * justify refusing to book the work in.
 */
export function jobReadiness(issue) {
  const blockers = [], warnings = [];
  const i = issue || {};
  const c = i.customer || {};

  if (i.status !== 'accepted' || !i.acceptance) {
    blockers.push('The quote has not been accepted, so there is no job to create.');
  }
  if (!trimmed(c.name)) blockers.push('No customer name on the quote.');
  if (!trimmed(c.address) && !trimmed((i.job || {}).siteAddress)) {
    blockers.push('No site address — a job without one cannot be scheduled.');
  }
  if (n(i.acceptance && i.acceptance.totalIncGst) === null) {
    blockers.push('The acceptance carries no total.');
  }
  if (!trimmed(c.email) && !trimmed(c.phone)) {
    warnings.push('Neither an email nor a phone number is on file, so ServiceM8 will have no '
      + 'way to contact this customer.');
  }
  if (!(i.acceptance && i.acceptance.signature)) {
    warnings.push('The customer accepted without drawing a signature. Their typed name and the '
      + 'acceptance timestamp are the record.');
  }
  return { ok: blockers.length === 0, blockers, warnings };
}

/**
 * The line items. One per thing the customer actually agreed to buy.
 *
 * The SYSTEM is one line at the price for the system they chose, and each
 * upgrade is its own line at the quantity and unit price that were frozen into
 * the offer. Internal cost, margin and the bill of materials are NOT here:
 * ServiceM8 is where the office and the installers look, and the job's price
 * is what the customer agreed, not what it cost NAC to buy.
 */
export function jobMaterials(issue, presentation) {
  const a = (issue && issue.acceptance) || {};
  const p = presentation || {};
  const out = [];

  const sys = p.system || {};
  const base = n(p.investment && p.investment.baseIncGst);
  if (base !== null) {
    const bits = [sys.brand, sys.model, sys.capacityKw ? sys.capacityKw + ' kW' : null]
      .map(trimmed).filter(Boolean);
    out.push({
      name: bits.length ? bits.join(' ') : 'Ducted air conditioning system',
      description: 'Supply and install, as quoted and accepted.',
      quantity: 1, priceIncGst: money(base), kind: 'system'
    });
  }

  for (const line of (Array.isArray(a.selectedOptions) ? a.selectedOptions : [])) {
    const qty = n(line.quantity) ?? 1;
    const total = n(line.priceIncGst);
    if (total === null) continue;
    const unit = n(line.unitPriceIncGst);
    out.push({
      name: trimmed(line.title) || trimmed(line.id) || 'Optional upgrade',
      description: unit !== null
        ? qty + ' × $' + unit.toFixed(2) + (line.unitLabel ? ' ' + trimmed(line.unitLabel) : '')
        : 'Optional upgrade, as accepted.',
      quantity: qty,
      priceIncGst: money(total),
      kind: 'upgrade'
    });
  }
  return out;
}

/** What the installer reads when they open the job. */
export function jobDescription(issue, presentation) {
  const i = issue || {}, p = presentation || {}, a = i.acceptance || {};
  const sys = p.system || {};
  const lines = [];

  lines.push('ACCEPTED QUOTE ' + (trimmed(i.proposalNumber) || 'NAC quote')
    + ' — revision ' + (n(i.quoteRevision) ?? 1));
  lines.push('');
  const bits = [sys.brand, sys.model].map(trimmed).filter(Boolean).join(' ');
  if (bits) lines.push('System: ' + bits + (sys.capacityKw ? ' · ' + sys.capacityKw + ' kW' : ''));
  if (n(p.zoneCount) !== null) lines.push('Zones: ' + p.zoneCount);
  else if (p.zones && n(p.zones.count) !== null) lines.push('Zones: ' + p.zones.count);

  const mats = jobMaterials(i, p);
  const upgrades = mats.filter(m => m.kind === 'upgrade');
  if (upgrades.length) {
    lines.push('');
    lines.push('Accepted upgrades:');
    for (const u of upgrades) lines.push('  · ' + u.name + ' × ' + u.quantity);
  }

  lines.push('');
  lines.push('Accepted by ' + (trimmed(a.customerName) || 'the customer')
    + ' on ' + (trimmed(a.acceptedAt) || 'an unrecorded date'));
  lines.push('Total accepted (inc GST): $' + (n(a.totalIncGst) ?? 0).toFixed(2));
  const dep = p.investment && p.investment.deposit;
  if (dep && n(dep.amount) !== null) {
    lines.push('Deposit to collect: $' + n(dep.amount).toFixed(2)
      + (n(dep.percent) !== null ? ' (' + n(dep.percent) + '%)' : ''));
  }
  lines.push(a.signature
    ? 'Signed on the proposal page — signature attached to this job.'
    : 'Accepted online without a drawn signature; the typed name and timestamp are the record.');
  return lines.join('\n');
}

/**
 * Build every payload the creation needs, in the order they must be sent.
 *
 * Returns the pieces rather than sending them, so the sending code has no
 * decisions left to make and the mapping can be checked on its own.
 */
export function buildJobPlan(issue, presentation, opts = {}) {
  const ready = jobReadiness(issue);
  if (!ready.ok) return { ok: false, ...ready };

  const i = issue, c = i.customer || {}, a = i.acceptance || {};
  const address = trimmed((i.job || {}).siteAddress) || trimmed(c.address);
  const name = splitName(c.name);
  const materials = jobMaterials(i, presentation);
  const total = money(n(a.totalIncGst) ?? 0);

  return {
    ok: true,
    blockers: [], warnings: ready.warnings,
    company: {
      name: trimmed(c.name),
      address,
      /** Residential work is quoted to a person, so the "company" is them. */
      is_individual: 1,
      active: 1
    },
    contact: {
      first: name.first, last: name.last,
      email: trimmed(c.email), mobile: trimmed(c.phone),
      type: 'JOB'
    },
    job: {
      job_address: address,
      billing_address: address,
      job_description: jobDescription(i, presentation),
      // A quote the customer has signed is work NAC has won.
      status: opts.status || JOB_STATUS.WORK_ORDER,
      active: 1,
      date: trimmed(a.acceptedAt).slice(0, 10) || null,
      /** So the office can find the proposal this job came from. */
      purchase_order_number: trimmed(i.proposalNumber),
      total_invoice_amount: total
    },
    materials,
    attachments: [
      ...(a.signature ? [{
        kind: 'signature',
        fileName: 'customer-signature.png',
        contentType: 'image/png',
        dataUrl: a.signature
      }] : [])
    ],
    /** Used to keep a repeated call from creating a second job. */
    idempotencyKey: trimmed(i.token) + ':' + trimmed(a.acceptedAt),
    summary: {
      customer: trimmed(c.name), address,
      totalIncGst: total,
      lineCount: materials.length,
      signed: !!a.signature
    }
  };
}

export default { JOB_STATUS, splitName, jobReadiness, jobMaterials, jobDescription, buildJobPlan };
