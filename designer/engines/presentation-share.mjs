// ─────────────────────────────────────────────────────────────────────────────
// ISSUING, SHARING AND REVISIONS
//
// A customer link is a bearer credential: whoever holds it sees a priced quote
// for somebody's house. So it is not a database id, not a job number and not
// anything a person could arrive at by adding one to the link they were sent.
//
// Nick: "Do not expose database IDs or predictable sequential links."
//
// The other half is that an accepted quote is a contract. Once somebody has put
// their name to a number, that number stops being editable — not by the
// estimator, not by the customer selecting an upgrade, not by a recalculation.
// Anything that would change it creates a NEW revision with its own link and
// its own acceptance, and leaves the accepted one exactly as it was signed.
// ─────────────────────────────────────────────────────────────────────────────

export const ISSUE_STATUS = Object.freeze({
  DRAFT: 'draft',
  ISSUED: 'issued',
  VIEWED: 'viewed',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  REVOKED: 'revoked',
  SUPERSEDED: 'superseded'
});

/** Statuses after which the issue is finished and may never change again. */
const TERMINAL = Object.freeze([ISSUE_STATUS.ACCEPTED, ISSUE_STATUS.DECLINED, ISSUE_STATUS.REVOKED]);

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
const nowIso = () => new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// TOKENS
// ─────────────────────────────────────────────────────────────────────────────

/** 192 bits from the platform CSPRNG. Never Math.random for a bearer token. */
export function randomToken(bytes = 24) {
  const buf = new Uint8Array(bytes);
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c || typeof c.getRandomValues !== 'function') {
    // Failing loudly beats quietly issuing a guessable link.
    throw new Error('No cryptographic random source is available — cannot issue a quote link.');
  }
  c.getRandomValues(buf);
  // base64url: URL-safe, no padding, case-sensitive, nothing to mistype into
  // somebody else's quote.
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  const b64 = (typeof btoa === 'function')
    ? btoa(bin)
    : Buffer.from(buf).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Minimum entropy we will accept on a link, in bits. */
export const MIN_TOKEN_BITS = 128;

export function tokenStrengthBits(token) {
  const t = trimmed(token);
  if (!t) return 0;
  // base64url carries 6 bits per character.
  return t.length * 6;
}

export function tokenLooksSecure(token) {
  const t = trimmed(token);
  if (tokenStrengthBits(t) < MIN_TOKEN_BITS) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return false;
  // A token that is all digits, or a recognisable id, is not random however
  // long it is.
  if (/^\d+$/.test(t)) return false;
  if (/^(job|quote|design|rev)[_-]?/i.test(t)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// ISSUES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue a presentation to a customer.
 *
 * The issue records WHICH revision was sent. It never stores the totals — those
 * are read back from the design revision at render time, so an issue cannot
 * drift away from the quote it points at.
 */
export function issuePresentation({
  designId, quoteRevision, validDays = 30, issuedBy = '', selectedOptionIds = [],
  supersedes = null, now = null
} = {}) {
  const issuedAt = now || nowIso();
  const expires = new Date(Date.parse(issuedAt) + validDays * 86400000).toISOString();
  return {
    schema: 'nac.quote.issue.v1',
    token: randomToken(),
    designId: trimmed(designId) || null,
    quoteRevision: Number(quoteRevision) || 1,
    status: ISSUE_STATUS.ISSUED,
    issuedAt,
    issuedBy: trimmed(issuedBy) || null,
    expiresAt: expires,
    firstViewedAt: null,
    lastViewedAt: null,
    viewCount: 0,
    respondedAt: null,
    acceptance: null,
    selectedOptionIds: Array.isArray(selectedOptionIds) ? [...selectedOptionIds] : [],
    supersedes: trimmed(supersedes) || null,
    supersededBy: null,
    audit: [{ at: issuedAt, event: 'issued', by: trimmed(issuedBy) || null,
              detail: 'Revision ' + (Number(quoteRevision) || 1) }]
  };
}

/** Freeze an accepted record all the way down, not just its top level. */
function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj)) deepFreeze(v);
  return obj;
}

function appendAudit(issue, event, detail, by = null) {
  return { ...issue, audit: [...(issue.audit || []), { at: nowIso(), event, detail, by }] };
}

export function isExpired(issue, now = null) {
  if (!issue?.expiresAt) return false;
  const t = now ? Date.parse(now) : Date.now();
  return Date.parse(issue.expiresAt) < t;
}

