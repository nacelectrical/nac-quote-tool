// ─────────────────────────────────────────────────────────────────────────────
// PODIUM — THE MANUAL WORKFLOW, AND THE SEAM AN INTEGRATION WILL ATTACH TO
//
// Nick, 4 November 2026: "I am waiting for Podium API information... Do not
// invent Podium endpoints or claim integration is working without account
// access and verified documentation."
//
// So there is no Podium client in this file and there is no Podium request
// anywhere in this application. What there is:
//
//   · a message Nick can edit and paste into Podium himself
//   · a record of what he did with it, which distinguishes COPYING A LINK
//     from SENDING A MESSAGE, because those are not the same event and
//     treating them as one is how a customer gets chased for a quote nobody
//     sent them
//   · the state machine that decides whether a follow-up is due, including
//     every reason it must stop
//   · a documented boundary: the stable ids an integration would key on and
//     the events it would receive
//
// WHO SENDS. Two systems that both think they own follow-ups will both send
// one. Until Podium's capabilities are confirmed, this application owns
// NOTHING: it sends no message, schedules no message, and `AUTOMATIC_SENDING`
// is false and is read before anything would go out. Scheduling ownership is
// a decision for when the API is known, and `SCHEDULING_OWNER` is where that
// decision will be written down.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NOTHING IS SENT BY THIS APPLICATION.
 *
 * Not a feature flag to be flipped when the code looks ready — it is false
 * because there is no verified API to send through, and the only thing that
 * may change it is Nick, after the integration has been configured and
 * tested against a real account.
 */
export const AUTOMATIC_SENDING = false;

/**
 * Which system schedules follow-ups. Undecided, on purpose.
 *
 * Nick: "Do not let both applications send duplicate follow-ups. Decide which
 * system owns scheduling once Podium capabilities are confirmed."
 */
export const SCHEDULING_OWNER = 'undecided';

/** What actually happened to a proposal, as distinct states. */
export const OUTREACH = Object.freeze({
  /** Nothing yet. */
  NONE: 'none',
  /** The link was put on the clipboard. It may never have been pasted. */
  LINK_COPIED: 'link_copied',
  /** Nick says he sent it. This application did not see it go. */
  SENT_MANUALLY: 'sent_manually',
  /** The customer wrote back. */
  CUSTOMER_REPLIED: 'customer_replied',
  /** Nick is handling it himself from here. */
  TAKEN_OVER: 'taken_over',
  /** The customer asked not to be chased. */
  OPTED_OUT: 'opted_out'
});

/** Why a follow-up is not due. Each is a different conversation. */
export const NO_FOLLOW_UP = Object.freeze({
  NEVER_SENT: 'never_sent',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
  REVOKED: 'revoked',
  OPTED_OUT: 'opted_out',
  PAUSED: 'paused',
  NOT_DUE_YET: 'not_due_yet'
});

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
const when = (v) => { const t = Date.parse(str(v)); return Number.isFinite(t) ? t : null; };

/** The outreach record as stored against an issued quote. */
export function normaliseOutreach(input = {}) {
  const o = input || {};
  return {
    state: Object.values(OUTREACH).includes(o.state) ? o.state : OUTREACH.NONE,
    linkCopiedAt: trimmed(o.linkCopiedAt) || null,
    sentAt: trimmed(o.sentAt) || null,
    sentBy: trimmed(o.sentBy) || null,
    /** Which way it went. Free text: Nick knows, this application does not. */
    channel: trimmed(o.channel) || null,
    paused: o.paused === true,
    pausedReason: trimmed(o.pausedReason) || null,
    pausedAt: trimmed(o.pausedAt) || null,
    lastFollowUpAt: trimmed(o.lastFollowUpAt) || null,
    followUpCount: Number.isFinite(Number(o.followUpCount)) ? Number(o.followUpCount) : 0,
    /** Every state change, oldest first, so the history can be read back. */
    events: Array.isArray(o.events) ? o.events.map(e => ({
      at: trimmed(e.at), state: trimmed(e.state), by: trimmed(e.by), note: trimmed(e.note)
    })) : []
  };
}

