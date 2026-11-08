// ─────────────────────────────────────────────────────────────────────────────
// AN ENQUIRY IS A RECORD, NOT A PARAGRAPH OF TEXT
//
// Nick, 8 November 2026: "Enquiries have no store of their own."
//
// They did not. `api/intake-submit.js` wrote a row into `nac_quotes` — the
// QUOTE table — and put the customer's phone number, their address and the
// whole AI sizing pack into the free-text `notes` column, like this:
//
//     INTAKE DRAFT | 0400 000 000 | 12 Smith St
//     SIZE:            15.7 kW  (conditioned area 108 m2 x 145)
//     CONDITIONED_M2: 108
//     ...
//     PHOTOS:
//     https://…/plan-…
//
// Everything about that is readable by a person and nothing about it is
// readable by a program. The board could not count enquiries, could not say
// which were answered, and could not link one to the assessment that came out
// of it — so the dashboard's enquiry panel said "could not be read", which was
// honest and useless.
//
// ── WHAT THIS FILE IS ───────────────────────────────────────────────────────
//
// The enquiry as a RECORD with a stable id and real fields, plus the reader
// that turns one of those old text rows back into the same shape. Both
// directions matter:
//
//   · forwards, so every new enquiry is a row in `nac_enquiries`;
//   · backwards, so the enquiries NAC already took are not invisible just
//     because they were written before the table existed. Nothing is migrated
//     and nothing is rewritten — the old rows are read where they lie.
//
// ── THE ID IS THE ONE THE LINKS ALREADY CARRY ───────────────────────────────
//
// `NAC-SMITH-1762567890123`. The intake already mints it, the notification
// webhook already sends it, and `/quote-builder.html?intake=<id>` already opens
// on it. Inventing a second identifier for the same enquiry would have meant
// every link in every email NAC has ever sent pointing at the wrong one.
//
// ── ABSENT IS NOT ZERO, AND NOT-READ IS NOT EMPTY ───────────────────────────
//
// A sizing figure nobody could read is null, never 0. A list that could not be
// read is null, never []. The whole join with the ops assistant depends on
// both sides keeping that straight, so it is kept straight here at the bottom.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => String(v ?? '').trim();
const nul = (v) => str(v) || null;
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const list = (v) => (Array.isArray(v) ? v : []);

export const ENQUIRY_SCHEMA = 'nac.enquiry.v1';

/**
 * Where an enquiry has got to.
 *
 * Deliberately the same words `workflow.mjs` uses for the stages either side
 * of it, because two vocabularies for one thing is how a board and a briefing
 * end up disagreeing about the same job.
 */
export const ENQUIRY_STATE = Object.freeze({
  NEW: 'new',             // taken, nobody has started on it.
  ASSESSING: 'assessing', // a draft exists against it.
  QUOTED: 'quoted',       // a revision has been issued from it.
  CLOSED: 'closed'        // not going anywhere. A reason is recorded.
});

/** Where the record came from, so a derived one is never mistaken for a written one. */
export const ENQUIRY_SOURCE = Object.freeze({
  INTAKE: 'intake_form',
  LEGACY: 'legacy_quote_notes',
  MANUAL: 'entered_by_staff',
  OPS: 'ops_integration'
});

/**
 * The id the intake mints, and the only one.
 *
 * Kept byte-for-byte compatible with the expression in api/intake-submit.js,
 * because the links already in NAC's sent mail are built from it.
 */
export function enquiryId(clientName, now = Date.now()) {
  return 'NAC-' + str(clientName).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10)
    + '-' + now;
}

/**
 * The AI sizing pack, as fields.
 *
 * The pack is the intake's own draft notes and it is PLAIN TEXT on purpose —
 * an estimator reads it. This parses the labelled lines out of it so a program
 * can read it too, and keeps the text as well so nothing is lost in the
 * translation.
 *
 * NOTHING IS INVENTED. A line that is not there yields null, and null is
 * reported as not-read rather than as a figure.
 */
