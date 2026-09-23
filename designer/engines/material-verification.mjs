// ─────────────────────────────────────────────────────────────────────────────
// A RATE NOBODY HAS STOOD BEHIND
//
// Seven material rates on a real job were still the figures that shipped with
// the software. They are not NAC's prices — they are plausible numbers put
// there so the costing would run, and on job-cost-plus-fee they go straight
// through to the customer's price.
//
// Marking a rate "not a placeholder" is not the same as verifying it. A number
// typed into a box is still just a number: a verified rate is one where
// somebody can say WHERE it came from, WHEN it was quoted, and WHO checked it.
// That is what this records, and a used line without it blocks publication.
//
// Nick: "Do not replace the rates with invented values."  Nothing here supplies
// a figure. It only says which ones are missing and what is needed.
// ─────────────────────────────────────────────────────────────────────────────

const trimmed = (v) => (v === null || v === undefined) ? '' : String(v).trim();

/** Everything a verified rate has to carry, in the order the screen asks. */
export const VERIFICATION_FIELDS = Object.freeze([
  { key: 'supplier',      label: 'Supplier',        required: true,
    help: 'Who quoted this price.' },
  { key: 'supplierDesc',  label: 'Supplier description', required: false,
    help: 'The line as it appears on their quote, so it can be matched later.' },
  { key: 'effectiveDate', label: 'Effective date',  required: true,
    help: 'The date the quoted price applies from.' },
  { key: 'cost',          label: 'NAC cost',        required: true, unit: '$',
    help: 'What NAC actually pays. Not the shipped figure.' },
  { key: 'verifiedBy',    label: 'Verified by',     required: true,
    help: 'The person who checked it against the supplier’s quote.' },
  { key: 'verifiedAt',    label: 'Verification date', required: true,
    help: 'When they checked it.' }
]);

/** Is one stored verification record complete? */
export function rateVerified(record) {
  if (!record) return false;
  const cost = Number(record.cost);
  if (!Number.isFinite(cost) || cost < 0 || record.cost === null || record.cost === '') return false;
  return VERIFICATION_FIELDS.filter(f => f.required && f.key !== 'cost')
    .every(f => !!trimmed(record[f.key]));
}

/** What is still missing from one record, for the screen to show. */
export function missingFrom(record) {
  const out = [];
  for (const f of VERIFICATION_FIELDS) {
    if (!f.required) continue;
    if (f.key === 'cost') {
      const c = Number(record?.cost);
      if (record?.cost === null || record?.cost === undefined || record?.cost === ''
          || !Number.isFinite(c)) out.push(f);
      continue;
    }
    if (!trimmed(record?.[f.key])) out.push(f);
  }
  return out;
}

/**
 * Which rates does THIS design actually use, and which of those are unverified?
 *
 * Only lines the job uses matter. NAC's catalogue carries rates for sizes this
 * house will never see, and blocking a quote on those would be noise that
 * teaches an estimator to ignore the check.
 */
export function usedRateStatus({ design, verifications = {} } = {}) {
  const items = Array.isArray(design?.bom?.items) ? design.bom.items : [];
  const rows = [];

  for (const i of items) {
    if (!i || i.quotedSeparately) continue;
    if (i.key === 'proposal_ductwork_allowance') continue;   // an allowance, not a rate
    const id = i.diameterMm ? i.key + '.' + i.diameterMm : i.key;
    if (rows.some(r => r.id === id)) continue;

    const record = verifications[id] || null;
    const verified = rateVerified(record);
    // A supplier-quoted line is evidence in its own right: it carries the
    // supplier's own code and their quote edition.
    const supplierQuoted = i.priceSource === 'supplier_list' || i.priceSource === 'SUPPLIER'
      || !!i.supplierCode;
    const placeholder = i.priceSource === 'default_placeholder'
      || i.priceSource === 'PLACEHOLDER';
    const unpriced = !i.priced;

    rows.push({
      id, key: i.key, label: i.label, diameterMm: i.diameterMm ?? null,
      unit: i.unit || 'each',
      currentRate: i.unitCost ?? null,
      priceSource: i.priceSource || null,
      supplierCode: i.supplierCode || null,
      placeholder, unpriced, supplierQuoted,
      verified,
      record: record || null,
      missing: verified ? [] : missingFrom(record),
      /** A line needs confirming when it is a placeholder, unpriced, or an
       *  entered figure nobody has evidenced. */
      needsConfirmation: !verified && (placeholder || unpriced || !supplierQuoted)
    });
  }

  const needing = rows.filter(r => r.needsConfirmation);
  return {
    ok: needing.length === 0,
    rows,
    needing,
    failures: needing.length ? [{
      code: 'MATERIAL_RATES_UNVERIFIED',
      severity: 'CRITICAL',
      message: needing.length + ' material rate(s) used on this job have not been verified: '
        + needing.slice(0, 6).map(r => r.label).join(', ')
        + (needing.length > 6 ? ' and ' + (needing.length - 6) + ' more' : '')
        + '. Confirm each against a supplier quote in HVAC Design Settings → Material rates.',
      ids: needing.map(r => r.id)
    }] : []
  };
}

export default { VERIFICATION_FIELDS, rateVerified, missingFrom, usedRateStatus };