/** Record something that happened, without losing what happened before. */
export function recordOutreach(outreach, { state, by = '', note = '', channel = '',
                                           at = null } = {}) {
  const o = normaliseOutreach(outreach);
  const stamp = at || new Date().toISOString();
  const next = { ...o, events: [...o.events, { at: stamp, state, by, note }] };

  if (state === OUTREACH.LINK_COPIED) {
    next.linkCopiedAt = stamp;
    // Copying a link is NOT sending. If it was already sent, it stays sent.
    if (o.state === OUTREACH.NONE) next.state = OUTREACH.LINK_COPIED;
  } else if (state === OUTREACH.SENT_MANUALLY) {
    next.state = OUTREACH.SENT_MANUALLY;
    next.sentAt = stamp;
    next.sentBy = trimmed(by);
    next.channel = trimmed(channel) || null;
  } else if (state === OUTREACH.CUSTOMER_REPLIED || state === OUTREACH.TAKEN_OVER) {
    // Nick: "Pause automated follow-up when the customer replies or Nick
    // takes over, pending an explicit resume rule." Paused, not stopped —
    // somebody decides what happens next.
    next.state = state;
    next.paused = true;
    next.pausedAt = stamp;
    next.pausedReason = state === OUTREACH.CUSTOMER_REPLIED
      ? 'The customer replied. Nothing automatic goes out until somebody resumes it.'
      : 'Nick has taken this one over.';
  } else if (state === OUTREACH.OPTED_OUT) {
    next.state = OUTREACH.OPTED_OUT;
    next.paused = true;
    next.pausedAt = stamp;
    next.pausedReason = 'The customer asked not to be followed up.';
  }
  return next;
}

/** Lift a pause. Never possible after an opt-out. */
export function resumeOutreach(outreach, { by = '', at = null } = {}) {
  const o = normaliseOutreach(outreach);
  if (o.state === OUTREACH.OPTED_OUT) {
    return { ok: false, reason: 'opted_out', outreach: o,
      message: 'This customer asked not to be followed up. That is not something to resume.' };
  }
  const stamp = at || new Date().toISOString();
  return { ok: true, outreach: { ...o, paused: false, pausedReason: null, pausedAt: null,
    events: [...o.events, { at: stamp, state: 'resumed', by, note: '' }] } };
}

/**
 * Is a follow-up due on this quote, and if not, why not?
 *
 * @param {object} quote    the issue summary: status, expiresAt, supersededBy
 * @param {object} outreach the outreach record
 * @param {object} opts     { now, afterDays }
 */
export function followUpState(quote, outreach, opts = {}) {
  const q = quote || {};
  const o = normaliseOutreach(outreach);
  const now = when(opts.now) ?? Date.now();
  const afterDays = Number.isFinite(Number(opts.afterDays)) ? Number(opts.afterDays) : 3;
  const stop = (reason, message) => ({ due: false, reason, message, outreach: o });

  // ── THE REASONS IT IS OVER ───────────────────────────────────────────
  if (q.status === 'accepted') return stop(NO_FOLLOW_UP.ACCEPTED,
    'Accepted. The next step is the booking and the deposit, not another message.');
  if (q.status === 'declined') return stop(NO_FOLLOW_UP.DECLINED,
    'Declined. Chasing a decision somebody has already made is how NAC loses the next job.');
  if (q.status === 'revoked') return stop(NO_FOLLOW_UP.REVOKED, 'This quote was withdrawn.');
  if (trimmed(q.supersededBy)) return stop(NO_FOLLOW_UP.SUPERSEDED,
    'A newer revision replaced this one. Follow up that one instead.');
  const expires = when(q.expiresAt);
  if (expires !== null && expires < now) return stop(NO_FOLLOW_UP.EXPIRED,
    'This quote has expired. Issue a new revision rather than chasing a dead link.');

  // ── THE REASONS IT IS ON HOLD ────────────────────────────────────────
  if (o.state === OUTREACH.OPTED_OUT) return stop(NO_FOLLOW_UP.OPTED_OUT, o.pausedReason);
  if (o.paused) return stop(NO_FOLLOW_UP.PAUSED, o.pausedReason || 'Follow-up is paused.');

  // ── A LINK ON A CLIPBOARD IS NOT A MESSAGE ───────────────────────────
  // Following up something nobody sent is the worst version of this: the
  // customer gets "just checking you saw my quote" for a quote they never got.
  // The test is `sentAt`, not the state: once a customer replies the state
  // moves on from "sent", but the message still went, so a resumed quote is
  // followed up rather than reported as never sent.
  if (!o.sentAt) {
    return stop(NO_FOLLOW_UP.NEVER_SENT,
      o.state === OUTREACH.LINK_COPIED
        ? 'The link was copied but nobody has recorded sending it. Mark it sent, or send it.'
        : 'This proposal has not been sent to the customer yet.');
  }

  const since = when(o.lastFollowUpAt) ?? when(o.sentAt);
  const dueAt = since + afterDays * 86400000;
  if (now < dueAt) {
    return { due: false, reason: NO_FOLLOW_UP.NOT_DUE_YET, outreach: o, dueAt,
      message: 'Sent ' + Math.round((now - when(o.sentAt)) / 86400000) + ' day(s) ago. '
        + 'Due for a follow-up in ' + Math.ceil((dueAt - now) / 86400000) + ' day(s).' };
  }
  return { due: true, reason: null, outreach: o, dueAt,
    message: 'Sent ' + Math.round((now - when(o.sentAt)) / 86400000)
      + ' day(s) ago and not answered.' };
}

