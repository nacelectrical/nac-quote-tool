// ─────────────────────────────────────────────────────────────────────────────
// THE OFFER, AS IT WAS ISSUED
//
// A quote that is rebuilt from live data every time it is opened is not a
// quote. It is a live quotation of today's prices wearing yesterday's date.
//
// That is what this application did. /api/quote-view read the DESIGN, the
// CONTENT LIBRARY and NAC's SETTINGS at the moment the customer clicked, and
// built the page from them. Correct a room size, reprice a unit, edit a line
// of copy, and the proposal a customer was sent last week silently became a
// different proposal — with the same link, the same proposal number and the
// same revision on it. The acceptance endpoint did the same thing, so the
// figure NAC would have held someone to was whatever the numbers happened to
// say at the moment they pressed the button.
//
// So an issued quote is FROZEN. At the moment of issue the presentation is
// built once for every system the customer may choose between, and those
// finished documents are stored with the issue. Nothing downstream reads the
// design, the content library or the settings again. The customer's page is
// served from the frozen copy and the accepted total is computed from the
// frozen copy, which is why the two can never disagree.
//
// WHAT THE CUSTOMER MAY STILL CHANGE is which system and which upgrades —
// because those are choices the quote itself offered them. Every one of those
// choices was priced at issue, and this module only ever adds up numbers that
// were already in the frozen document. It has no access to a price list.
//
// CHANGING THE OFFER NEEDS A NEW REVISION. There is no path through here that
// edits a frozen presentation; `freezeOffer` is called once, by the issue
// endpoint, and a corrected quote is a new issue that supersedes the old one.
// ─────────────────────────────────────────────────────────────────────────────

export const OFFER_SCHEMA = 'nac.offer.v1';

/** The key a single-system quote's presentation is stored under. */
export const SINGLE_SYSTEM = '__single__';

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
/** Absent stays absent: Number(null) and Number('') are both 0. */
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const rows = (v) => Array.isArray(v) ? v : [];
const money = (v) => Math.round(Number(v) * 100) / 100;

/** A structural copy, so nothing handed out can be written back through. */
const clone = (v) => (v === null || v === undefined) ? v : JSON.parse(JSON.stringify(v));

/**
 * Freeze the documents a quote was issued with.
 *
 * @param {object}  args
 * @param {object}  args.presentations  systemOptionId -> the built presentation
 *                                      for that choice. A quote with no choice
 *                                      stores one under SINGLE_SYSTEM.
 * @param {string}  args.defaultSystemId  which one the customer sees first.
 * @param {number}  args.gstRate        the rate in force when it was issued.
 * @param {string}  args.issuedAt
 * @param {object}  args.source         where each input came from, for audit.
 */
export function freezeOffer({ presentations = {}, defaultSystemId = null,
                              gstRate = 0.1, issuedAt = null, source = {} } = {}) {
  const ids = Object.keys(presentations).filter(k => presentations[k]);
  if (!ids.length) {
    return { ok: false, reason: 'no_presentation',
             message: 'Nothing was built, so there is nothing to issue.' };
  }
  const chosen = (defaultSystemId && presentations[defaultSystemId]) ? defaultSystemId : ids[0];

  return {
    ok: true,
    offer: {
      schema: OFFER_SCHEMA,
      frozenAt: issuedAt || new Date().toISOString(),
      gstRate: n(gstRate) ?? 0.1,
      defaultSystemId: chosen,
      systemIds: ids,
      // The finished documents. Cloned on the way in as well as out: an object
      // still referenced by the builder must not be able to change afterwards.
      presentations: clone(presentations),
      /**
       * What the offer was built from. Not used to render anything — it exists
       * so a dispute can be traced back to the exact inputs, and so a later
       * revision can say what changed.
       */
      source: {
        designId: trimmed(source.designId) || null,
        designUpdatedAt: trimmed(source.designUpdatedAt) || null,
        contentUpdatedAt: trimmed(source.contentUpdatedAt) || null,
        settingsUpdatedAt: trimmed(source.settingsUpdatedAt) || null,
        termsVersion: trimmed(source.termsVersion) || null
      }
    }
  };
}

