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
  const outstanding = [];
  for (const f of [deposit, equipment, scheduling]) {
    if (f.state !== CONFIRMATION.CONFIRMED) {
      outstanding.push(f.label + (f.state === CONFIRMATION.UNKNOWN
        ? ' — not checked' : ' — not yet'));
    }
  }
  const openChecks = list(opts.siteChecks).map(c => ({
    what: str(c.what || c), resolved: c.resolved === true,
    note: str(c.note) || null
  }));
  for (const c of openChecks.filter(c => !c.resolved)) {
    outstanding.push('Site check: ' + c.what);
  }

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

export default { buildHandover, recordSync, CONFIRMATION, HANDOVER_STATE };