export function parseAssessmentPack(text) {
  const t = String(text ?? '');
  const one = (re) => { const m = t.match(re); return m ? str(m[1]) : null; };
  const csv = (re) => {
    const v = one(re);
    if (!v || /^(none|-|n\/a)$/i.test(v)) return [];
    return v.split(',').map(str).filter(Boolean);
  };
  const area = n(one(/CONDITIONED_M2:\s*([0-9]+(?:\.[0-9]+)?)/i));
  const sizeKw = n(one(/SIZE:\s*([0-9]+(?:\.[0-9]+)?)\s*kW/i));
  return {
    // The two figures, each reported only where it was actually printed.
    conditionedAreaSqM: area,
    indicativeKw: sizeKw,
    confidence: nul(one(/CONFIDENCE:\s*([A-Za-z]+)/i)),
    action: nul(one(/ACTION:\s*([A-Za-z \/]+)/i)),
    flags: nul(one(/FLAGS:\s*(.+)/i)),
    roomsCounted: csv(/ROOMS COUNTED:\s*(.+)/i),
    roomsNotCounted: csv(/NOT COUNTED:\s*(.+)/i),
    // IT IS A DRAFT NOTE AND IT SAYS SO. This is the intake assistant's
    // proposal, read off a photograph of a plan, before anybody has been to
    // the property. It is not an assessment and never becomes one by sitting
    // in a database.
    isDraftNote: true,
    text: t.trim() || null
  };
}

/**
 * One enquiry, normalised.
 *
 * Every field is optional. An enquiry with nothing but a phone number is still
 * an enquiry and must still appear on the board — what it is MISSING is
 * computed rather than being a reason to reject it.
 */
export function normaliseEnquiry(input = {}) {
  const e = input || {};
  const customer = e.customer || {};
  const site = e.site || e.property || {};
  const links = e.links || {};

  const state = [ENQUIRY_STATE.NEW, ENQUIRY_STATE.ASSESSING, ENQUIRY_STATE.QUOTED,
                 ENQUIRY_STATE.CLOSED].includes(str(e.state))
    ? str(e.state) : ENQUIRY_STATE.NEW;

  const out = {
    schema: ENQUIRY_SCHEMA,
    id: str(e.id) || null,
    source: str(e.source) || ENQUIRY_SOURCE.MANUAL,
    receivedAt: nul(e.receivedAt) || nul(e.createdAt),

    customer: {
      name: nul(customer.name ?? e.customerName),
      phone: nul(customer.phone ?? e.phone),
      email: nul(customer.email ?? e.email)
    },
    site: {
      address: nul(site.address ?? e.siteAddress ?? customer.address),
      propertyType: nul(site.propertyType ?? e.propertyType),
      existingAc: nul(site.existingAc ?? e.existingAc)
    },
    preferredBrand: nul(e.preferredBrand),
    comments: nul(e.comments),

    // What the customer sent. The plan is singled out because the assessment
    // starts from it and because /api/upload labels it.
    planUrl: nul(e.planUrl),
    photoUrls: list(e.photoUrls).map(str).filter(Boolean),

    /** The intake assistant's draft note, parsed. Null when there was none. */
    assessment: e.assessment
      ? (typeof e.assessment === 'string'
          ? parseAssessmentPack(e.assessment) : e.assessment)
      : null,

    // ── WHAT CAME OF IT ───────────────────────────────────────────────
    //
    // The links that were the point of the exercise. An enquiry you cannot
    // follow to its assessment and its quote is an enquiry you have to
    // follow by searching for the customer's name and hoping.
    links: {
      designId: nul(links.designId ?? e.designId),
      quoteId: nul(links.quoteId ?? e.quoteId),
      issuedToken: nul(links.issuedToken ?? e.issuedToken),
      /** The nac_quotes row the intake has always written. Kept, not replaced. */
      legacyQuoteId: nul(links.legacyQuoteId ?? e.legacyQuoteId)
    },

    state,
    closedReason: state === ENQUIRY_STATE.CLOSED ? nul(e.closedReason) : null,
    updatedAt: nul(e.updatedAt)
  };

  out.missing = missingFrom(out);
  return out;
}

/**
 * What has to be filled in before this can become an assessment.
 *
 * The same two things `workflow.mjs` names on the ENQUIRY → ASSESSING
 * transition, plus a way to reach the customer, because an enquiry nobody can
 * answer is not ready for anything.
 */
export function missingFrom(enquiry) {
  const e = enquiry || {};
  const missing = [];
  if (!str(e.customer?.name)) missing.push('customer name');
  if (!str(e.site?.address)) missing.push('site address');
  if (!str(e.customer?.phone) && !str(e.customer?.email)) missing.push('a way to contact them');
  return missing;
}

/**
 * The enquiry an intake submission makes.
 *
 * @param {object} body  the intake form's own body
 * @param {object} opts  { id, pack, planUrl, photoUrls, now }
 */
