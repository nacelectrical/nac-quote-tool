// ─────────────────────────────────────────────────────────────────────────────
// QUOTE PRESENTATION CONTENT LIBRARY
//
// Everything in here is a claim NAC makes about itself or about somebody else's
// home, in front of a customer deciding whether to spend fifteen thousand
// dollars. That makes it a different kind of data from a duct diameter: a wrong
// diameter is found on the day, a fabricated review is found by the person who
// supposedly wrote it.
//
// Nick: "Never fabricate, paraphrase or improve a customer review. Never create
// a fake name, suburb, rating or review source." And: "Do not invent licence
// numbers, awards, memberships or years in business."
//
// So this module holds records and gates, and no generator. There is no code
// path here that writes review text, a customer name, a suburb, a rating or a
// licence number — every one of those fields arrives from a person and is
// carried through untouched. What the module DOES do is refuse to publish
// anything that has not been approved, and reduce what is published to the
// least identifying form that still works.
//
// It knows nothing about designs, airflow or prices. The presentation builder
// hands it evidence; it hands back what may be shown.
// ─────────────────────────────────────────────────────────────────────────────

/** How NAC came to be allowed to republish somebody's words. */
export const PERMISSION = Object.freeze({
  /** Already published by the reviewer on a public platform (Google, Facebook). */
  PUBLIC_SOURCE: 'public_source',
  /** The customer gave NAC permission directly. */
  WRITTEN: 'written_permission',
  /** No permission on file. Never publishable. */
  NONE: 'none'
});

/** How much of a past job's location the customer agreed NAC may show. */
export const CONSENT = Object.freeze({
  /** Street address may be shown. Rare, and never the default. */
  GRANTED: 'granted',
  /** Suburb only. This is what NAC asks for and what it normally gets. */
  SUBURB_ONLY: 'suburb_only',
  /** Nothing may be shown. Never publishable. */
  NONE: 'none'
});

export const REVIEW_SOURCES = Object.freeze([
  'google', 'facebook', 'product_review', 'email', 'sms', 'word_of_mouth', 'other'
]);

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
const bool = (v) => v === true || v === 'true';
// Absent must stay absent: Number(null) and Number('') are both 0, which would
// turn "no rating recorded" into a zero-star review and "no capacity" into 0 kW.
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const list = (v) => Array.isArray(v) ? v.filter(x => x !== null && x !== undefined) : [];
const tags = (v) => list(v).map(t => trimmed(t).toLowerCase()).filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a review record for storage.
 *
 * `text` is deliberately NOT cleaned, collapsed, sentence-cased or corrected.
 * It is stored exactly as the reviewer wrote it, because the moment this code
 * "tidies" a review it is putting words the customer did not write in their
 * mouth. Leading and trailing whitespace is the only thing removed, and the
 * untouched original is kept alongside so the two can be compared later.
 */
export function normaliseReview(input = {}) {
  const raw = str(input.text);
  return {
    kind: 'review',
    id: trimmed(input.id) || null,
    text: raw.trim(),
    textOriginal: raw,
    displayName: trimmed(input.displayName),
    // Whether the surname in displayName may be shown in full. A Google review
    // is already published under that name; a private one usually is not.
    surnameApproved: bool(input.surnameApproved),
    suburb: trimmed(input.suburb),
    suburbApproved: input.suburbApproved === undefined ? true : bool(input.suburbApproved),
    rating: num(input.rating),
    source: REVIEW_SOURCES.includes(trimmed(input.source)) ? trimmed(input.source) : 'other',
    sourceUrl: trimmed(input.sourceUrl) || null,
    reviewDate: trimmed(input.reviewDate) || null,
    approved: bool(input.approved),
    permissionStatus: Object.values(PERMISSION).includes(input.permissionStatus)
      ? input.permissionStatus : PERMISSION.NONE,
    tags: tags(input.tags),
    featured: bool(input.featured),
    addedBy: trimmed(input.addedBy) || null,
    addedAt: trimmed(input.addedAt) || null
  };
}

/**
 * May this review be shown to a customer?
 *
 * Four independent things must all be true, and the reasons are returned rather
 * than collapsed to a boolean so the admin screen can say WHICH one is missing
 * instead of greying out a row with no explanation.
 */
