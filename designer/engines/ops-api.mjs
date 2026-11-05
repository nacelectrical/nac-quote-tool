// ─────────────────────────────────────────────────────────────────────────────
// THE OPERATIONS SURFACE — WHAT AN ASSISTANT IS ALLOWED TO DO
//
// Nick, 4 November 2026: "I also have an AI operations assistant... Its
// current capabilities and access are not yet confirmed." And: "The assistant
// cannot invent prices, alter accepted offers or approve its own quote."
//
// NOTHING IN THIS FILE TALKS TO AN ASSISTANT. No client, no endpoint, no
// credential. It is the half of the integration NAC owns: the operations that
// are offered, the scopes that gate them, the rules that cannot be argued
// with, and the events that go back out. An assistant calls in; this
// application never calls out.
//
// ── WHO DOES WHAT ───────────────────────────────────────────────────────────
//
//   QUOTE TOOL (here)   sizing, equipment options, pricing, proposal
//                       revisions, customer acceptance. The numbers live
//                       here and are not accepted from anywhere else.
//   PODIUM              customer conversations and message delivery.
//   OPS ASSISTANT       coordinating tasks, approvals, follow-ups and the
//                       handover to the next business step.
//
// The division matters because it decides what the surface below refuses. An
// assistant coordinating a price is coordination; an assistant SETTING one is
// the quote tool's job being done by something that cannot be held to it.
//
// ── THE THREE RULES THAT ARE NOT NEGOTIABLE ─────────────────────────────────
//
//   1. NICK APPROVES THE EXACT REVISION. Approval is bound to a revision AND
//      to a fingerprint of the offer inside it. Change anything and the
//      approval does not travel with it.
//   2. THE ASSISTANT CANNOT APPROVE. There is no operation that approves a
//      quote. Not a scope it lacks — an operation that does not exist, so no
//      key can ever be issued for it.
//   3. THE ASSISTANT CANNOT PRICE. Every money field is refused on the way
//      in, by name, with the reason.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();

/** Scopes. A key carries some of these and nothing else. */
export const SCOPES = Object.freeze({
  ENQUIRY_WRITE: 'enquiry:write',
  QUOTE_READ: 'quote:read',
  QUOTE_WRITE: 'quote:write',
  APPROVAL_REQUEST: 'approval:request',
  DELIVERY_READ: 'delivery:read',
  BOOKING_WRITE: 'booking:write'
});

/**
 * Every operation this application offers an integration.
 *
 * `mutates` decides whether an idempotency key is required. `scope` is what a
 * key must carry. There is deliberately no `quote.approve`, no
 * `quote.set_price` and no `offer.amend`: an operation that does not exist
 * cannot be granted by mistake.
 */
