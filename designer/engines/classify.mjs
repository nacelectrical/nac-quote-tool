// NAC AI HVAC DESIGNER — THE ONE ROOM CLASSIFICATION ENGINE.
//
// Every part of the application that needs to know whether a room is air
// conditioned asks this module and nothing else: verification, loads, airflow,
// outlets, zoning, duct routing, BOM, warnings, the plan drawing and the
// reports. That is the whole point of it existing.
//
// The failure it prevents is the one that showed up onsite: BATHROOM excluded
// from the load calculation but still sitting in the verification queue asking
// the estimator for dimensions it will never use. If an exclusion lives in two
// places it will disagree with itself eventually, so it lives here.
//
// Three states, not two:
//
//   CONDITIONED      — NAC air conditions this space.
//   NON_CONDITIONED  — NAC does not. It is drawn, listed, and otherwise ignored.
//   REVIEW_REQUIRED  — the label does not say. The estimator is asked, once.
//
// REVIEW_REQUIRED exists because "I could not tell" and "no" are different
// answers, and silently treating the first as the second is how a room drops
// out of a system that was supposed to condition it.

export const CONDITIONING = {
  CONDITIONED: 'CONDITIONED',
  NON_CONDITIONED: 'NON_CONDITIONED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED'
};

export const CONDITIONING_LABELS = {
  CONDITIONED: 'Conditioned',
  NON_CONDITIONED: 'Excluded from air conditioning',
  REVIEW_REQUIRED: 'Classification needs a decision'
};

/** The wording Nick asked to see against an excluded room, verbatim. */
export const EXCLUDED_BANNER = 'EXCLUDED FROM AIR CONDITIONING';

// ── Label normalisation ──────────────────────────────────────────────────────
// Australian builders' plans write the same room half a dozen ways. "W.I.R.",
// "WIR", "W I R", "En-suite", "ENSUITE", "L'DRY", "CUP'D". One spelling per
// room is a fantasy, so every label is flattened to a comparable form before a
// single pattern is tried.

/**
 * Collapse dotted initialisms, straighten curly quotes, and fold the
 * separators Australian plans use inside a single room name. "En-suite" and
 * "En suite" both have to reach the `ensuite` pattern or a hyphen silently
 * turns an ensuite into a conditioned room — which is exactly what it did.
 */
export function normaliseRoomLabel(label) {
  return String(label || '')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, ''))   // W.I.R. -> WIR
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The form the patterns actually run against: lower case, hyphens and
 * apostrophes removed so "En-suite" reads as "ensuite" and "L'DRY" as "ldry",
 * and every remaining non-letter turned into a space so word boundaries work.
 */
