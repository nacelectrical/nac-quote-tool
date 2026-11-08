// ─────────────────────────────────────────────────────────────────────────────
// THE WORKFLOW: WHERE EVERY JOB IS, AND WHAT IS WAITING ON WHOM
//
// NOT CALLED "pipeline". In a ducted air conditioning codebase that word means
// refrigeration pipework, and tests/designer-removed.test.mjs rightly refuses
// to let anything by that name back into the application's reach. The guard
// caught this file on its first run. Renaming it was the correct answer and
// weakening the guard was not.
//
// Nick, 8 November 2026: "one dashboard for enquiries, quotes, jobs, crew,
// procurement, money and aftercare", and for the first release a board showing
// what needs him today.
//
// Everything this reads already existed and was already correct. What there
// was no such thing as was a STAGE: each screen knew its own corner — the
// builder knew about drafts, the portal knew about issued quotes, the ops
// surface knew about approvals — and nothing anywhere could say "this job is
// here, and the next move is yours."
//
// ── TWO RULES THIS IS BUILT ON ──────────────────────────────────────────────
//
// 1. UNAVAILABLE IS NOT ZERO. A panel that cannot read its source says so.
//    It does not show 0, and it does not show a dash that could be read as
//    nothing-to-do. `countOf()` returns null for "could not read" and the
//    dashboard prints that differently from a real zero. Nick, 4 November:
//    "Distinguish unavailable data from zero."
//
// 2. A FIGURE NEEDS A SOURCE. Money on this board comes from an issued quote
//    or an acceptance record — both frozen, both server-written. Nothing here
//    adds up a draft to make a pipeline value look impressive, because a
//    number nobody can trace is worse than no number.
//
// This is a READ MODEL. It decides nothing and writes nothing: the stage is
// derived from records the rest of the application already owns.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => String(v ?? '').trim();
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const at = (v) => {
  const t = Date.parse(str(v));
  return Number.isFinite(t) ? t : null;
};

/**
 * The stages a job moves through. One line each, because the value of a stage
 * model is that everybody reads the same words for the same thing.
 */
export const STAGE = Object.freeze({
  ENQUIRY: 'enquiry',            // somebody asked. Nothing assessed yet.
  ASSESSING: 'assessing',        // a draft exists and is being worked on.
  AWAITING_APPROVAL: 'awaiting_approval', // the estimator wants Nick to look.
  ISSUED: 'issued',              // the customer has the link.
  ACCEPTED: 'accepted',          // they said yes, against a frozen revision.
  HANDOVER: 'handover',          // ready to become a job.
  CLOSED: 'closed'               // declined, expired or superseded.
});

/** What has to be true before a job may leave a stage. Enforced in code. */
export const TRANSITIONS = Object.freeze({
  [STAGE.ENQUIRY]: Object.freeze({
    to: STAGE.ASSESSING,
    needs: Object.freeze(['A customer name', 'A site address'])
  }),
  [STAGE.ASSESSING]: Object.freeze({
    to: STAGE.AWAITING_APPROVAL,
    needs: Object.freeze(['The draft passes its own checks',
                          'A system with a brand, a model and a price'])
  }),
  [STAGE.AWAITING_APPROVAL]: Object.freeze({
    to: STAGE.ISSUED,
    // The approval is the gate, and the server refuses an issue without it.
    needs: Object.freeze(['Nick has read the preview and ticked the approval'])
  }),
  [STAGE.ISSUED]: Object.freeze({
    to: STAGE.ACCEPTED,
    needs: Object.freeze(['The customer accepts the issued revision'])
  }),
  [STAGE.ACCEPTED]: Object.freeze({
    to: STAGE.HANDOVER,
    // NONE of these is implied by acceptance. Nick, 8 November: "An accepted
    // quote must not automatically imply that a deposit is paid, equipment is
    // available or an installation is booked."
    needs: Object.freeze(['Outstanding site checks resolved',
                          'Deposit status confirmed against its source',
                          'Equipment availability confirmed'])
  })
});

/**
 * A count that knows the difference between none and unknown.
 *
 * @param {Array|null|undefined} rows  null/undefined = the source could not be read
 */
export function countOf(rows) {
  return Array.isArray(rows) ? rows.length : null;
}

/** Where one ISSUED quote sits. */
export function stageOfIssued(q = {}) {
  const status = str(q.status).toLowerCase();
  if (q.acceptedAt || status === 'accepted') return STAGE.ACCEPTED;
  if (['declined', 'expired', 'superseded', 'withdrawn'].includes(status)) return STAGE.CLOSED;
  return STAGE.ISSUED;
}

