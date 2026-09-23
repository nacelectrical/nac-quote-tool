// ─────────────────────────────────────────────────────────────────────────────
// IS THERE A REAL CUSTOMER BEHIND THIS QUOTE?
//
// The demonstration proposal went out reading HELLO SAMPLE, to
// sample@example.invalid, on 0400 000 000, with licence TEST-ELEC-0000. Every
// one of those fields was populated, so every check that only asked "is this
// blank?" passed. A field filled in with a word that means "not filled in" is
// the one thing a presence check cannot see.
//
// Nick: a quote containing SAMPLE or TEST customer data, a .invalid email, a
// placeholder phone number, a placeholder licence or missing real contact
// details must be blocked.
//
// So this module knows what an unfilled field looks like when it is not empty,
// and what a real Australian contact looks like. It is deliberately separate
// from presentation.mjs so the pricing gate, the CRM screens and the proposal
// can all ask the same question and get the same answer.
// ─────────────────────────────────────────────────────────────────────────────

const trimmed = (v) => (v === null || v === undefined) ? '' : String(v).trim();

/**
 * Words that mean "nobody has filled this in yet", whatever they look like.
 *
 * A licence field reading SAMPLE-12345 renders exactly as confidently as a real
 * one, which is the whole problem: a customer reading "Electrical contractor
 * licence: SAMPLE-12345" has been shown a credential that does not exist.
 */
const NOT_A_REAL_VALUE =
  /\b(sample|test|testing|placeholder|example|dummy|lorem|ipsum|tbc|tba|todo|xxx+|n\/?a|none|unknown|not\s+recorded|your\s+name|customer\s+name)\b|\.invalid\b|\bfoo\b|\bbar\b/i;

/** True when a value is present but is plainly a stand-in. */
export function looksUnfilled(value) {
  const v = trimmed(value);
  if (!v) return false;                 // absent is a different problem
  return NOT_A_REAL_VALUE.test(v);
}

/** Domains that can never receive a real quote. */
const DEAD_DOMAINS = /@(?:[^@\s]*\.)?(?:invalid|example|example\.(?:com|net|org)|test|localhost|local)$/i;

export function emailStatus(value) {
  const v = trimmed(value);
  if (!v) return { ok: false, reason: 'No email address.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) {
    return { ok: false, reason: '"' + v + '" is not a usable email address.' };
  }
  if (DEAD_DOMAINS.test(v) || /\.invalid\b/i.test(v)) {
    return { ok: false, reason: '"' + v + '" is a reserved test domain — nothing sent to it '
      + 'will ever arrive.' };
  }
  if (looksUnfilled(v.split('@')[0])) {
    return { ok: false, reason: '"' + v + '" is a placeholder address.' };
  }
  return { ok: true, reason: null };
}

/**
 * An Australian phone number somebody could actually ring.
 *
 * 0400 000 000 parses as a valid mobile and reaches nobody. So the shape is
 * checked AND the digits are checked for the patterns that mean a person was
 * filling a box rather than recording a number.
 */
export function phoneStatus(value) {
  const v = trimmed(value);
  if (!v) return { ok: false, reason: 'No phone number.' };
  const digits = v.replace(/[^\d]/g, '').replace(/^61/, '0');
  if (digits.length < 8) {
    return { ok: false, reason: '"' + v + '" is too short to be a phone number.' };
  }
  if (/^(\d)\1+$/.test(digits)) {
    return { ok: false, reason: '"' + v + '" is the same digit repeated.' };
  }
  // 0400 000 000, 02 0000 0000, and friends: a real prefix with nothing behind it.
  if (/^0\d{1,3}0{6,}$/.test(digits) || /0{6,}/.test(digits)) {
    return { ok: false, reason: '"' + v + '" is a placeholder number — the prefix is real and '
      + 'the rest is zeros.' };
  }
  if (/^0?123456|^0?12345678|1234567890$/.test(digits)) {
    return { ok: false, reason: '"' + v + '" is a sequence, not a number.' };
  }
  if (/^0?5{6,}|^0?9{6,}/.test(digits)) {
    return { ok: false, reason: '"' + v + '" is a placeholder number.' };
  }
  return { ok: true, reason: null };
}

/**
 * Everything that has to be true of the person a quote is addressed to.
 *
 * @returns {{ok:boolean, failures:Array<{field:string,reason:string}>}}
 */
export function customerStatus(customer = {}, opts = {}) {
  const failures = [];
  const add = (field, reason) => failures.push({ field, reason });

  const name = trimmed(customer.name);
  if (!name) add('name', 'The quote has no customer name.');
  else if (looksUnfilled(name)) {
    add('name', '"' + name + '" is a placeholder, not a customer.');
  }

  // A quote has to be deliverable. Either channel will do; neither will not.
  const email = emailStatus(customer.email);
  const phone = phoneStatus(customer.phone);
  if (!email.ok && !phone.ok) {
    add('contact', 'No way to reach this customer. ' + email.reason + ' ' + phone.reason);
  } else {
    // A channel that is present must still be real — a bad address on file is
    // worse than none, because somebody will try to use it.
    if (trimmed(customer.email) && !email.ok) add('email', email.reason);
    if (trimmed(customer.phone) && !phone.ok) add('phone', phone.reason);
  }

  const address = trimmed(opts.siteAddress || customer.address);
  if (!address) add('address', 'The quote has no site address.');
  else if (looksUnfilled(address)) {
    add('address', '"' + address + '" is a placeholder address.');
  }

  return { ok: failures.length === 0, failures };
}

export default { looksUnfilled, emailStatus, phoneStatus, customerStatus };
