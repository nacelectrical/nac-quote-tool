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

// Every rule below comes from the NAC DUCT DESIGN STANDARD. This module used
// to hold its own copy of the exclusion list, which is exactly how the list in
// the classifier and the list in the drawing drifted apart.
import {
  CONDITIONING, EXCLUDED_ROOMS, CONDITIONED_ROOMS, FIXTURE_INSIDE_A_ROOM,
  OUTDOOR_AREAS, EXCLUDED_BANNER, normaliseRoomLabel, roomMatchForm
} from './nac-standard.mjs';

export { CONDITIONING, EXCLUDED_BANNER, normaliseRoomLabel };

export const CONDITIONING_LABELS = {
  CONDITIONED: 'Conditioned',
  NON_CONDITIONED: 'Excluded from air conditioning',
  REVIEW_REQUIRED: 'Classification needs a decision'
};

const EXCLUDED = EXCLUDED_ROOMS;
const matchForm = roomMatchForm;

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