function matchForm(label) {
  return normaliseRoomLabel(label)
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/-/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── The exclusion list ───────────────────────────────────────────────────────
// NAC's standing rule, written out. Each entry carries the plain-English reason
// the estimator is shown, so the screen can say WHY a room was dropped rather
// than just dropping it.

const EXCLUDED = [
  // Wet areas
  { re: /\bbath ?rooms?\b|\bbaths?\b|\bbthrm\b|\bbath rm\b/, name: 'Bathroom', why: 'Bathroom — NAC does not air condition wet areas.' },
  // "En-suite" and "En suite" are both common in print. The hyphen is folded
  // away in matchForm; the SPACE has to be matched here, or a plan that prints
  // it as two words puts a wet area into the load.
  { re: /\bensuites?\b|\ben suites?\b|\bens\b|\bensuit\b/, name: 'Ensuite', why: 'Ensuite — NAC does not air condition wet areas.' },
  { re: /\bwcs?\b|\bw c\b|\btoilets?\b|\bwater closet\b|\blav\b|\blavatory\b/, name: 'WC', why: 'Toilet / WC — NAC does not air condition wet areas.' },
  { re: /\bpowder( room| rm)?\b|\bpdr\b/, name: 'Powder room', why: 'Powder room — NAC does not air condition wet areas.' },
  { re: /\blaundry\b|\bldry\b|\blndry\b|\blaund\b|\bl dry\b/, name: 'Laundry', why: 'Laundry — NAC does not air condition laundries.' },

  // Vehicle and outdoor
  { re: /\bgarages?\b|\bgge\b|\bgar\b/, name: 'Garage', why: 'Garage — outside the conditioned envelope.' },
  { re: /\bcar ?ports?\b/, name: 'Carport', why: 'Carport — outside the conditioned envelope.' },
  { re: /\balfrescos?\b/, name: 'Alfresco', why: 'Alfresco — an outdoor area.' },
  { re: /\bporch(es)?\b|\bporticos?\b/, name: 'Porch', why: 'Porch — an outdoor area.' },
  { re: /\bpatios?\b/, name: 'Patio', why: 'Patio — an outdoor area.' },
  { re: /\bverandahs?\b|\bverandas?\b|\bvrndh\b/, name: 'Verandah', why: 'Verandah — an outdoor area.' },
  { re: /\bdecks?\b|\bbalcon(y|ies)\b|\bcourt ?yards?\b|\bterraces?\b|\boutdoor\b/, name: 'Outdoor area', why: 'Outdoor area — outside the conditioned envelope.' },

  // Storage — the long tail, which is where plans get creative
  { re: /\bpantr(y|ies)\b|\bptry\b|\bpntry\b|\bpan\b/, name: 'Pantry', why: 'Pantry — a storage space, not a conditioned room.' },
  { re: /\bwips?\b|\bwalk ?in ?pantr(y|ies)\b|\bbutlers? ?pantr(y|ies)\b|\bbutlers\b/, name: 'Walk-in pantry', why: 'Walk-in pantry — a storage space, not a conditioned room.' },
  { re: /\bwirs?\b|\bw i r\b|\bwalk ?in ?robes?\b|\bwalk ?in ?wardrobes?\b/, name: 'Walk-in robe', why: 'Walk-in robe — a storage space, not a conditioned room.' },
  { re: /\bbirs?\b|\bb i r\b|\bbuilt ?in ?robes?\b/, name: 'Built-in robe', why: 'Built-in robe — a storage space, not a conditioned room.' },
  { re: /\brobes?\b|\bwardrobes?\b|\bwdr\b/, name: 'Robe', why: 'Robe — a storage space, not a conditioned room.' },
  { re: /\bcup ?boards?\b|\bcupb\b|\bcupd\b|\bcpd\b|\bcbd\b|\bbroom\b|\bcloaks?\b/, name: 'Cupboard', why: 'Cupboard — a storage space, not a conditioned room.' },
  { re: /\blinens?\b|\blin\b/, name: 'Linen', why: 'Linen cupboard — a storage space, not a conditioned room.' },
  { re: /\bstores?\b|\bstorage\b|\bstore ?rooms?\b|\bstr\b/, name: 'Store', why: 'Store — a storage space, not a conditioned room.' },

  // Plant and voids
  { re: /\bplant( room| rm)?\b|\bswitch ?room\b|\bmeter ?box\b|\bmech(anical)? ?room\b/, name: 'Plant room', why: 'Plant room — not an occupied space.' },
  { re: /\bvoids?\b|\bstair ?wells?\b|\briser\b|\bduct ?shaft\b/, name: 'Void', why: 'Void — not a floor area NAC conditions.' },
  { re: /\bshed\b|\bpool\b|\bdriveway\b|\bwater ?tank\b|\bbin ?store\b/, name: 'External', why: 'Not part of the residence.' }
];

// ── Rooms NAC does condition ─────────────────────────────────────────────────
// A compound label has to be resolved by what the space PRIMARILY is, not by
// whichever token happens to match first. "BED 3 / ROBE" is a bedroom that has
// a robe in it, and it is air conditioned. "MASTER BEDROOM + WIR" likewise.
// The excluded token is describing a fixture inside a conditioned room, so the
// conditioned token wins.
//
// Kitchen is the case Nick called out by name: a kitchen is part of the
// open-plan living area and is conditioned, and it must not be dragged out by
// the pantry beside it.

const CONDITIONED_ROOMS = [
  { re: /\bmaster( bed(room)?| suite)?\b|\bbed ?rooms?\b|\bbeds? ?\d*\b|\bbdrm\b|\bbrm\b|\bguest( bed(room)?| room)?\b|\bnursery\b/, type: 'bedroom' },
  { re: /\bkitchens?\b|\bkitch\b|\bktn\b/, type: 'kitchen' },
  { re: /\bdining\b|\bmeals?\b|\bdine\b/, type: 'dining' },
  { re: /\blounges?\b|\blivings?\b|\bfamily\b|\brumpus\b|\bgames?\b|\bsitting\b|\bretreat\b|\bactivity\b|\bleisure\b/, type: 'living' },
  { re: /\bmedia\b|\btheatres?\b|\btheaters?\b|\bcinemas?\b|\bhome ?theatre\b/, type: 'media' },
  { re: /\bstud(y|ies)\b|\boffices?\b|\bhome ?office\b|\bden\b/, type: 'study' },
  { re: /\bhalls?\b|\bhall ?ways?\b|\bentr(y|ance)\b|\bfoyers?\b|\bpassages?\b|\bcorridors?\b|\blobby\b/, type: 'hallway' }
];

/**
 * A conditioned room whose label ALSO carries an excluded token. Only a
 * fixture that genuinely lives inside a habitable room qualifies — a robe, a
 * built-in, a cupboard, a pantry off a kitchen, a linen press. An ensuite off
 * a bedroom does NOT: it is a separate wet area behind a door, and NAC does
 * not condition it, so "BED 1 / ENSUITE" stays two rooms and the wet one is
 * still excluded on its own.
 */
const FIXTURE_INSIDE_A_ROOM = /\b(robes?|wardrobes?|wirs?|birs?|cup ?boards?|cupb|cupd|cpd|cbd|linens?|pantr(y|ies)|ptry|wips?|butlers?|stores?|storage)\b/;

// ── The classifier ───────────────────────────────────────────────────────────

/**
 * Classify a room label under NAC's rules.
 *
 * @returns {{status: string, reason: string, matched: string|null, roomType: string}}
 */
export function classifyRoomLabel(label) {
  const raw = normaliseRoomLabel(label);
  const l = matchForm(label);

  // An unnamed room is not an excluded room. The estimator drew it or the plan
  // reader found a boundary with no text against it, and guessing either way is
  // how floor area silently disappears. Ask.
  if (!l) {
    return { status: CONDITIONING.REVIEW_REQUIRED, matched: null, roomType: 'other',
             reason: 'This room has no name on the plan, so it cannot be classified automatically.' };
  }

  const conditionedHit = CONDITIONED_ROOMS.find(c => c.re.test(l));
  const excludedHit = EXCLUDED.find(e => e.re.test(l));

  // Both matched — an open-plan or fixture compound. Decide which is the room.
  if (conditionedHit && excludedHit) {
    if (FIXTURE_INSIDE_A_ROOM.test(l)) {
      return {
        status: CONDITIONING.CONDITIONED, matched: excludedHit.name, roomType: conditionedHit.type,
        reason: raw + ' is a conditioned room with a ' + excludedHit.name.toLowerCase() +
                ' in it. The room is conditioned; the ' + excludedHit.name.toLowerCase() + ' is not a separate space.'
      };
    }
    // A conditioned room compounded with a wet area or an outdoor area is two
    // spaces sharing one piece of text. That is a judgement call about the
    // plan, not about the rules, so it goes to the estimator.
    return {
      status: CONDITIONING.REVIEW_REQUIRED, matched: excludedHit.name, roomType: conditionedHit.type,
      reason: raw + ' reads as both a conditioned room and a ' + excludedHit.name.toLowerCase() +
              '. Confirm whether NAC conditions this space.'
    };
  }

  if (excludedHit) {
    return { status: CONDITIONING.NON_CONDITIONED, matched: excludedHit.name,
             roomType: 'other', reason: excludedHit.why };
  }

  if (conditionedHit) {
    return { status: CONDITIONING.CONDITIONED, matched: null, roomType: conditionedHit.type,
             reason: raw + ' is a habitable room and is air conditioned.' };
  }

  // Named, and not on the exclusion list. NAC's rule is a list of what is NOT
  // conditioned, so anything else is — a GYM, a SUNROOM, a CELLAR, whatever the
  // builder called it. Under-sizing is the expensive mistake, and sending the
  // estimator a question about every unusual room name is exactly the noise
  // this engine exists to remove.
  return { status: CONDITIONING.CONDITIONED, matched: null, roomType: 'other',
           reason: raw + ' is not on NAC\'s exclusion list, so it is air conditioned.' };
}

// ── Outdoor areas ────────────────────────────────────────────────────────────
// A separate question from conditioning. A builder's floor-area schedule lists
// the alfresco and the garage apart from the residence, so the cross-check
// against the printed total has to know which detected rooms are outside it.
// A garage is excluded from conditioning AND outdoors; a bathroom is excluded
// but very much indoors.

const OUTDOOR = /\balfrescos?\b|\bpatios?\b|\bverandahs?\b|\bverandas?\b|\bporch(es)?\b|\bporticos?\b|\bdecks?\b|\bbalcon(y|ies)\b|\bcourt ?yards?\b|\bterraces?\b|\bgarages?\b|\bcar ?ports?\b|\boutdoor\b/;

/** Is this label an area a floor-area schedule lists outside the residence? */
export function isOutdoorArea(label) {
  return OUTDOOR.test(matchForm(label));
}

// ── The single field every engine reads ──────────────────────────────────────

/**
 * The conditioning status of a room, honouring an estimator override.
 *
 * An override is final: if the estimator says this job conditions the big
 * laundry, it is conditioned, and nothing re-derives it from the label
 * afterwards.
 */
export function roomConditioningStatus(room) {
  if (!room) return CONDITIONING.REVIEW_REQUIRED;
  if (room.conditioningOverride === CONDITIONING.CONDITIONED) return CONDITIONING.CONDITIONED;
  if (room.conditioningOverride === CONDITIONING.NON_CONDITIONED) return CONDITIONING.NON_CONDITIONED;
  if (room.conditioningStatus) return room.conditioningStatus;
  // A room built before this field existed, or handed in with only the old
  // boolean set, still has to answer.
  if (typeof room.conditioned === 'boolean') {
    return room.conditioned ? CONDITIONING.CONDITIONED : CONDITIONING.NON_CONDITIONED;
  }
  return classifyRoomLabel(room.label || room.name).status;
}

/**
 * Does this room get load, airflow, outlets, a duct branch and a zone?
 *
 * REVIEW_REQUIRED is deliberately NOT conditioned yet. An unresolved room does
 * not quietly take part in the design — it is asked about first.
 */
export function isConditionedRoom(room) {
  return roomConditioningStatus(room) === CONDITIONING.CONDITIONED;
}

/** Excluded outright: drawn faintly, listed, and ignored by every engine. */
export function isExcludedRoom(room) {
  return roomConditioningStatus(room) === CONDITIONING.NON_CONDITIONED;
}

/** The tool could not tell. The estimator is asked once, on VERIFY. */
export function needsClassificationReview(room) {
  return roomConditioningStatus(room) === CONDITIONING.REVIEW_REQUIRED;
}

/**
 * Attach the classification to a room. The `conditioned` boolean is kept and
 * is always DERIVED from the status, never set independently — that is what
 * stops a room being excluded from the load but still conditioned in the
 * router.
 */
export function classifyRoom(room) {
  const status = roomConditioningStatus(room);
  const detail = classifyRoomLabel(room?.label || room?.name);
  return {
    ...room,
    conditioningStatus: status,
    conditioningReason: room?.conditioningOverride
      ? 'Set by the estimator on this job.'
      : detail.reason,
    conditioningSource: room?.conditioningOverride ? 'estimator' : 'auto',
    conditioningMatched: detail.matched,
    conditioned: status === CONDITIONING.CONDITIONED
  };
}

/** Counts for the UPLOAD screen: "10 CONDITIONED · 7 EXCLUDED AUTOMATICALLY". */
export function classificationSummary(rooms) {
  const list = rooms || [];
  const conditioned = list.filter(isConditionedRoom);
  const excluded = list.filter(isExcludedRoom);
  const review = list.filter(needsClassificationReview);
  return {
    total: list.length,
    conditionedCount: conditioned.length,
    excludedCount: excluded.length,
    reviewCount: review.length,
    conditioned, excluded, review,
    excludedLabels: excluded.map(r => r.label),
    // Grouped so the screen can say "2 bathrooms, 1 laundry, 3 robes" instead
    // of listing seven lines the estimator does not care about.
    excludedByKind: excluded.reduce((acc, r) => {
      const k = r.conditioningMatched || classifyRoomLabel(r.label).matched || 'Other';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {})
  };
}

/** Back-compat: the old boolean helper, now answering from the same rules. */
export function isConditionedLabel(label) {
  return classifyRoomLabel(label).status !== CONDITIONING.NON_CONDITIONED;
}

export function roomTypeFromLabel(label) {
  return classifyRoomLabel(label).roomType;
}