export function enquiryFromIntake(body = {}, opts = {}) {
  const b = body || {};
  const now = opts.now ?? Date.now();
  return normaliseEnquiry({
    id: str(opts.id) || enquiryId(b.client, now),
    source: ENQUIRY_SOURCE.INTAKE,
    receivedAt: new Date(now).toISOString(),
    customer: { name: b.client, phone: b.phone, email: b.email },
    site: { address: b.address, propertyType: b.houseType, existingAc: b.existingAC },
    preferredBrand: b.brand,
    comments: b.comments,
    planUrl: opts.planUrl ?? null,
    photoUrls: list(opts.photoUrls ?? b.photoUrls),
    assessment: opts.pack ? parseAssessmentPack(opts.pack) : null,
    links: { legacyQuoteId: str(opts.id) || null },
    state: ENQUIRY_STATE.NEW,
    updatedAt: new Date(now).toISOString()
  });
}

/** The marker the intake has always written at the head of the notes column. */
export const LEGACY_MARKER = 'INTAKE DRAFT';

/** Is this old `nac_quotes` row one of the intake's enquiries? */
export function isLegacyEnquiryRow(row) {
  return /^\s*INTAKE DRAFT\b/.test(String(row?.notes ?? ''));
}

/**
 * Read an enquiry out of a pre-table `nac_quotes` row.
 *
 * NOTHING IS WRITTEN BACK. The row stays exactly as it is; this is a reader,
 * so applying the new table does not require a migration pass over NAC's
 * existing records and a failed migration cannot lose one.
 */
export function enquiryFromLegacyQuoteRow(row) {
  if (!row) return null;
  const notes = String(row.notes ?? '');
  const header = (notes.match(/^\s*INTAKE DRAFT\s*\|([^\n]*)/) || [])[1] || '';
  const [phone = '', address = ''] = header.split('|').map(str);

  const urls = (notes.split('PHOTOS:')[1] || '')
    .split('\n').map(str).filter(u => u.startsWith('http'));
  // /api/upload labels the floor plan `plan` and the site pictures `photo` —
  // the same rule designer/engines/store.mjs has always used.
  let planUrl = null;
  for (const u of urls) {
    let decoded = u;
    try { decoded = decodeURIComponent(u); } catch (e) { /* keep the raw form */ }
    if (/\/plan-/.test(decoded)) { planUrl = u; break; }
  }

  const pack = notes.split('PHOTOS:')[0].replace(/^\s*INTAKE DRAFT[^\n]*\n?/, '').trim();

  return normaliseEnquiry({
    id: row.id,
    source: ENQUIRY_SOURCE.LEGACY,
    receivedAt: row.created_at ?? row.createdAt ?? null,
    customer: { name: row.client, phone, email: null },
    site: { address },
    planUrl,
    photoUrls: urls.filter(u => u !== planUrl),
    assessment: pack ? parseAssessmentPack(pack) : null,
    links: { legacyQuoteId: row.id, quoteId: row.id },
    // An old row carries no state of its own. `accepted` is the only thing it
    // ever recorded, and an accepted quote is not an open enquiry.
    state: row.accepted === true ? ENQUIRY_STATE.QUOTED : ENQUIRY_STATE.NEW,
    updatedAt: row.updated_at ?? null
  });
}

/**
 * Link an enquiry to what came out of it.
 *
 * Links only ever ACCUMULATE. A design id already on the record is not
 * replaced by a different one in silence — the second one is reported as a
 * conflict, because two assessments against one enquiry is either a mistake
 * worth seeing or a second enquiry wearing the first one's id.
 */
export function linkEnquiry(enquiry, link = {}) {
  const e = normaliseEnquiry(enquiry);
  const conflicts = [];
  const next = { ...e.links };

  for (const field of ['designId', 'quoteId', 'issuedToken']) {
    const given = nul(link[field]);
    if (!given) continue;
    if (next[field] && next[field] !== given) {
      conflicts.push({ field, existing: next[field], offered: given });
      continue;
    }
    next[field] = given;
  }

  // The state follows the links rather than being set by hand, so it cannot
  // claim a quote was issued when no token was ever recorded.
  let state = e.state;
  if (state !== ENQUIRY_STATE.CLOSED) {
    if (next.issuedToken) state = ENQUIRY_STATE.QUOTED;
    else if (next.designId) state = ENQUIRY_STATE.ASSESSING;
  }
  if (nul(link.closedReason)) state = ENQUIRY_STATE.CLOSED;

  return {
    ...e,
    links: next,
    state,
    closedReason: state === ENQUIRY_STATE.CLOSED
      ? (nul(link.closedReason) || e.closedReason) : null,
    updatedAt: new Date(link.now ?? Date.now()).toISOString(),
    conflicts
  };
}