/**
 * Can this token be opened, and if not, why not?
 *
 * A superseded issue is NOT an error — the customer followed a link they were
 * legitimately sent. They are pointed at the current revision instead, and the
 * archived one is left untouched.
 */
export function resolveAccess(issue, now = null) {
  if (!issue) return { ok: false, reason: 'not_found', message: 'This quote link is not valid.' };
  if (issue.status === ISSUE_STATUS.REVOKED) {
    return { ok: false, reason: 'revoked',
      message: 'This quote link has been withdrawn. Please contact us for a current proposal.' };
  }
  if (issue.status === ISSUE_STATUS.SUPERSEDED) {
    return { ok: false, reason: 'superseded', redirectToken: issue.supersededBy || null,
      message: 'A newer version of this proposal is available.' };
  }
  if (isExpired(issue, now)) {
    // Still readable — the customer should be able to see what they were quoted.
    // Only ACCEPTANCE is withdrawn.
    return { ok: true, expired: true, canAccept: false,
      message: 'This proposal has expired. Please contact us and we will refresh it for you.' };
  }
  return { ok: true, expired: false, canAccept: !TERMINAL.includes(issue.status) };
}

/** Record a customer opening the link. Never changes a terminal status. */
export function recordView(issue, now = null) {
  if (!issue) return issue;
  const at = now || nowIso();
  const next = {
    ...issue,
    firstViewedAt: issue.firstViewedAt || at,
    lastViewedAt: at,
    viewCount: (Number(issue.viewCount) || 0) + 1,
    status: TERMINAL.includes(issue.status) || issue.status === ISSUE_STATUS.SUPERSEDED
      ? issue.status : ISSUE_STATUS.VIEWED
  };
  return appendAudit(next, 'viewed', 'View ' + next.viewCount);
}

/**
 * Accept.
 *
 * Refuses on an expired, revoked, superseded or already-answered issue, and the
 * refusal is returned rather than thrown so the page can show the customer a
 * sentence instead of a stack trace.
 */
export function acceptPresentation(issue, {
  customerName, acknowledgedTerms, signature = null, totalIncGst,
  selectedOptionIds = null, selectedOptions = null, chosenSystemId = undefined,
  offerFrozenAt = null, now = null
} = {}) {
  const access = resolveAccess(issue, now);
  if (!access.ok) return { ok: false, reason: access.reason, message: access.message, issue };
  if (access.expired) {
    return { ok: false, reason: 'expired', message: access.message, issue };
  }
  if (TERMINAL.includes(issue.status)) {
    return { ok: false, reason: 'already_answered',
      message: 'This proposal has already been answered.', issue };
  }
  if (!trimmed(customerName)) {
    return { ok: false, reason: 'name_required', message: 'Please enter your name to accept.', issue };
  }
  if (acknowledgedTerms !== true) {
    return { ok: false, reason: 'terms_required',
      message: 'Please confirm you have read the terms before accepting.', issue };
  }
  const at = now || nowIso();
  // An acceptance that does not name the options accepts the ones the customer
  // had already chosen. Defaulting to an empty list silently dropped every
  // upgrade they had ticked on the way to the button.
  const options = Array.isArray(selectedOptionIds)
    ? [...selectedOptionIds] : [...(issue.selectedOptionIds || [])];
  const accepted = appendAudit({
    ...issue,
    status: ISSUE_STATUS.ACCEPTED,
    respondedAt: at,
    selectedOptionIds: options,
    ...(Array.isArray(selectedOptions) ? { selectedOptions: selectedOptions.map(o => ({ ...o })) } : {}),
    ...(chosenSystemId !== undefined ? { chosenSystemId: trimmed(chosenSystemId) || null } : {}),
    acceptance: {
      customerName: trimmed(customerName),
      acknowledgedTerms: true,
      signature: signature || null,
      acceptedAt: at,
      quoteRevision: issue.quoteRevision,
      totalIncGst: Number(totalIncGst),
      selectedOptionIds: [...options],
      /** The exact lines accepted, with their quantities and unit prices. */
      selectedOptions: Array.isArray(selectedOptions) ? selectedOptions.map(o => ({ ...o })) : null,
      /** Which system was accepted, where the quote offered a choice. */
      chosenSystemId: chosenSystemId !== undefined
        ? (trimmed(chosenSystemId) || null) : (issue.chosenSystemId || null),
      /**
       * WHICH FROZEN COPY THIS PRICE CAME FROM. If the stored offer ever fails
       * to match this stamp, the acceptance and the document have parted
       * company and the record says so rather than quietly disagreeing.
       */
      offerFrozenAt: trimmed(offerFrozenAt) || (issue.offer && issue.offer.frozenAt) || null
    }
  }, 'accepted', trimmed(customerName) + ' accepted revision ' + issue.quoteRevision
     + ' at $' + Number(totalIncGst).toFixed(2));
  // Object.freeze is shallow, so freezing the issue left `acceptance.totalIncGst`
  // writable — the accepted PRICE was the one field still open to being changed.
  return { ok: true, issue: deepFreeze(accepted) };
}