export function reviewPublishable(review) {
  const r = review || {};
  const reasons = [];
  if (!bool(r.approved)) reasons.push('Not approved for marketing use.');
  if (r.permissionStatus === PERMISSION.NONE || !r.permissionStatus) {
    reasons.push('No permission or public source recorded.');
  }
  if (!trimmed(r.text)) reasons.push('Review text is empty.');
  if (!trimmed(r.displayName)) reasons.push('No display name recorded.');
  const rating = num(r.rating);
  if (rating === null || rating < 1 || rating > 5) reasons.push('Star rating must be 1 to 5.');
  return { ok: reasons.length === 0, reasons };
}

/**
 * The name a customer is allowed to see.
 *
 * A review published on Google already carries that name in public, so it is
 * shown as published. Anything else is reduced to a first name and an initial
 * unless the surname was explicitly approved — a testimonial should never be
 * the reason a past customer becomes searchable.
 */
export function publicDisplayName(review) {
  const r = review || {};
  const name = trimmed(r.displayName);
  if (!name) return '';
  if (r.surnameApproved || r.permissionStatus === PERMISSION.PUBLIC_SOURCE) return name;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}

/** The suburb a customer is allowed to see — blank when it was not approved. */
export function publicSuburb(record) {
  const r = record || {};
  return r.suburbApproved === false ? '' : trimmed(r.suburb);
}

/**
 * The customer-facing form of a review: exact words, reduced identity.
 *
 * `text` is passed through by reference to the stored value, never rebuilt, so
 * that a test can assert byte equality against the library record.
 */
