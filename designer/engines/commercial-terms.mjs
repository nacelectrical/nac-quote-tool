// ─────────────────────────────────────────────────────────────────────────────
// DEPOSIT, PAYMENT, VALIDITY — NAC'S, NOT MINE
//
// The demonstration proposal carried a 20% deposit and a 30-day validity. I put
// those numbers there to make the page look finished. They are not NAC policy,
// and shipping them as defaults would have made an invented payment term look
// like company policy the first time a real quote went out — on a document a
// customer signs.
//
// Nick: "Do not ship the demonstration 20% deposit and 30-day validity as
// assumed NAC policy. Until I enter and confirm these settings, the customer
// quote remains blocked."
//
// So every field ships empty, and a quote is blocked until they are entered AND
// confirmed. Entering them is not the same as agreeing to them: the confirm is
// a separate, named, timestamped act, because these are the terms NAC has to
// honour if a customer signs.
// ─────────────────────────────────────────────────────────────────────────────

const trimmed = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const rows = (v) => Array.isArray(v) ? v : [];

/** Every field the screen shows, in the order it shows them. */
export const TERMS_FIELDS = Object.freeze([
  { key: 'deposit', label: 'Deposit', required: true,
    help: 'Either a percentage of the quote or a fixed amount — whichever NAC asks for. '
        + 'One or the other, not both.' },
  { key: 'paymentStages', label: 'Payment stages', required: false,
    help: 'What is due and when, in the customer’s words. Leave empty if it is simply '
        + 'deposit then balance.' },
  { key: 'balanceDueEvent', label: 'Balance due on', required: true,
    help: 'The event that makes the balance payable — for example "completion and '
        + 'commissioning". A date cannot be used because the install date is not known yet.' },
  { key: 'validityDays', label: 'Quote valid for', unit: 'days', required: true,
    help: 'How long the price stands. After this the quote shows as expired and cannot be '
        + 'accepted.' },
  { key: 'paymentMethods', label: 'Payment methods', required: true,
    help: 'How the customer can pay — bank transfer, card, finance. At least one.' },
  { key: 'termsVersion', label: 'Terms and conditions version', required: true,
    help: 'Which version of NAC’s written terms this quote is issued under, so an accepted '
        + 'quote records what was agreed.' }
]);

/**
 * Are NAC's commercial terms set and confirmed?
 *
 * @returns {{ok, confirmed, missing:Array, failures:Array, terms:object}}
 */
export function commercialTermsStatus(settings) {
  const t = settings?.commercial?.terms || {};
  const missing = [];
  const failures = [];

  const depositPct = num(t.depositPercent);
  const depositAmt = num(t.depositAmount);
  if (depositPct === null && depositAmt === null) {
    missing.push({ key: 'deposit', label: 'Deposit' });
  } else if (depositPct !== null && depositAmt !== null) {
    failures.push({ code: 'DEPOSIT_SET_TWO_WAYS', severity: 'CRITICAL',
      message: 'A deposit is set both as ' + depositPct + '% and as $' + depositAmt
        + '. Set one or the other, so the customer is asked for one number.' });
  } else if (depositPct !== null && (depositPct <= 0 || depositPct >= 100)) {
    failures.push({ code: 'DEPOSIT_PERCENT_IMPLAUSIBLE', severity: 'CRITICAL',
      message: 'A deposit of ' + depositPct + '% is not a deposit.' });
  }

  if (!trimmed(t.balanceDueEvent)) missing.push({ key: 'balanceDueEvent', label: 'Balance due on' });

  const days = num(t.validityDays);
  if (days === null) missing.push({ key: 'validityDays', label: 'Quote valid for' });
  else if (days <= 0) {
    failures.push({ code: 'VALIDITY_IMPLAUSIBLE', severity: 'CRITICAL',
      message: 'A quote valid for ' + days + ' days expires before it is sent.' });
  }

  if (!rows(t.paymentMethods).filter(m => trimmed(m)).length) {
    missing.push({ key: 'paymentMethods', label: 'Payment methods' });
  }
  if (!trimmed(t.termsVersion)) missing.push({ key: 'termsVersion', label: 'Terms version' });

  // Stages are optional, but a stage with no label is a row somebody started
  // and did not finish.
  for (const [i, st] of rows(t.paymentStages).entries()) {
    if (!trimmed(st?.label)) {
      failures.push({ code: 'PAYMENT_STAGE_INCOMPLETE', severity: 'CRITICAL',
        message: 'Payment stage ' + (i + 1) + ' has no label.' });
    }
  }

  const confirmed = t.confirmed === true && !!trimmed(t.confirmedBy);
  if (!missing.length && !failures.length && !confirmed) {
    failures.push({ code: 'TERMS_NOT_CONFIRMED', severity: 'CRITICAL',
      message: 'The commercial terms are filled in but nobody has confirmed them. These are '
        + 'the terms NAC honours if a customer signs, so confirming them is a separate act '
        + 'from typing them. Confirm in HVAC Design Settings → Commercial.' });
  }

  if (missing.length) {
    failures.push({ code: 'COMMERCIAL_TERMS_NOT_SET', severity: 'CRITICAL',
      message: 'NAC’s commercial terms are incomplete: ' + missing.map(m => m.label).join(', ')
        + '. A customer quote cannot be issued without them. Set them in HVAC Design Settings '
        + '→ Commercial.',
      missing: missing.map(m => m.key) });
  }

  return {
    ok: failures.length === 0,
    confirmed,
    missing,
    failures,
    terms: {
      depositPercent: depositPct, depositAmount: depositAmt,
      balanceDueEvent: trimmed(t.balanceDueEvent),
      validityDays: days,
      paymentMethods: rows(t.paymentMethods).map(trimmed).filter(Boolean),
      paymentStages: rows(t.paymentStages)
        .map(st => ({ label: trimmed(st?.label), detail: trimmed(st?.detail),
                      percent: num(st?.percent) }))
        .filter(st => st.label),
      termsVersion: trimmed(t.termsVersion),
      confirmedBy: trimmed(t.confirmedBy),
      confirmedAt: trimmed(t.confirmedAt)
    }
  };
}

export default { TERMS_FIELDS, commercialTermsStatus };
