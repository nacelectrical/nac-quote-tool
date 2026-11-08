// ─────────────────────────────────────────────────────────────────────────────
// THE INSTALLATION HANDOVER
//
// Nick, 8 November 2026: from an accepted quote, prepare an internal handover
// — and "an accepted quote must not automatically imply that a deposit is
// paid, equipment is available or an installation is booked."
//
// That sentence is the whole design. A handover is the document that turns a
// signature into a job, and the dangerous version of it is the one that reads
// as though everything is settled because one thing is. A customer accepting a
// price has told you they want the work. It has told you nothing about whether
// their money has arrived, whether the machine is in the country, or whether
// anybody has a day free.
//
// So every one of those three is a FIELD WITH A SOURCE, and each starts as
// UNKNOWN rather than as false-looking-like-no or absent-looking-like-fine.
// `confirmed` requires somebody or something to have said so, and the record
// keeps who.
//
// ── WHAT IS COPIED, AND WHY ────────────────────────────────────────────────
//
// The scope, the equipment and the total are copied OUT OF THE FROZEN ISSUED
// REVISION, not out of the live draft. The draft is still editable and the
// crew must install what the customer signed for. This is the same rule the
// customer page follows and for the same reason.
//
// ── IT IS NOT A SERVICEM8 JOB ──────────────────────────────────────────────
//
// Until ServiceM8 confirms a job id, `sync.state` is 'pending' and that is
// what the dashboard shows. Nick: "Never display it as successfully synced."
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => String(v ?? '').trim();
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const list = (v) => (Array.isArray(v) ? v : []);

/** A fact that is not known until somebody establishes it. */
export const CONFIRMATION = Object.freeze({
  UNKNOWN: 'unknown',       // nobody has checked. The starting state.
  CONFIRMED: 'confirmed',   // checked, and true, with a source recorded.
  NOT_YET: 'not_yet'        // checked, and not true yet.
});

/** Where a handover has got to. */
export const HANDOVER_STATE = Object.freeze({
  PREPARED: 'prepared',     // written down, not yet anywhere else.
  PENDING_SYNC: 'pending',  // we would like ServiceM8 to have it.
  SYNCED: 'synced',         // ServiceM8 confirmed, with an id.
  FAILED: 'failed'          // the attempt failed and is visible.
});

/**
 * Everything not settled, from the three facts and the site checks.
 *
 * One function, because the handover is built once and then edited many times
 * — a deposit gets confirmed, a site check gets closed — and `outstanding`
 * recomputed by a second piece of code would eventually disagree with this
 * one. `readyToBook` is derived from it and from nothing else.
 */
export function outstandingOf(facts, siteChecks) {
  const out = [];
  for (const f of list(facts)) {
    if (!f) continue;
    if (f.state !== CONFIRMATION.CONFIRMED) {
      out.push(f.label + (f.state === CONFIRMATION.UNKNOWN ? ' — not checked' : ' — not yet'));
    }
  }
  for (const c of list(siteChecks).filter(c => c && c.resolved !== true)) {
    out.push('Site check: ' + str(c.what || c));
  }
  return out;
}

function fact(input, label) {
  const f = input || {};
  const state = [CONFIRMATION.CONFIRMED, CONFIRMATION.NOT_YET].includes(str(f.state))
    ? str(f.state) : CONFIRMATION.UNKNOWN;
  return {
    label,
    state,
    // WHO said so. A confirmation with no source is not a confirmation, so a
    // state of `confirmed` with nothing behind it is demoted to unknown.
    source: str(f.source) || null,
    at: str(f.at) || null,
    note: str(f.note) || null,
    ...(state === CONFIRMATION.CONFIRMED && !str(f.source)
      ? { state: CONFIRMATION.UNKNOWN,
          note: 'Marked confirmed with no source recorded, so it is not treated as confirmed.' }
      : {})
  };
}