export const OPERATIONS = Object.freeze({
  'enquiry.find_or_create': {
    scope: SCOPES.ENQUIRY_WRITE, mutates: true,
    summary: 'Find the customer and job this enquiry belongs to, or open one.',
    takes: ['name', 'phone', 'email', 'siteAddress', 'source', 'note'],
    returns: ['customerId', 'jobId', 'created', 'matchedOn']
  },
  'enquiry.attach_plan': {
    scope: SCOPES.ENQUIRY_WRITE, mutates: true,
    summary: 'Attach a floor plan or site information to a job.',
    takes: ['jobId', 'plan', 'siteNotes'],
    returns: ['jobId', 'planAttached']
  },
  'quote.create_draft': {
    scope: SCOPES.QUOTE_WRITE, mutates: true,
    summary: 'Open a draft quote against a job.',
    takes: ['jobId', 'customer', 'siteAddress', 'proposalNumber'],
    returns: ['quoteId', 'revision', 'status']
  },
  'quote.update_draft': {
    scope: SCOPES.QUOTE_WRITE, mutates: true,
    summary: 'Change the scope, rooms or selected options on a draft.',
    takes: ['quoteId', 'patch'],
    returns: ['quoteId', 'updated', 'refused']
  },
  'quote.sizing': {
    scope: SCOPES.QUOTE_READ, mutates: false,
    summary: 'Preliminary sizing for a job, as an estimate with its method named.',
    takes: ['quoteId'],
    returns: ['totalConditionedAreaSqM', 'recommendedKw', 'method', 'isEstimate', 'notes']
  },
  'quote.options': {
    scope: SCOPES.QUOTE_READ, mutates: false,
    summary: 'The priced equipment options on a quote.',
    takes: ['quoteId'],
    returns: ['options', 'upgrades', 'currency', 'gstInclusive']
  },
  'quote.preview': {
    scope: SCOPES.QUOTE_READ, mutates: false,
    summary: 'The proposal as it stands, and what is still missing.',
    takes: ['quoteId'],
    returns: ['canIssue', 'missing', 'summary']
  },
  'quote.request_approval': {
    scope: SCOPES.APPROVAL_REQUEST, mutates: true,
    summary: 'Tell Nick a quote is ready for him to approve. Does not approve it.',
    takes: ['quoteId', 'note'],
    returns: ['quoteId', 'fingerprint', 'state']
  },
  'quote.approved_link': {
    scope: SCOPES.DELIVERY_READ, mutates: false,
    summary: 'The customer link for an APPROVED, issued revision, for delivery.',
    takes: ['quoteId'],
    returns: ['url', 'revision', 'expiresAt']
  },
  'quote.status': {
    scope: SCOPES.QUOTE_READ, mutates: false,
    summary: 'Where a quote stands, and what the customer chose.',
    takes: ['quoteId'],
    returns: ['status', 'revision', 'selections', 'totalIncGst', 'events']
  },
  'booking.create_task': {
    scope: SCOPES.BOOKING_WRITE, mutates: true,
    summary: 'Open the booking and deposit task after an acceptance.',
    takes: ['quoteId', 'assignee', 'note'],
    returns: ['taskId', 'created']
  }
});

/** The status events an integration can subscribe to. */
export const STATUS_EVENTS = Object.freeze([
  'quote.approval_requested',
  'quote.approved',
  'quote.issued',
  'quote.accepted',
  'quote.declined',
  'quote.expired',
  'quote.superseded'
]);

/**
 * Who schedules follow-ups.
 *
 * Nick: "Only one system owns follow-up scheduling. Confirm whether that is
 * Podium or the assistant before enabling automation."
 *
 * Undecided, and read before anything would be scheduled. Two systems that
 * both believe they own this will both send.
 */
export const SCHEDULING_OWNER = 'undecided';
export const AUTOMATION_ENABLED = false;

/**
 * Money. Refused from an integration, by name, every time.
 *
 * Not a filter that strips them quietly — a refusal that says which field and
 * why, because an assistant that thinks it set a price and did not is worse
 * than one that is told it cannot.
 */
export const PRICE_FIELDS = Object.freeze([
  'price', 'priceIncGst', 'priceExGst', 'unitPriceIncGst', 'sellPrice',
  'sellPriceIncGst', 'cost', 'supplierCost', 'totalIncGst', 'total',
  'deposit', 'depositAmount', 'margin', 'marginPct', 'markup', 'markupPct',
  'jobFee', 'grossProfit', 'discount', 'allowance'
]);

/** Every price-looking key in a patch, however deep. */
export function priceFieldsIn(value, path = '') {
  const found = [];
  const walk = (v, p) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + '[' + i + ']')); return; }
    for (const [k, inner] of Object.entries(v)) {
      const here = p ? p + '.' + k : k;
      if (PRICE_FIELDS.includes(k)) found.push(here);
      walk(inner, here);
    }
  };
  walk(value, path);
  return found;
}