/** Is this a frozen offer this module understands? */
export function isOffer(offer) {
  return !!offer && offer.schema === OFFER_SCHEMA
    && !!offer.presentations && typeof offer.presentations === 'object';
}

/** The frozen document for one system choice, or null. */
export function presentationFor(offer, chosenSystemId = null) {
  if (!isOffer(offer)) return null;
  const id = trimmed(chosenSystemId);
  if (id && offer.presentations[id]) return offer.presentations[id];
  return offer.presentations[offer.defaultSystemId] || null;
}

/**
 * Normalise what the customer asked for. Accepts bare ids and {id, quantity}.
 */
function wanted(selectedOptions) {
  const out = new Map();
  for (const s of rows(selectedOptions)) {
    if (typeof s === 'string') { if (trimmed(s)) out.set(trimmed(s), null); continue; }
    const id = trimmed(s && s.id);
    if (id) out.set(id, n(s.quantity));
  }
  return out;
}

/**
 * Price a selection AGAINST THE FROZEN DOCUMENT.
 *
 * Every figure here comes out of the presentation that was stored at issue. An
 * id the offer does not carry is ignored rather than rejected — a stale tab, a
 * replayed request or a tampered payload cannot introduce a line, and cannot
 * introduce a price.
 */
export function priceSelection(offer, { chosenSystemId = null, selectedOptions = [] } = {}) {
  const p = presentationFor(offer, chosenSystemId);
  if (!p) return { ok: false, reason: 'no_offer', message: 'This quote has no issued copy.' };

  const systemId = (trimmed(chosenSystemId) && offer.presentations[trimmed(chosenSystemId)])
    ? trimmed(chosenSystemId) : offer.defaultSystemId;

  const inv = p.investment || {};
  const baseIncGst = n(inv.baseIncGst);
  if (baseIncGst === null) {
    return { ok: false, reason: 'no_price', message: 'The issued copy carries no price.' };
  }

  const ask = wanted(selectedOptions);
  const seenGroups = new Set();
  const lines = [];

  for (const o of rows(p.options)) {
    const id = trimmed(o.id);
    if (!id || !ask.has(id)) continue;

    // An upgrade that names the systems it fits is only available on those.
    // The frozen document carries that list, so switching system cannot drag
    // an incompatible add-on along with it.
    const fits = !Array.isArray(o.forSystemIds) || !o.forSystemIds.length
      || o.forSystemIds.includes(systemId);
    if (!fits) continue;

    const group = trimmed(o.group);
    if (group) {
      if (seenGroups.has(group)) continue;      // first in the group wins
      seenGroups.add(group);
    }

    const unit = n(o.unitPriceIncGst);
    if (unit !== null && n(o.maxQuantity) !== null && n(o.maxQuantity) > 0) {
      const asked = ask.get(id);
      const qty = Math.max(0, Math.min(n(o.maxQuantity), Math.round(n(asked) ?? 0)));
      if (qty < 1) continue;                    // none chosen is not a line
      lines.push({ id, title: trimmed(o.title), quantity: qty,
                   unitPriceIncGst: unit, unitLabel: trimmed(o.unitLabel) || null,
                   priceIncGst: money(unit * qty) });
      continue;
    }

    const flat = n(o.priceIncGst);
    if (flat === null) continue;                // unpriced in the frozen copy
    lines.push({ id, title: trimmed(o.title), quantity: 1,
                 unitPriceIncGst: null, unitLabel: null, priceIncGst: money(flat) });
  }

  const optionsTotal = money(lines.reduce((s, l) => s + l.priceIncGst, 0));
  const totalIncGst = money(baseIncGst + optionsTotal);
  const rate = n(offer.gstRate) ?? 0.1;
  const subtotalExGst = money(totalIncGst / (1 + rate));

  // The deposit follows the total the customer is actually accepting, at the
  // percentage the quote was issued with.
  const depPct = n(inv.deposit && inv.deposit.percent);
  const depAmt = n(inv.deposit && inv.deposit.amount);
  let deposit = null;
  if (depPct !== null) deposit = { percent: depPct, amount: Math.round(totalIncGst * depPct) / 100 };
  else if (depAmt !== null) deposit = { percent: null, amount: depAmt };

  return {
    ok: true,
    chosenSystemId: systemId,
    baseIncGst: money(baseIncGst),
    lines,
    optionsTotal: optionsTotal || null,
    totalIncGst,
    subtotalExGst,
    gst: money(totalIncGst - subtotalExGst),
    deposit,
    selectedOptionIds: lines.map(l => l.id)
  };
}