export function declinePresentation(issue, { reason = '', now = null } = {}) {
  const access = resolveAccess(issue, now);
  if (!access.ok) return { ok: false, reason: access.reason, message: access.message, issue };
  if (TERMINAL.includes(issue.status)) {
    return { ok: false, reason: 'already_answered',
      message: 'This proposal has already been answered.', issue };
  }
  const at = now || nowIso();
  return { ok: true, issue: appendAudit({
    ...issue, status: ISSUE_STATUS.DECLINED, respondedAt: at,
    declineReason: trimmed(reason) || null
  }, 'declined', trimmed(reason) || 'No reason given') };
}

export function revokePresentation(issue, { by = '', reason = '' } = {}) {
  if (!issue) return { ok: false, reason: 'not_found', issue };
  if (issue.status === ISSUE_STATUS.ACCEPTED) {
    return { ok: false, reason: 'accepted',
      message: 'An accepted quote cannot be revoked. Issue a new revision instead.', issue };
  }
  return { ok: true, issue: appendAudit({
    ...issue, status: ISSUE_STATUS.REVOKED
  }, 'revoked', trimmed(reason) || 'Revoked by NAC', trimmed(by) || null) };
}

/**
 * Supersede an issue with a new revision.
 *
 * The old issue is marked and pointed at the new token; its totals, acceptance
 * state and audit trail are left exactly as they were. Nick: "clearly redirect
 * the customer to the latest active revision without altering the archived
 * revision."
 */
export function supersede(previous, next) {
  if (!previous || !next) return { previous, next };
  const archived = appendAudit({
    ...previous,
    status: previous.status === ISSUE_STATUS.ACCEPTED
      ? ISSUE_STATUS.ACCEPTED   // an accepted quote is never re-labelled
      : ISSUE_STATUS.SUPERSEDED,
    supersededBy: next.token
  }, 'superseded', 'Replaced by revision ' + next.quoteRevision);
  return { previous: deepFreeze(archived), next: { ...next, supersedes: previous.token } };
}

/**
 * A customer changing their selected options.
 *
 * Nick: "Selecting an option must create a new calculated quote revision rather
 * than silently changing an accepted quote." On an unanswered issue the choice
 * is just a pending selection; once accepted, it can only be a new revision.
 */
/**
 * The customer changed what they are buying.
 *
 * `selectedOptions` carries the QUANTITIES as well as the ids, because an
 * upgrade bought by the unit — a temperature sensor per room — is not answered
 * by a list of ids. `chosenSystemId` is which of the alternatives they are
 * looking at. Both belong to the issue, and both are priced against the frozen
 * offer, never against a live price list.
 */
export function changeOptions(issue, selectedOptionIds = [],
                              { selectedOptions = null, chosenSystemId = undefined } = {}) {
  if (!issue) return { ok: false, reason: 'not_found', issue };
  if (issue.status === ISSUE_STATUS.ACCEPTED) {
    return { ok: false, reason: 'requires_new_revision',
      message: 'This proposal has been accepted. Changing the options creates a new revision '
             + 'for you to review and accept.', issue, needsNewRevision: true };
  }
  const access = resolveAccess(issue);
  if (!access.ok || access.expired) {
    return { ok: false, reason: access.reason || 'expired', message: access.message, issue };
  }
  const next = { ...issue, selectedOptionIds: [...selectedOptionIds] };
  if (Array.isArray(selectedOptions)) next.selectedOptions = selectedOptions.map(o => ({ ...o }));
  if (chosenSystemId !== undefined) next.chosenSystemId = trimmed(chosenSystemId) || null;
  const detail = (selectedOptionIds.join(', ') || 'none')
    + (chosenSystemId !== undefined ? ' · system ' + (trimmed(chosenSystemId) || 'default') : '');
  return { ok: true, issue: appendAudit(next, 'options_changed', detail) };
}

/** The customer-facing URL. Path-based so the token never lands in a referrer query. */
export function shareUrl(issue, base = '') {
  const b = trimmed(base).replace(/\/+$/, '');
  return b + '/quote.html#' + trimmed(issue?.token);
}