/**
 * Build a handover from an ISSUED, ACCEPTED quote record.
 *
 * @param {object} issued the frozen record out of nac_quote_issues
 * @param {object} opts   { siteChecks, access, deposit, equipment, scheduling,
 *                          preparedBy, now }
 */
export function buildHandover(issued = {}, opts = {}) {
  const d = issued || {};
  const acceptance = d.acceptance || null;
  const customer = d.customer || {};
  const job = d.job || {};
  const offer = d.offer || d.presentation || {};

  const deposit = fact(opts.deposit, 'Deposit received');
  const equipment = fact(opts.equipment, 'Equipment available');
  const scheduling = fact(opts.scheduling, 'Installation date agreed');

  // ── WHAT IS STILL OUTSTANDING ─────────────────────────────────────────
  //
  // Anything not CONFIRMED is outstanding. Unknown and not-yet are both
  // outstanding, because the question "has anybody checked?" and the answer
  // "yes, and no" lead to the same next action: somebody has to deal with it.
  const openChecks = list(opts.siteChecks).map(c => ({
    what: str(c.what || c), resolved: c.resolved === true,
    note: str(c.note) || null,
    /** Where the check came from — the sizing readiness notes raise most. */
    source: str(c.source) || null
  })).filter(c => c.what);
  const outstanding = outstandingOf([deposit, equipment, scheduling], openChecks);

  return {
    schema: 'nac.handover.v1',
    // ── IDENTITY, AND WHY IT IS THIS SHAPE ─────────────────────────────
    //
    // The token AND the revision. A second revision of the same quote is a
    // different offer and gets its own handover; keying on the token alone
    // would quietly overwrite the first.
    id: str(d.token) + ':' + (n(d.quoteRevision) ?? 1),
    quoteToken: str(d.token),
    revision: n(d.quoteRevision) ?? 1,
    designId: str(d.designId) || null,
    proposalNumber: str(d.proposalNumber) || null,
    // ── WHICH OFFER, EXACTLY ───────────────────────────────────────────
    //
    // The digest the issue endpoint took over the frozen offer. The crew
    // install what the customer signed for, and "revision 2" is a label
    // whereas this is the offer itself. If the handover and the issued record
    // ever disagree, this is what shows it.
    offerFingerprint: str(d.offerFingerprint) || null,

    customer: {
      name: str(customer.name) || null,
      phone: str(customer.phone) || null,
      email: str(customer.email) || null
    },
    property: {
      siteAddress: str(job.siteAddress) || str(customer.address) || null,
      accessNotes: str(opts.access) || null
    },

    // ── WHAT WAS SIGNED FOR, FROM THE FROZEN REVISION ──────────────────
    accepted: acceptance ? {
      by: str(acceptance.customerName) || null,
      at: str(acceptance.acceptedAt) || null,
      totalIncGst: n(acceptance.totalIncGst),
      chosenSystemId: str(acceptance.chosenSystemId) || str(d.chosenSystemId) || null,
      selectedOptionIds: list(acceptance.selectedOptionIds ?? d.selectedOptionIds).map(str),
      signed: !!acceptance.signature
    } : null,
    scope: {
      inclusions: list(offer.inclusions ?? (offer.scopeOfWork || {}).inclusions).map(str),
      exclusions: list(offer.exclusions ?? (offer.scopeOfWork || {}).exclusions).map(str),
      summary: str((offer.scopeOfWork || {}).summary) || null
    },
    attachments: list(opts.attachments).map(a => ({
      kind: str(a.kind) || 'file', label: str(a.label) || null, ref: str(a.ref) || null
    })).filter(a => a.ref),

    // ── THE THREE THINGS ACCEPTANCE DOES NOT TELL YOU ──────────────────
    deposit, equipment, scheduling,
    siteChecks: openChecks,
    outstanding,

    /** Ready only when NOTHING is outstanding. Never inferred from acceptance. */
    readyToBook: outstanding.length === 0,

    preparedBy: str(opts.preparedBy) || null,
    preparedAt: new Date(opts.now ?? Date.now()).toISOString(),

    // ── IT IS NOT IN SERVICEM8 UNTIL SERVICEM8 SAYS SO ─────────────────
    state: HANDOVER_STATE.PREPARED,
    sync: {
      system: 'servicem8',
      state: HANDOVER_STATE.PREPARED,
      externalId: null,
      attempts: 0,
      lastError: null,
      note: 'Prepared locally. Not sent to ServiceM8.'
    }
  };
}