/**
 * The message Nick pastes into Podium.
 *
 * EDITABLE, because a message that cannot be changed is one that gets sent
 * saying the wrong thing. This is a starting point in NAC's voice, with the
 * customer's first name and the real link, and nothing in it is a claim about
 * the job that the proposal does not already make.
 */
export function quoteMessage(quote, opts = {}) {
  const q = quote || {};
  const brand = opts.brand || {};
  const first = trimmed(q.customerName).split(/\s+/)[0] || 'there';
  const business = trimmed(brand.businessName) || 'NAC Electrical Air & Refrigeration';
  const phone = trimmed(brand.phone);
  const url = trimmed(q.url);
  const kind = opts.kind === 'follow_up' ? 'follow_up' : 'first';
  const site = trimmed(q.siteAddress);

  // Deliberately plain. Every claim about the job is in the proposal, where a
  // customer can read it in full and where it is frozen against the revision
  // they were sent; a message that summarises the offer is a second version
  // of it that nobody is checking.
  const lines = kind === 'follow_up'
    ? [
        'Hi ' + first + ',',
        '',
        'Just following up the air conditioning proposal we sent through'
          + (site ? ' for ' + site : '') + '. The link is still live:',
        '',
        url,
        '',
        'Happy to go through any of it, or change the options if something else would '
          + 'suit you better. No rush either way — just let me know if you have any '
          + 'questions.',
        '',
        'Thanks,',
        business + (phone ? '\n' + phone : '')
      ]
    : [
        'Hi ' + first + ',',
        '',
        'Thanks for having us out. Your air conditioning proposal'
          + (site ? ' for ' + site : '') + ' is ready:',
        '',
        url,
        '',
        'It has the system, what is included, what is not, and the price. There are a '
          + 'couple of options you can choose between on the page, and you can accept it '
          + 'from there when you are ready.',
        '',
        'Give me a call if you would like to talk any of it through.',
        '',
        'Thanks,',
        business + (phone ? '\n' + phone : '')
      ];

  return {
    kind,
    body: lines.join('\n'),
    url,
    /** Where it would go. NAC sends it; this application does not. */
    to: trimmed(q.customerPhone) || trimmed(q.customerEmail) || null,
    note: 'Edit this before you send it. Nothing is sent by this application.'
  };
}

/**
 * THE SEAM.
 *
 * What an integration would need from this application, written down now so
 * that building it later is wiring rather than archaeology. None of it is
 * speculative about Podium: these are the ids and events NAC's side already
 * has, under names that will not change.
 */
export const INTEGRATION_BOUNDARY = Object.freeze({
  version: 1,
  /** Stable across revisions, renames and re-issues. */
  identifiers: Object.freeze({
    customerId: 'nac_customers.id — stable for the life of the customer',
    quoteId: 'nac_designs.id — the job. Stable across every revision of it.',
    revision: 'nac_quote_issues.quote_rev — 1, 2, 3 against one quoteId',
    issueToken: 'nac_quote_issues.token — identifies ONE revision\u2019s customer link. '
      + 'A bearer credential: it is the link, so it is never put in a log or a webhook.'
  }),
  /** What this application knows happened, and would emit. */
  events: Object.freeze([
    'quote.issued', 'quote.opened', 'quote.options_changed',
    'quote.accepted', 'quote.declined', 'quote.expired', 'quote.superseded',
    'outreach.link_copied', 'outreach.sent_manually',
    'outreach.customer_replied', 'outreach.taken_over', 'outreach.opted_out',
    'outreach.resumed'
  ]),
  /** What an integration would have to tell us, for follow-ups to behave. */
  inbound: Object.freeze([
    'A customer replied — pauses follow-up on that quote.',
    'A customer opted out — stops it for good.',
    'A message was actually delivered — which is what starts the follow-up clock, '
      + 'and is the one thing a copied link can never tell us.'
  ]),
  /** Still unknown, and blocking. */
  required: Object.freeze([
    'Podium API base URL and the authentication method (API key, OAuth client).',
    'Whether NAC\u2019s plan includes API access at all, and for which inbox.',
    'The endpoint that sends a message to a contact, and what it needs to '
      + 'identify that contact — a Podium contact id, or a phone number.',
    'Whether Podium can tell us a message was delivered, and whether it can tell '
      + 'us a customer replied. Without the second, follow-up scheduling cannot '
      + 'safely live on the Podium side.',
    'Whether Podium has its own automated follow-up that would run alongside '
      + 'ours — the duplicate-message question, and the one that decides '
      + 'SCHEDULING_OWNER.',
    'A test or sandbox inbox, so none of this is proved against a real customer.'
  ])
});

export default {
  AUTOMATIC_SENDING, SCHEDULING_OWNER, OUTREACH, NO_FOLLOW_UP,
  normaliseOutreach, recordOutreach, resumeOutreach, followUpState, quoteMessage,
  INTEGRATION_BOUNDARY
};