/** A fingerprint of the offer, so an approval cannot travel to a different one. */
export function offerFingerprint(quote) {
  const q = quote || {};
  const parts = [
    'rev:' + (q.revision ?? ''),
    'sys:' + (q.systems || []).map(s =>
      [s.id, s.brand, s.model, s.capacityKw, s.phase, s.priceIncGst].join('~')).join('|'),
    'chosen:' + (q.chosenSystemId || ''),
    'ups:' + [...(q.selectedUpgradeIds || [])].sort().join(',')
      + ':' + JSON.stringify(q.upgradeQuantities || {}),
    'scope:' + [q.scope?.outletCount, q.scope?.returnCount, q.scope?.zoneCount].join('~'),
    'inc:' + (q.inclusions || []).join('¶'),
    'exc:' + (q.exclusions || []).join('¶'),
    'ctrl:' + (q.controller?.id || q.controller?.name || '')
  ].join('\n');
  // A short, stable, non-cryptographic digest. It identifies an offer; it does
  // not protect one, and the frozen copy does that job already.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < parts.length; i++) {
    const c = parts.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/**
 * The fingerprint of a QUOTE DRAFT's offer.
 *
 * One function, used by the issue endpoint when it records what Nick approved
 * and by the operations surface when it checks that an approval still applies.
 * Two implementations would drift, and the first symptom of the drift would be
 * a quote NAC had approved refusing to hand over its link.
 */
export function draftOfferFingerprint(draft, revision = 0) {
  const d = draft || {};
  return offerFingerprint({
    revision,
    systems: d.systems || [],
    chosenSystemId: d.chosenSystemId || '',
    selectedUpgradeIds: d.selectedUpgradeIds || [],
    upgradeQuantities: d.upgradeQuantities || {},
    scope: d.scope || {},
    inclusions: d.inclusions || [],
    exclusions: d.exclusions || [],
    controller: d.controller || {}
  });
}

/** Does this key carry the scope this operation needs? */
export function authorise(operation, key) {
  const op = Object.prototype.hasOwnProperty.call(OPERATIONS, operation)
    ? OPERATIONS[operation] : null;
  if (!op) {
    return { ok: false, status: 404, error: 'unknown_operation',
      message: 'No such operation: ' + operation + '.' };
  }
  const scopes = Array.isArray(key?.scopes) ? key.scopes : [];
  if (!scopes.includes(op.scope)) {
    return { ok: false, status: 403, error: 'scope_required',
      message: operation + ' needs the ' + op.scope + ' scope and this key does not carry it.',
      needs: op.scope };
  }
  return { ok: true, operation: op };
}

/**
 * The rules that apply before anything is written.
 *
 * @param {string} operation
 * @param {object} body     what the integration sent
 * @param {object} state    { quote, approval, issue } as currently stored
 */
export function guard(operation, body = {}, state = {}) {
  const op = OPERATIONS[operation];
  const refusals = [];

  // ── AN IDEMPOTENCY KEY, ON EVERYTHING THAT CHANGES SOMETHING ──────────
  // Nick: "Retries must not create duplicate customers, quotes, messages or
  // booking tasks." A retry without a key is indistinguishable from a second
  // request, so the key is required rather than optional.
  if (op?.mutates && !trimmed(body.idempotencyKey)) {
    refusals.push({ code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: operation + ' changes something, so it needs an idempotencyKey. '
        + 'Send the same key to retry safely.' });
  }

  // ── NO PRICES FROM OUTSIDE ────────────────────────────────────────────
  const money = priceFieldsIn(body.patch ?? body.plan ?? null)
    .concat(priceFieldsIn(body.quote ?? null));
  if (money.length) {
    refusals.push({ code: 'PRICE_NOT_ACCEPTED',
      message: 'Prices are set in the quote tool, from NAC’s own catalogue and '
        + 'settings. Refused: ' + money.join(', ') + '.',
      fields: money });
  }

  // ── AN ACCEPTED OFFER IS FINISHED ─────────────────────────────────────
  const status = trimmed(state.quote?.status || state.issue?.status);
  if (op?.mutates && (status === 'accepted' || status === 'declined')) {
    if (operation !== 'booking.create_task') {
      refusals.push({ code: 'OFFER_ANSWERED',
        message: 'This quote has been ' + status + '. An answered offer is not changed — '
          + 'a change means a new revision, and that is Nick’s to make.' });
    }
  }

  // ── NOBODY APPROVES THEIR OWN QUOTE ───────────────────────────────────
  // There is no approve operation at all, so this catches the other way in:
  // an integration trying to hand itself an approval through a patch.
  if (operation === 'quote.update_draft') {
    const patch = body.patch || {};
    for (const forbidden of ['approved', 'approvedBy', 'approvedAt', 'approval',
                             'status', 'issuedAt', 'acceptance']) {
      if (Object.prototype.hasOwnProperty.call(patch, forbidden)) {
        refusals.push({ code: 'NOT_YOURS_TO_SET',
          message: '"' + forbidden + '" is not something an integration sets. '
            + 'Approval is Nick’s, in the application, against one revision.',
          field: forbidden });
      }
    }
  }

  // ── A LINK ONLY EXISTS FOR AN APPROVED, ISSUED REVISION ───────────────
  if (operation === 'quote.approved_link') {
    const appr = state.approval || null;
    if (!appr || appr.state !== 'approved') {
      refusals.push({ code: 'NOT_APPROVED',
        message: 'Nobody has approved this quote yet. Use quote.request_approval and wait '
          + 'for the quote.approved event.' });
    } else if (state.quote && appr.fingerprint !== offerFingerprint(state.quote)) {
      // The offer moved after it was approved. The approval does not follow it.
      refusals.push({ code: 'APPROVAL_STALE',
        message: 'The quote changed after it was approved, so that approval no longer '
          + 'applies. It has to be approved again.' });
    } else if (!trimmed(state.issue?.token)) {
      refusals.push({ code: 'NOT_ISSUED',
        message: 'Approved, but not issued yet. There is no customer link until it is.' });
    }
  }

  // ── A BOOKING TASK FOLLOWS AN ACCEPTANCE ──────────────────────────────
  if (operation === 'booking.create_task' && status !== 'accepted') {
    refusals.push({ code: 'NOT_ACCEPTED',
      message: 'A booking task is the step after a customer accepts. This quote is '
        + (status || 'not accepted') + '.' });
  }

  return { ok: refusals.length === 0, refusals };
}

/**
 * The customer this enquiry is about, if NAC already has them.
 *
 * Nick: "Create or find a customer enquiry without duplicates." Matching is
 * deliberately narrow — a phone number or an email address, normalised, or
 * the same name at the same address. A loose match merges two households.
 */
export function matchCustomer(enquiry, customers = []) {
  const digits = (v) => str(v).replace(/\D/g, '').replace(/^61/, '0');
  const email = (v) => trimmed(v).toLowerCase();
  const addr = (v) => trimmed(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const name = (v) => trimmed(v).toLowerCase().replace(/\s+/g, ' ');

  const wantPhone = digits(enquiry.phone);
  const wantEmail = email(enquiry.email);
  const wantAddr = addr(enquiry.siteAddress || enquiry.address);
  const wantName = name(enquiry.name);

  for (const c of customers) {
    if (wantPhone && wantPhone.length >= 8 && digits(c.phone) === wantPhone) {
      return { customer: c, matchedOn: 'phone' };
    }
  }
  for (const c of customers) {
    if (wantEmail && email(c.email) === wantEmail) return { customer: c, matchedOn: 'email' };
  }
  for (const c of customers) {
    if (wantName && wantAddr && name(c.name) === wantName
        && addr(c.address || c.siteAddress) === wantAddr) {
      return { customer: c, matchedOn: 'name_and_address' };
    }
  }
  return { customer: null, matchedOn: null };
}

/**
 * Has this exact request already been carried out?
 *
 * The stored record holds the RESULT, so a retry returns what the first call
 * returned rather than doing the work twice. A key reused for a different
 * request is a bug in the caller and is refused rather than silently
 * answering the wrong question.
 */
export function replayOf(idempotencyKey, operation, requestHash, store = {}) {
  const rec = store[trimmed(idempotencyKey)];
  if (!rec) return { replay: false };
  if (rec.operation !== operation || rec.requestHash !== requestHash) {
    return { replay: false, conflict: true,
      message: 'That idempotencyKey was used for a different request. Use a new key.' };
  }
  return { replay: true, result: rec.result, at: rec.at };
}

/** A stable hash of the request, for the replay check above. */
export function requestHash(operation, body = {}) {
  const { idempotencyKey, ...rest } = body || {};
  return offerFingerprint({ revision: operation, inclusions: [JSON.stringify(rest)] });
}

export default {
  SCOPES, OPERATIONS, STATUS_EVENTS, SCHEDULING_OWNER, AUTOMATION_ENABLED,
  PRICE_FIELDS, priceFieldsIn, offerFingerprint, draftOfferFingerprint,
  authorise, guard,
  matchCustomer, replayOf, requestHash
};