export function publicReview(review) {
  const r = normaliseReview(review);
  return {
    id: r.id,
    text: r.text,
    name: publicDisplayName(r),
    suburb: publicSuburb(r),
    rating: r.rating,
    source: r.source,
    sourceUrl: r.sourceUrl,
    reviewDate: r.reviewDate
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PAST INSTALLATIONS
// ─────────────────────────────────────────────────────────────────────────────

export function normaliseInstallation(input = {}) {
  return {
    kind: 'installation',
    id: trimmed(input.id) || null,
    coverImageId: trimmed(input.coverImageId) || null,
    imageIds: list(input.imageIds).map(trimmed).filter(Boolean),
    suburb: trimmed(input.suburb),
    streetAddress: trimmed(input.streetAddress) || null,
    brand: trimmed(input.brand),
    systemType: trimmed(input.systemType),
    capacityKw: num(input.capacityKw),
    zoneCount: num(input.zoneCount),
    description: trimmed(input.description),
    completedDate: trimmed(input.completedDate) || null,
    consentStatus: Object.values(CONSENT).includes(input.consentStatus)
      ? input.consentStatus : CONSENT.NONE,
    approved: bool(input.approved),
    featured: bool(input.featured),
    tags: tags(input.tags)
  };
}

export function installationPublishable(install, imagesById = {}) {
  const i = install || {};
  const reasons = [];
  if (!bool(i.approved)) reasons.push('Not approved for marketing use.');
  if (i.consentStatus === CONSENT.NONE || !i.consentStatus) {
    reasons.push('No customer consent recorded for showing this job.');
  }
  if (!trimmed(i.suburb)) reasons.push('No suburb recorded.');
  // A gallery card with no picture is an empty box, and Nick asked for no empty
  // cards rather than a card that quietly renders nothing.
  const cover = i.coverImageId ? imagesById[i.coverImageId] : null;
  if (!cover) reasons.push('No cover image on file.');
  else if (!bool(cover.approved)) reasons.push('Cover image is not approved for marketing use.');
  else if (!publicImageRef(cover)) reasons.push('Cover image has no web-safe derivative yet.');
  return { ok: reasons.length === 0, reasons };
}

/**
 * The customer-facing form of a past job.
 *
 * Location is suburb-level unless the customer explicitly agreed otherwise —
 * the street address is dropped here rather than in the template, so no future
 * template change can put it back.
 */
export function publicInstallation(install, imagesById = {}) {
  const i = normaliseInstallation(install);
  const pick = (id) => {
    const a = imagesById[id];
    return (a && bool(a.approved) && publicImageRef(a))
      ? { id: a.id, src: publicImageRef(a), alt: trimmed(a.alt), srcset: publicImageSrcset(a),
          width: derivativeOf(a)?.width ?? null, height: derivativeOf(a)?.height ?? null }
      : null;
  };
  const cover = pick(i.coverImageId);
  const images = i.imageIds.map(pick).filter(Boolean);
  return {
    id: i.id,
    cover,
    images,
    location: i.consentStatus === CONSENT.GRANTED && i.streetAddress
      ? i.streetAddress : trimmed(i.suburb),
    brand: i.brand,
    systemType: i.systemType,
    capacityKw: i.capacityKw,
    zoneCount: i.zoneCount,
    description: i.description,
    completedDate: i.completedDate
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE ASSETS
//
// The original upload is kept privately and is never referenced by a customer
// page. Only derivatives are public, and a derivative only exists once it has
// been re-encoded — which is what removes EXIF and GPS. An asset with no
// derivative therefore cannot leak metadata, because there is nothing to serve.
// ─────────────────────────────────────────────────────────────────────────────

export function normaliseImageAsset(input = {}) {
  const derivatives = list(input.derivatives).map(d => ({
    ref: trimmed(d.ref),
    width: num(d.width),
    height: num(d.height),
    format: trimmed(d.format) || 'jpeg',
    bytes: num(d.bytes)
  })).filter(d => d.ref && d.width);
  derivatives.sort((a, b) => a.width - b.width);
  return {
    kind: 'image',
    id: trimmed(input.id) || null,
    alt: trimmed(input.alt),
    focalPoint: {
      x: Math.min(1, Math.max(0, num(input.focalPoint?.x) ?? 0.5)),
      y: Math.min(1, Math.max(0, num(input.focalPoint?.y) ?? 0.5))
    },
    approved: bool(input.approved),
    tags: tags(input.tags),
    // Private. Never rendered into a customer page.
    original: input.original ? {
      ref: trimmed(input.original.ref),
      width: num(input.original.width),
      height: num(input.original.height),
      bytes: num(input.original.bytes)
    } : null,
    derivatives,
    exifStripped: bool(input.exifStripped),
    gpsRemoved: bool(input.gpsRemoved)
  };
}

/** The largest derivative — what a customer page loads at full width. */
export function derivativeOf(asset, minWidth = 0) {
  const ds = (asset?.derivatives || []).filter(d => d.width >= minWidth);
  return ds.length ? ds[ds.length - 1] : ((asset?.derivatives || [])[0] || null);
}

export function publicImageRef(asset) {
  const d = derivativeOf(asset);
  return d ? d.ref : null;
}

/** Responsive candidates, so a phone never downloads the desktop image. */
export function publicImageSrcset(asset) {
  return (asset?.derivatives || []).map(d => ({ ref: d.ref, width: d.width, format: d.format }));
}

export function imagePublishable(asset) {
  const a = asset || {};
  const reasons = [];
  if (!bool(a.approved)) reasons.push('Not approved for marketing use.');
  if (!bool(a.exifStripped) || !bool(a.gpsRemoved)) {
    reasons.push('Metadata has not been stripped from this image.');
  }
  if (!publicImageRef(a)) reasons.push('No web derivative has been generated.');
  if (!trimmed(a.alt)) reasons.push('No alt text — required for accessibility.');
  return { ok: reasons.length === 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTION
//
// A quote should show the jobs and reviews that look most like the customer's
// own job. Scoring is deliberately simple and explainable, because an estimator
// has to be able to look at a gallery and understand why those four are there.
// ─────────────────────────────────────────────────────────────────────────────

function relevanceScore(record, ctx = {}) {
  let score = 0;
  const brand = trimmed(ctx.brand).toLowerCase();
  const systemType = trimmed(ctx.systemType).toLowerCase();
  const suburb = trimmed(ctx.suburb).toLowerCase();
  const recTags = tags(record.tags);

  if (brand && trimmed(record.brand).toLowerCase() === brand) score += 30;
  if (brand && recTags.includes(brand)) score += 12;
  if (systemType && trimmed(record.systemType).toLowerCase() === systemType) score += 18;
  if (systemType && recTags.includes(systemType)) score += 8;
  if (suburb && trimmed(record.suburb).toLowerCase() === suburb) score += 25;
  for (const t of tags(ctx.tags)) if (recTags.includes(t)) score += 6;
  if (bool(record.featured)) score += 20;

  // Newer work first, gently — a good job from last month beats an equally
  // good one from four years ago, but relevance still outranks recency.
  const when = Date.parse(record.completedDate || record.reviewDate || '');
  if (Number.isFinite(when)) {
    const years = (Date.now() - when) / (365.25 * 24 * 3600 * 1000);
    score += Math.max(-10, 8 - years * 2.5);
  }
  return score;
}

/**
 * Pick reviews for a quote.
 *
 * Manual selection always wins: when the estimator has named the reviews for
 * this quote, that order is the order, and nothing is auto-added around it.
 */
export function selectReviews(library = [], ctx = {}) {
  const min = ctx.min ?? 3, max = ctx.max ?? 6;
  const byId = new Map();
  for (const r of library.map(normaliseReview)) if (r.id) byId.set(r.id, r);

  const publishable = (r) => reviewPublishable(r).ok;

  if (list(ctx.selectedIds).length) {
    return list(ctx.selectedIds).map(id => byId.get(trimmed(id)))
      .filter(Boolean).filter(publishable).slice(0, max);
  }
  const pool = [...byId.values()].filter(publishable)
    .filter(r => !list(ctx.excludedIds).map(trimmed).includes(r.id));
  pool.sort((a, b) => relevanceScore(b, ctx) - relevanceScore(a, ctx));
  const picked = pool.slice(0, max);
  // Below the minimum the section is not "thin", it is absent — three reviews
  // reads as a track record, one reads as the only one they could find.
  return picked.length >= min ? picked : [];
}

/** Pick past installations for a quote. 0 to 6; 0 means hide the section. */
export function selectInstallations(library = [], imagesById = {}, ctx = {}) {
  const max = Math.min(ctx.max ?? 6, 6);
  const byId = new Map();
  for (const i of library.map(normaliseInstallation)) if (i.id) byId.set(i.id, i);

  const publishable = (i) => installationPublishable(i, imagesById).ok;

  if (list(ctx.selectedIds).length) {
    return list(ctx.selectedIds).map(id => byId.get(trimmed(id)))
      .filter(Boolean).filter(publishable).slice(0, max);
  }
  const pool = [...byId.values()].filter(publishable)
    .filter(i => !list(ctx.excludedIds).map(trimmed).includes(i.id));
  pool.sort((a, b) => relevanceScore(b, ctx) - relevanceScore(a, ctx));
  return pool.slice(0, max);
}

// ─────────────────────────────────────────────────────────────────────────────
// INCLUSIONS
//
// Nick: "Only show an inclusion when the actual quote contains it. Never claim
// an item is included based only on template wording."
//
// So an inclusion card is a pair: wording NAC controls, and a key naming the
// piece of EVIDENCE that proves the job actually contains it. The wording lives
// here; the evidence is computed from the design and the bill of materials by
// the presentation builder. A card whose evidence is false or missing is not
// rendered, so adding a card to this list can never, by itself, make a promise.
// ─────────────────────────────────────────────────────────────────────────────

export const INCLUSION_CATALOGUE = Object.freeze([
  { key: 'indoor_unit',      icon: 'unit',      title: 'Indoor fan coil unit',
    blurb: 'Supplied, installed and mounted in the roof space.' },
  { key: 'outdoor_unit',     icon: 'outdoor',   title: 'Outdoor condensing unit',
    blurb: 'Supplied, installed and set on a level mounting base.' },
  { key: 'outlets',          icon: 'outlet',    title: 'Supply air outlets',
    blurb: 'Ceiling outlets to each conditioned area.' },
  { key: 'returns',          icon: 'return',    title: 'Return air grilles',
    blurb: 'Filtered return air, sized for the system airflow.' },
  { key: 'zoning',           icon: 'zone',      title: 'Motorised zoning',
    blurb: 'Motorised dampers so you condition only the areas you are using.' },
  { key: 'controller',       icon: 'control',   title: 'Wall controller',
    blurb: 'Wall-mounted controller in a central location.' },
  { key: 'wifi',             icon: 'wifi',      title: 'Wi-Fi control',
    blurb: 'Control your system from your phone, at home or away.' },
  { key: 'ductwork',         icon: 'duct',      title: 'Insulated ductwork',
    blurb: 'Insulated flexible ductwork throughout.' },
  { key: 'pipework',         icon: 'pipe',      title: 'Refrigeration pipework',
    blurb: 'Insulated refrigeration pipework between indoor and outdoor units.' },
  { key: 'condensate',       icon: 'drain',     title: 'Condensate drainage',
    blurb: 'Condensate drain run to an approved discharge point.' },
  { key: 'electrical',       icon: 'power',     title: 'Electrical connection',
    blurb: 'Connection by our own licensed electricians.' },
  { key: 'commissioning',    icon: 'check',     title: 'Commissioning and handover',
    blurb: 'System tested, balanced and demonstrated to you on completion.' },
  { key: 'waste_removal',    icon: 'waste',     title: 'Removal of installation waste',
    blurb: 'We take our packaging and offcuts with us.' },
  { key: 'equipment_warranty', icon: 'shield',  title: 'Manufacturer warranty',
    blurb: 'Full manufacturer warranty on all supplied equipment.' },
  { key: 'workmanship_warranty', icon: 'badge', title: 'NAC workmanship warranty',
    blurb: 'Our own warranty on the installation itself.' }
]);

/**
 * Turn evidence into cards.
 *
 * `evidence[key]` must be strictly `true` — not merely truthy — for a card to
 * appear. An undefined key, a zero count or a null means "this job has not been
 * shown to contain it", and the card is dropped rather than guessed at.
 */
export function resolveInclusions(evidence = {}, catalogue = INCLUSION_CATALOGUE) {
  return catalogue
    .filter(c => evidence[c.key] === true)
    .map(c => ({ key: c.key, icon: c.icon, title: c.title,
                 blurb: trimmed(evidence[c.key + '_detail']) || c.blurb }));
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUST AND COMPANY DETAIL
//
// Every field here is blank by default. A blank field is omitted from the
// customer page; it is never filled with a plausible-looking default, because a
// plausible-looking default licence number is a fabricated licence number.
// ─────────────────────────────────────────────────────────────────────────────

export const EMPTY_TRUST = Object.freeze({
  businessName: '',
  abn: '',
  electricalLicence: '',
  arcAuthorisation: '',
  serviceArea: '',
  workmanshipWarranty: '',
  manufacturerWarranty: '',
  insuranceStatement: '',
  memberships: [],
  phone: '',
  email: '',
  website: '',
  points: []
});

export function normaliseTrust(input = {}) {
  const t = { ...EMPTY_TRUST, ...(input || {}) };
  return {
    businessName: trimmed(t.businessName),
    abn: trimmed(t.abn),
    electricalLicence: trimmed(t.electricalLicence),
    arcAuthorisation: trimmed(t.arcAuthorisation),
    serviceArea: trimmed(t.serviceArea),
    workmanshipWarranty: trimmed(t.workmanshipWarranty),
    manufacturerWarranty: trimmed(t.manufacturerWarranty),
    insuranceStatement: trimmed(t.insuranceStatement),
    memberships: list(t.memberships).map(trimmed).filter(Boolean),
    phone: trimmed(t.phone),
    email: trimmed(t.email),
    website: trimmed(t.website),
    points: list(t.points).map(trimmed).filter(Boolean)
  };
}

/** Only the fields that were actually filled in, as label/value pairs. */
export function trustFacts(trust) {
  const t = normaliseTrust(trust);
  const out = [];
  const add = (label, value) => { if (value) out.push({ label, value }); };
  add('ABN', t.abn);
  add('Electrical contractor licence', t.electricalLicence);
  add('ARC refrigeration authorisation', t.arcAuthorisation);
  add('Service area', t.serviceArea);
  add('Workmanship warranty', t.workmanshipWarranty);
  add('Manufacturer warranty', t.manufacturerWarranty);
  add('Insurance', t.insuranceStatement);
  if (t.memberships.length) add('Memberships', t.memberships.join(', '));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONAL UPGRADES
// ─────────────────────────────────────────────────────────────────────────────

export function normaliseUpgrade(input = {}) {
  return {
    kind: 'upgrade',
    id: trimmed(input.id) || null,
    title: trimmed(input.title),
    description: trimmed(input.description),
    priceIncGst: num(input.priceIncGst),
    // What must be true of the design for this upgrade to be offerable. Each
    // entry is a key the presentation builder evaluates against the real job.
    requires: list(input.requires).map(trimmed).filter(Boolean),
    /** Mutually exclusive group — picking one deselects the others. */
    group: trimmed(input.group) || null,
    enabled: input.enabled === undefined ? true : bool(input.enabled),
    sortOrder: num(input.sortOrder) ?? 0
  };
}

/**
 * Which upgrades may be offered on this job, and why the others may not.
 *
 * Nick: "A customer must not be able to select an incompatible upgrade." So
 * incompatible options are not rendered disabled — they are not rendered. The
 * reason is returned for the estimator's screen only.
 */
export function resolveUpgrades(library = [], capabilities = {}) {
  const offerable = [], withheld = [];
  for (const u of library.map(normaliseUpgrade).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!u.enabled || !u.title) continue;
    if (u.priceIncGst === null) {
      withheld.push({ ...u, reason: 'No price configured.' });
      continue;
    }
    const missing = u.requires.filter(r => capabilities[r] !== true);
    if (missing.length) {
      withheld.push({ ...u, reason: 'Not compatible with this design: ' + missing.join(', ') });
      continue;
    }
    offerable.push(u);
  }
  return { offerable, withheld };
}