/**
 * Record the outcome of an attempt to put this handover into ServiceM8.
 *
 * Bounded: after `maxAttempts` it stops being retried and starts being a thing
 * a person has to look at. A retry loop that never gives up is a retry loop
 * nobody notices.
 */
export function recordSync(handover, outcome = {}, { maxAttempts = 3 } = {}) {
  const h = handover || {};
  const prev = h.sync || {};
  const attempts = (n(prev.attempts) ?? 0) + 1;
  const externalId = str(outcome.externalId);

  if (outcome.ok === true && externalId) {
    return { ...h, state: HANDOVER_STATE.SYNCED,
      sync: { ...prev, state: HANDOVER_STATE.SYNCED, externalId, attempts,
              lastError: null, at: new Date().toISOString(),
              note: 'ServiceM8 job ' + externalId + '.' } };
  }
  // An "ok" with no id is NOT a success. Something answered; nothing was made.
  const error = str(outcome.error)
    || (outcome.ok === true ? 'ServiceM8 reported success but returned no job id.'
                            : 'The attempt did not complete.');
  const exhausted = attempts >= maxAttempts;
  return { ...h, state: exhausted ? HANDOVER_STATE.FAILED : HANDOVER_STATE.PENDING_SYNC,
    sync: { ...prev, state: exhausted ? HANDOVER_STATE.FAILED : HANDOVER_STATE.PENDING_SYNC,
            externalId: null, attempts, lastError: error, at: new Date().toISOString(),
            note: exhausted
              ? 'Gave up after ' + attempts + ' attempts. This needs a person.'
              : 'Not in ServiceM8. Will be tried again.' } };
}

/**
 * WHERE A HANDOVER IS, IN ONE WORD.
 *
 * Nick, 8 November 2026: "Clearly distinguish prepared, ready for scheduling
 * and synced."
 *
 * `state` alone could not. It said PREPARED both for a handover with three
 * unchecked facts and for one where everything had been confirmed and it was
 * genuinely waiting on somebody to put a date in the diary — and those two
 * need different actions from different people, so the dashboard was asking
 * the reader to work it out from the `outstanding` array's length.
 *
 * The one thing this will never do is promote a handover to SYNCED. Only
 * `recordSync` does that, and only on a ServiceM8 job id.
 */
export const HANDOVER_STAGE = Object.freeze({
  /** Written down, and something is still outstanding. */
  PREPARED: 'prepared',
  /** Nothing outstanding. Deposit, equipment and date all confirmed with a
   *  source, every site check closed. It can be booked. */
  READY_FOR_SCHEDULING: 'ready_for_scheduling',
  /** NAC wants ServiceM8 to have it and ServiceM8 has not confirmed. */
  PENDING_SYNC: 'pending_sync',
  /** ServiceM8 confirmed, with an id. */
  SYNCED: 'synced',
  /** The attempts ran out. A person has to look at it. */
  FAILED: 'failed'
});

export function handoverStage(handover) {
  const h = handover || {};
  const sync = h.sync || {};
  const state = str(sync.state) || str(h.state);

  // SYNCED is only ever read off a real external id. A record claiming the
  // state without one is not synced, whatever it says about itself — the same
  // rule `recordSync` applies on the way in, applied again on the way out so
  // a hand-edited row cannot show as booked.
  if (state === HANDOVER_STATE.SYNCED) {
    return str(sync.externalId) ? HANDOVER_STAGE.SYNCED : HANDOVER_STAGE.FAILED;
  }
  if (state === HANDOVER_STATE.FAILED) return HANDOVER_STAGE.FAILED;
  if (state === HANDOVER_STATE.PENDING_SYNC) return HANDOVER_STAGE.PENDING_SYNC;

  return list(h.outstanding).length === 0
    ? HANDOVER_STAGE.READY_FOR_SCHEDULING
    : HANDOVER_STAGE.PREPARED;
}