/**
 * The page the customer sees: the frozen document with their current choice
 * reflected in it. No input but the offer and the selection.
 */
export function offerPresentation(offer, selection = {}) {
  const priced = priceSelection(offer, selection);
  if (!priced.ok) return priced;

  const p = clone(presentationFor(offer, priced.chosenSystemId));

  // ── WHAT IS FROZEN IS THE OFFER, NOT ITS STATE ─────────────────────────
  //
  // The document was built at issue, when the quote had not been answered,
  // so its acceptance block says "you may accept this" forever. Serving that
  // unchanged left an accepted proposal still showing an Accept button — the
  // customer could press it again, and nothing on the page told them they had
  // already agreed.
  //
  // The PRICES and the WORDS are the frozen copy. Whether it can still be
  // accepted is a fact about the issue, and is applied over the top.
  const st = selection.issue || null;
  if (st) {
    const status = trimmed(st.status);
    const expired = selection.expired === true;
    p.status = status || p.status;
    p.expired = expired;
    p.revision = n(st.quoteRevision) ?? p.revision;
    p.acceptance = {
      ...(p.acceptance || {}),
      canAccept: status !== 'accepted' && status !== 'declined'
        && status !== 'revoked' && !expired,
      accepted: status === 'accepted',
      declined: status === 'declined',
      revoked: status === 'revoked',
      acceptedBy: st.acceptance ? trimmed(st.acceptance.customerName) : null,
      acceptedAt: st.acceptance ? trimmed(st.acceptance.acceptedAt) : null,
      acceptedTotalIncGst: st.acceptance ? n(st.acceptance.totalIncGst) : null
    };
  }
  const byId = new Map(priced.lines.map(l => [l.id, l]));

  if (p.systemChoice && Array.isArray(p.systemChoice.options)) {
    p.systemChoice.chosenId = priced.chosenSystemId;
    for (const o of p.systemChoice.options) o.chosen = o.id === priced.chosenSystemId;
  }

  p.options = rows(p.options).map(o => {
    const line = byId.get(trimmed(o.id)) || null;
    return { ...o, selected: !!line, quantity: line ? line.quantity : 0 };
  });

  p.investment = {
    ...(p.investment || {}),
    baseIncGst: priced.baseIncGst,
    subtotalExGst: priced.subtotalExGst,
    gst: priced.gst,
    selectedOptions: priced.lines.map(l => ({
      id: l.id, title: l.title, priceIncGst: l.priceIncGst,
      quantity: l.quantity, unitPriceIncGst: l.unitPriceIncGst, unitLabel: l.unitLabel
    })),
    optionsTotal: priced.optionsTotal,
    totalIncGst: priced.totalIncGst,
    deposit: priced.deposit
  };

  // The headline on the system card follows the same total.
  if (p.system && p.system.totalIncGst !== undefined) p.system.totalIncGst = priced.totalIncGst;

  return { ok: true, presentation: p, priced };
}

/**
 * Has anything the offer was built from moved since it was issued?
 *
 * This NEVER changes what the customer sees. It exists so the estimator's side
 * can say "the design has been edited since this quote went out — issue a new
 * revision", rather than quietly serving a stale document with no explanation.
 */
export function offerIsStale(offer, current = {}) {
  if (!isOffer(offer)) return { stale: false, changed: [] };
  const src = offer.source || {};
  const changed = [];
  for (const [key, label] of [['designUpdatedAt', 'the design'],
                              ['contentUpdatedAt', 'the content library'],
                              ['settingsUpdatedAt', 'the commercial settings']]) {
    const was = trimmed(src[key]);
    const now = trimmed(current[key]);
    if (was && now && was !== now) changed.push(label);
  }
  return { stale: changed.length > 0, changed };
}

export default {
  OFFER_SCHEMA, SINGLE_SYSTEM, freezeOffer, isOffer, presentationFor,
  priceSelection, offerPresentation, offerIsStale
};