// ── THE DATABASE SHAPE ──────────────────────────────────────────────────────
//
// One place that knows the column names, so the `nac_designs.design` / `.data`
// bug — three endpoints asking PostgREST for a column that was in neither
// schema file, every test stubbing the call — cannot happen again here.

/** The column list every reader asks for. */
export const ENQUIRY_SELECT = 'id,received_at,source,customer_name,phone,email,'
  + 'site_address,property_type,existing_ac,preferred_brand,comments,plan_url,'
  + 'photo_urls,assessment,state,closed_reason,design_id,quote_id,issued_token,'
  + 'legacy_quote_id,updated_at';

/** Record → row. */
export function toRow(enquiry) {
  const e = normaliseEnquiry(enquiry);
  return {
    id: e.id,
    received_at: e.receivedAt,
    source: e.source,
    customer_name: e.customer.name,
    phone: e.customer.phone,
    email: e.customer.email,
    site_address: e.site.address,
    property_type: e.site.propertyType,
    existing_ac: e.site.existingAc,
    preferred_brand: e.preferredBrand,
    comments: e.comments,
    plan_url: e.planUrl,
    photo_urls: e.photoUrls,
    assessment: e.assessment,
    state: e.state,
    closed_reason: e.closedReason,
    design_id: e.links.designId,
    quote_id: e.links.quoteId,
    issued_token: e.links.issuedToken,
    legacy_quote_id: e.links.legacyQuoteId,
    updated_at: e.updatedAt || new Date().toISOString()
  };
}

/** Row → record. */
export function fromRow(row) {
  if (!row) return null;
  let assessment = row.assessment ?? null;
  if (typeof assessment === 'string') {
    try { assessment = JSON.parse(assessment); }
    catch (e) { assessment = parseAssessmentPack(assessment); }
  }
  let photos = row.photo_urls ?? [];
  if (typeof photos === 'string') {
    try { photos = JSON.parse(photos); } catch (e) { photos = []; }
  }
  return normaliseEnquiry({
    id: row.id,
    source: row.source,
    receivedAt: row.received_at,
    customer: { name: row.customer_name, phone: row.phone, email: row.email },
    site: { address: row.site_address, propertyType: row.property_type,
            existingAc: row.existing_ac },
    preferredBrand: row.preferred_brand,
    comments: row.comments,
    planUrl: row.plan_url,
    photoUrls: photos,
    assessment,
    state: row.state,
    closedReason: row.closed_reason,
    links: { designId: row.design_id, quoteId: row.quote_id,
             issuedToken: row.issued_token, legacyQuoteId: row.legacy_quote_id },
    updatedAt: row.updated_at
  });
}

/**
 * The enquiries the BOARD shows, and the ops assistant sees.
 *
 * @param {Array|null} enquiries  null means the source could not be read
 * @returns {Array|null} null stays null all the way through. A panel fed null
 *   reports itself unavailable; it never shows an empty list, because an empty
 *   list reads as "no enquiries today" and that is the one thing it must not
 *   say when it does not know.
 */
export function openEnquiries(enquiries) {
  if (!Array.isArray(enquiries)) return null;
  return enquiries
    .map(normaliseEnquiry)
    .filter(e => e.state === ENQUIRY_STATE.NEW || e.state === ENQUIRY_STATE.ASSESSING)
    .map(e => ({
      id: e.id,
      customerName: e.customer.name,
      siteAddress: e.site.address,
      // The board's own row builder asks for these to decide what is missing.
      phone: e.customer.phone,
      email: e.customer.email,
      receivedAt: e.receivedAt,
      state: e.state,
      hasPlan: !!e.planUrl,
      designId: e.links.designId
    }));
}

export default {
  ENQUIRY_SCHEMA, ENQUIRY_STATE, ENQUIRY_SOURCE, ENQUIRY_SELECT, LEGACY_MARKER,
  enquiryId, parseAssessmentPack, normaliseEnquiry, missingFrom, enquiryFromIntake,
  isLegacyEnquiryRow, enquiryFromLegacyQuoteRow, linkEnquiry, toRow, fromRow,
  openEnquiries
};