/**
 * Edit a handover that already exists.
 *
 * This is how a deposit gets confirmed and a site check gets closed, and it
 * exists so that none of that is done by writing to the record directly. Every
 * fact goes back through `fact()`, so:
 *
 *   · a confirmation with no source is demoted to unknown, on an edit exactly
 *     as on creation. "Somebody ticked it" is not a source.
 *   · `outstanding` and `readyToBook` are recomputed, never patched.
 *
 * WHAT IT CANNOT TOUCH: the accepted revision, the scope, the total, the
 * customer, the id, or the sync block. Those come out of the frozen issued
 * record and an edit here must not be able to rewrite what was signed for.
 *
 * @param {object} handover the stored record
 * @param {object} patch { deposit, equipment, scheduling, siteChecks, access,
 *                         attachments, note, by, now }
 */
export function updateHandover(handover, patch = {}) {
  const h = handover || {};
  const p = patch || {};

  const keep = (prev, given) => (given === undefined || given === null)
    ? (prev || { state: CONFIRMATION.UNKNOWN }) : given;

  const deposit = fact(keep(h.deposit, p.deposit), 'Deposit received');
  const equipment = fact(keep(h.equipment, p.equipment), 'Equipment available');
  const scheduling = fact(keep(h.scheduling, p.scheduling), 'Installation date agreed');

  const siteChecks = (p.siteChecks === undefined || p.siteChecks === null)
    ? list(h.siteChecks)
    : list(p.siteChecks).map(c => ({
        what: str(c.what || c), resolved: c.resolved === true,
        note: str(c.note) || null, source: str(c.source) || null
      })).filter(c => c.what);

  const outstanding = outstandingOf([deposit, equipment, scheduling], siteChecks);

  return {
    ...h,
    deposit, equipment, scheduling, siteChecks, outstanding,
    readyToBook: outstanding.length === 0,
    property: {
      ...(h.property || {}),
      accessNotes: p.access === undefined ? (h.property || {}).accessNotes ?? null
                                          : (str(p.access) || null)
    },
    attachments: p.attachments === undefined ? list(h.attachments)
      : list(p.attachments).map(a => ({
          kind: str(a.kind) || 'file', label: str(a.label) || null,
          ref: str(a.ref) || null
        })).filter(a => a.ref),
    /** Who last touched it, and when. An edit with no name is still recorded. */
    updatedBy: str(p.by) || str(h.updatedBy) || null,
    updatedAt: new Date(p.now ?? Date.now()).toISOString()
  };
}

/**
 * The site checks an assessment raised, as handover site checks.
 *
 * `sizingReadiness()` in plan-sizing.mjs already produces exactly the list of
 * things somebody has to go and look at — a room with no dimension, two
 * estimates 20% apart, a printed floor area that does not reconcile. Those
 * notes were shown on the sizing step and then went nowhere: the crew who turn
 * up to install never saw them.
 *
 * Only CHECK and CRITICAL notes become site checks. An informational note is
 * not a job for somebody.
 */
export function siteChecksFromReadiness(readiness) {
  return list(readiness && readiness.notes)
    .filter(n2 => n2 && ['CHECK', 'CRITICAL'].includes(str(n2.severity)))
    .map(n2 => ({
      what: str(n2.message) || str(n2.code),
      resolved: false,
      note: null,
      source: 'Preliminary sizing (' + (str(n2.code) || 'check') + ')'
    }))
    .filter(c => c.what);
}

export default { buildHandover, updateHandover, recordSync, handoverStage,
                 siteChecksFromReadiness, outstandingOf,
                 CONFIRMATION, HANDOVER_STATE, HANDOVER_STAGE };