/**
 * Where one DRAFT sits.
 *
 * `gate` is the draft's own gate result, as the builder computes it — this
 * does not re-implement it, because two answers to "can this go out" is how
 * they drift apart.
 */
export function stageOfDraft(draft = {}, gate = null) {
  if (draft.issuedAt) return STAGE.ISSUED;
  const ok = gate ? gate.ok === true : false;
  if (draft.approvedBy) return STAGE.AWAITING_APPROVAL;
  return ok ? STAGE.AWAITING_APPROVAL : STAGE.ASSESSING;
}

/** How long ago, in whole days. Null when the date is not readable. */
export function daysSince(when, now = Date.now()) {
  const t = at(when);
  return t === null ? null : Math.floor((now - t) / 86400000);
}

/**
 * THE BOARD.
 *
 * Every argument may be null, meaning "that source could not be read", and the
 * panel it feeds says so rather than showing an empty list that reads as
 * nothing to do.
 *
 * @param {object} src { enquiries, drafts, issued, handovers, approvals,
 *                       integrations, now }
 */
export function dashboard(src = {}) {
  const now = src.now ?? Date.now();
  const issued = Array.isArray(src.issued) ? src.issued : null;
  const drafts = Array.isArray(src.drafts) ? src.drafts : null;
  const enquiries = Array.isArray(src.enquiries) ? src.enquiries : null;
  const handovers = Array.isArray(src.handovers) ? src.handovers : null;
  const approvals = Array.isArray(src.approvals) ? src.approvals : null;

  const panel = (title, rows, empty) => ({
    title,
    available: rows !== null,
    count: countOf(rows),
    rows: rows || [],
    empty
  });

  // ── NEW ENQUIRIES, AND WHAT THEY ARE MISSING ──────────────────────────
  const newEnquiries = enquiries && enquiries.map(e => {
    const missing = [];
    if (!str(e.customerName)) missing.push('customer name');
    if (!str(e.siteAddress)) missing.push('site address');
    if (!str(e.phone) && !str(e.email)) missing.push('a way to contact them');
    return {
      id: str(e.id), kind: 'enquiry',
      name: str(e.customerName) || 'Unnamed enquiry',
      detail: str(e.siteAddress) || 'No address yet',
      ageDays: daysSince(e.receivedAt ?? e.createdAt, now),
      missing,
      action: missing.length ? 'Fill in ' + missing.join(', ') : 'Start the assessment',
      href: e.id ? '/quote-builder.html?intake=' + encodeURIComponent(e.id) : null
    };
  });

  // ── QUOTES BEING PREPARED, AND THOSE WAITING ON NICK ──────────────────
  const draftRows = drafts && drafts.map(d => {
    const stage = stageOfDraft(d, d.gate || null);
    const blockers = (d.gate && Array.isArray(d.gate.blockers)) ? d.gate.blockers : [];
    return {
      id: str(d.id), kind: 'draft', stage,
      name: str(d.customerName) || 'Unnamed quote',
      detail: str(d.siteAddress) || '',
      ageDays: daysSince(d.updatedAt, now),
      blockers: blockers.map(b => str(b.message || b)),
      action: stage === STAGE.AWAITING_APPROVAL
        ? 'Read the preview and approve it'
        : (blockers.length ? blockers.length + ' thing(s) to finish' : 'Keep working on it'),
      href: d.id ? '/quote-builder.html?id=' + encodeURIComponent(d.id) : null
    };
  });
  const preparing = draftRows && draftRows.filter(r => r.stage === STAGE.ASSESSING);
  const forApproval = draftRows && draftRows.filter(r => r.stage === STAGE.AWAITING_APPROVAL);

  // ── ISSUED, AWAITING A RESPONSE ───────────────────────────────────────
  const awaiting = issued && issued
    .filter(q => stageOfIssued(q) === STAGE.ISSUED)
    .map(q => ({
      id: str(q.token), kind: 'issued',
      name: str(q.customerName) || 'Customer',
      detail: str(q.siteAddress) || '',
      ageDays: daysSince(q.issuedAt, now),
      // A FIGURE WITH A SOURCE: what the frozen revision was issued at.
      totalIncGst: n(q.quotedTotalIncGst),
      totalSource: n(q.quotedTotalIncGst) === null ? null : 'issued revision',
      viewed: n(q.viewCount) ?? 0,
      expiresInDays: q.expiresAt === null || q.expiresAt === undefined
        ? null : -(daysSince(q.expiresAt, now) ?? 0),
      action: (n(q.viewCount) ?? 0) === 0 ? 'Not opened yet — worth a call'
                                          : 'Opened, no answer yet',
      href: q.designId ? '/quote-builder.html?id=' + encodeURIComponent(q.designId) : null
    }));

  // ── ACCEPTED, AWAITING THE NEXT ACTION ────────────────────────────────
  //
  // Accepted is NOT booked. A job sits here until somebody has confirmed the
  // deposit against its own source, the site checks are closed out and the
  // equipment is actually available.
  const handoverByQuote = new Map(
    (handovers || []).map(h => [str(h.quoteToken) + ':' + (n(h.revision) ?? 1), h]));
  const acceptedRows = issued && issued
    .filter(q => stageOfIssued(q) === STAGE.ACCEPTED)
    .map(q => {
      const h = handoverByQuote.get(str(q.token) + ':' + (n(q.revision) ?? 1)) || null;
      const outstanding = h ? (h.outstanding || []) : ['No handover prepared yet'];
      return {
        id: str(q.token), kind: 'accepted',
        name: str(q.acceptedBy) || str(q.customerName) || 'Customer',
        detail: str(q.siteAddress) || '',
        ageDays: daysSince(q.acceptedAt, now),
        totalIncGst: n(q.acceptedTotalIncGst),
        totalSource: n(q.acceptedTotalIncGst) === null ? null : 'acceptance record',
        handover: h ? h.state : null,
        outstanding,
        action: !h ? 'Prepare the handover'
          : (outstanding.length ? outstanding.length + ' thing(s) before it can be booked'
                                : 'Ready to book'),
        href: q.designId ? '/quote-builder.html?id=' + encodeURIComponent(q.designId) : null
      };
    });

  // ── WHAT NEEDS NICK ───────────────────────────────────────────────────
  //
  // One list, in the order a person would work through it: approve what is
  // waiting, then chase what has gone quiet, then unblock what is stuck.
  const needsNick = [];
  for (const r of forApproval || []) needsNick.push({ ...r, why: 'Waiting for your approval' });
  for (const r of approvals || []) {
    needsNick.push({
      id: str(r.id), kind: 'ops_approval',
      name: str(r.summary) || 'The assistant asked for a decision',
      detail: str(r.detail) || '', ageDays: daysSince(r.requestedAt, now),
      why: 'The ops assistant is waiting', action: 'Approve or decline', href: '/quotes.html#approvals'
    });
  }
  for (const r of (awaiting || []).filter(x => (x.ageDays ?? 0) >= 7)) {
    needsNick.push({ ...r, why: 'Issued ' + r.ageDays + ' days ago with no answer' });
  }
  for (const r of (acceptedRows || []).filter(x => !x.handover)) {
    needsNick.push({ ...r, why: 'Accepted, and no handover prepared' });
  }

  // ── INTEGRATIONS ──────────────────────────────────────────────────────
  const integrations = Array.isArray(src.integrations) ? src.integrations : null;

  return {
    generatedAt: new Date(now).toISOString(),
    panels: {
      enquiries: panel('New enquiries', newEnquiries, 'No new enquiries.'),
      preparing: panel('Quotes being prepared', preparing, 'Nothing in progress.'),
      forApproval: panel('Waiting for your approval', forApproval, 'Nothing waiting on you.'),
      awaiting: panel('Issued, awaiting a response', awaiting, 'Nothing outstanding.'),
      accepted: panel('Accepted, awaiting the next action', acceptedRows, 'Nothing accepted yet.'),
      needsNick: panel('Needs you', needsNick.length ? needsNick : [], 'Nothing needs you today.'),
      integrations: panel('Connections', integrations, 'No integrations configured.')
    },
    // ── MONEY, ONLY WHERE IT HAS A SOURCE ─────────────────────────────
    //
    // Two figures, each from a frozen server-written record, each reported as
    // null rather than 0 when its source could not be read. Drafts are NOT in
    // either: a draft total is a number somebody is still typing.
    money: {
      issuedIncGst: awaiting === null ? null
        : awaiting.reduce((t, r) => t + (r.totalIncGst ?? 0), 0),
      issuedCounted: awaiting === null ? null
        : awaiting.filter(r => r.totalIncGst !== null).length,
      acceptedIncGst: acceptedRows === null ? null
        : acceptedRows.reduce((t, r) => t + (r.totalIncGst ?? 0), 0),
      acceptedCounted: acceptedRows === null ? null
        : acceptedRows.filter(r => r.totalIncGst !== null).length,
      source: 'Issued revisions and acceptance records only. Drafts are not counted.'
    }
  };
}

export default { STAGE, TRANSITIONS, dashboard, stageOfIssued, stageOfDraft, countOf, daysSince };
