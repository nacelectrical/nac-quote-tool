// ═══════════════════════════════════════════════════════════════════════════
// NAC DUCT DESIGN STANDARD
// ═══════════════════════════════════════════════════════════════════════════
//
// THE SINGLE SOURCE OF TRUTH for how NAC designs a ducted system.
//
// WHY THIS FILE EXISTS
//
// These rules used to live in eight places. The room exclusions were in the
// classifier, the duct ladder was in settings, the minimum final was in the
// sizing engine, the take-off shape was in the router, the reducer rule was in
// the BOM, and the drawing had its own idea about all of it. Every time one was
// corrected the others stayed as they were, so the same fault came back on the
// next job under a different name.
//
// So: a rule is written HERE, once, and every engine and every screen reads it
// from here. If two parts of the application can disagree about an NAC rule,
// that rule is in the wrong place.
//
// WHAT BELONGS IN THIS FILE
//
// NAC's INSTALL PRACTICE — the decisions a person made about how NAC builds a
// system. "200 is the smallest flex we fit." "A final never goes above 300."
// "The plenum leaves the fan coil as two or three mains." These are not physics
// and no calculation will produce them.
//
// WHAT DOES NOT
//
// Physics. Velocity from airflow and area, pressure drop from length and
// roughness, load from floor area — those stay in their engines, because they
// are true whoever is installing.
//
// The line between them matters: this file decides WHICH SIZES MAY BE CHOSEN,
// and the engines decide WHICH OF THOSE the air actually needs.
//
// HOW TO CHANGE A RULE
//
// Change it here. Do not add a second copy nearer to where you noticed the
// problem — that is what produced the mess this replaces. Every consumer is
// listed under CONSUMERS below; if you add one, add it to that list.
//
// CONSUMERS (every one of these reads this file and nothing else for NAC rules)
//
//   engines/classify.mjs       room exclusions, overrides
//   engines/settings.mjs       publishes the numbers into HVAC Design Settings
//   engines/airflow.mjs        conditioned rooms only
//   engines/outlets.mjs        final sizes, outlet counts, neck bands
//   engines/ducts.mjs          the ladder per role, reducer rule
//   engines/router.mjs         plenum mains, BTOs, routing style
//   engines/returnair.mjs      how many returns
//   engines/zones.mjs          open-plan grouping, zone colours
//   engines/pressure.mjs       what is on the index run
//   engines/bom.mjs            what gets bought per topology element
//   ui/quick-mode.mjs          the estimator workflow
//   ui/plan-viewer.mjs         the drawing standard

// ═══════════════════════════════════════════════════════════════════════════
// 1. ROOMS — what NAC air conditions
// ═══════════════════════════════════════════════════════════════════════════

export const CONDITIONING = {
  CONDITIONED: 'CONDITIONED',
  NON_CONDITIONED: 'NON_CONDITIONED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED'
};

/**
 * Rooms NAC does not air condition, with the reason the estimator is shown.
 *
 * Australian plans print the same room half a dozen ways — "W.I.R.", "WIR",
 * "En-suite", "L'DRY", "CUP'D" — so every pattern is matched against a
 * flattened form of the label (see roomMatchForm). One spelling per room is a
 * fantasy, and a hyphen that turned an ensuite into a conditioned room is a
 * mistake this list has already made once.
 */
export const EXCLUDED_ROOMS = [
  // Wet areas
  { re: /\bbath ?rooms?\b|\bbaths?\b|\bbthrm\b|\bbath rm\b/, name: 'Bathroom', why: 'Bathroom — NAC does not air condition wet areas.' },
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

/**
 * Rooms NAC does condition, and what kind of space each is.
 *
 * The type drives the open-plan grouping, the outlet count and the base load,
 * so it is decided here rather than three times over.
 */
export const CONDITIONED_ROOMS = [
  { re: /\bmaster( bed(room)?| suite)?\b|\bbed ?rooms?\b|\bbeds? ?\d*\b|\bbdrm\b|\bbrm\b|\bguest( bed(room)?| room)?\b|\bnursery\b/, type: 'bedroom' },
  { re: /\bkitchens?\b|\bkitch\b|\bktn\b/, type: 'kitchen' },
  { re: /\bdining\b|\bmeals?\b|\bdine\b/, type: 'dining' },
  { re: /\blounges?\b|\blivings?\b|\bfamily\b|\brumpus\b|\bgames?\b|\bsitting\b|\bretreat\b|\bactivity\b|\bleisure\b/, type: 'living' },
  { re: /\bmedia\b|\btheatres?\b|\btheaters?\b|\bcinemas?\b|\bhome ?theatre\b/, type: 'media' },
  { re: /\bstud(y|ies)\b|\boffices?\b|\bhome ?office\b|\bden\b/, type: 'study' },
  { re: /\bhalls?\b|\bhall ?ways?\b|\bentr(y|ance)\b|\bfoyers?\b|\bpassages?\b|\bcorridors?\b|\blobby\b/, type: 'hallway' }
];

/**
 * An excluded token that describes a FIXTURE inside a habitable room rather
 * than a separate space. "BED 3 / ROBE" is a bedroom with a robe in it and it
 * is air conditioned; the robe is not a room.
 *
 * An ensuite is deliberately NOT on this list. It is a separate wet area behind
 * a door, so "BED 1 / ENSUITE" is two spaces and has to be asked about.
 */
export const FIXTURE_INSIDE_A_ROOM =
  /\b(robes?|wardrobes?|wirs?|birs?|cup ?boards?|cupb|cupd|cpd|cbd|linens?|pantr(y|ies)|ptry|wips?|butlers?|stores?|storage)\b/;

/** Areas a builder's floor-area schedule lists apart from the residence. */
export const OUTDOOR_AREAS =
  /\balfrescos?\b|\bpatios?\b|\bverandahs?\b|\bverandas?\b|\bporch(es)?\b|\bporticos?\b|\bdecks?\b|\bbalcon(y|ies)\b|\bcourt ?yards?\b|\bterraces?\b|\bgarages?\b|\bcar ?ports?\b|\boutdoor\b/;

/** What an excluded room must never do. Asserted by the regression tests. */
export const EXCLUDED_ROOMS_NEVER = Object.freeze([
  'require verification',
  'require calibration',
  'contribute load',
  'receive airflow',
  'receive outlets',
  'receive zones',
  'receive ducts',
  'block design generation'
]);

/** The wording shown against an excluded room, on screen and on the drawing. */
export const EXCLUDED_BANNER = 'EXCLUDED FROM AIR CONDITIONING';

// ── Label handling ───────────────────────────────────────────────────────────

/** Collapse dotted initialisms and straighten quotes: "W.I.R." -> "WIR". */
export function normaliseRoomLabel(label) {
  return String(label || '')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** The form every pattern above is matched against. */
export function roomMatchForm(label) {
  return normaliseRoomLabel(label)
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/-/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. FINAL FLEX — what connects to an outlet
// ═══════════════════════════════════════════════════════════════════════════
//
// A velocity calculation will happily approve a 150 for a bedroom. NAC does not
// install that, and sizing to the smallest duct the physics permits is how a
// drawing ended up covered in 150s on rooms that get a 200 on site.
//
// So the install rules decide WHICH SIZES MAY BE CHOSEN and the velocity band
// chooses among them — never the other way round.

export const FINAL_FLEX = Object.freeze({
  /** The only sizes AUTO DESIGN may put on a final / outlet connection. */
  autoSizesMm: Object.freeze([200, 250, 300]),
  /** Never smaller automatically, whatever the velocity says. */
  minMm: 200,
  /**
   * Never larger on a final. A room wanting more air than one 300 should carry
   * gets ANOTHER OUTLET — 350 and 400 are main and major-branch sizes, not
   * outlet connections.
   */
  maxMm: 300,
  /** Available to the estimator by hand for a special case. Never automatic. */
  manualOnlyMm: Object.freeze([100, 125, 150])
});

/** The smallest duct AUTO DESIGN will choose for ANY run, trunk included. */
export const AUTO_MIN_DIAMETER_MM = 200;

/** Everything NAC stocks. 450 and 500 are absent: NAC never run them. */
export const STOCKED_DIAMETERS_MM = Object.freeze([100, 125, 150, 200, 250, 300, 350, 400]);
export const MAX_DIAMETER_MM = 400;

/** The smallest duct AUTO DESIGN will put on a room branch. */
export const BRANCH_MIN_MM = 200;

/**
 * NAC sizes a final more generously than a velocity calculation does. On NAC's
 * own Dungannon Court drawing a 65 L/s bedroom takes a 250 and the 110-125 L/s
 * living runs take a 300 — both a size up from the velocity band alone. These
 * bands reproduce that. Airflow is PER OUTLET, not per room.
 */
export const FINAL_SIZE_BY_AIRFLOW = Object.freeze([
  Object.freeze({ upToLs: 60, sizeMm: 200 }),
  Object.freeze({ upToLs: 110, sizeMm: 250 }),
  Object.freeze({ upToLs: 160, sizeMm: 300 })
  // Above the last band the room gets another outlet, never a bigger final.
]);

/**
 * Which diameters AUTO DESIGN may choose for a run of this role.
 *
 * This is the one place the answer exists. ducts.mjs asks it, the router asks
 * it, and the drawing shows whatever comes back.
 */
export function allowedDiametersFor(role) {
  if (role === 'final') {
    return {
      sizes: FINAL_FLEX.autoSizesMm.slice(),
      min: FINAL_FLEX.minMm,
      max: FINAL_FLEX.maxMm,
      rule: 'NAC final/outlet rule: ' + FINAL_FLEX.autoSizesMm.join(' / ') + ' mm only.'
    };
  }
  if (role === 'branch') {
    return {
      sizes: STOCKED_DIAMETERS_MM.filter(d => d >= BRANCH_MIN_MM && d <= MAX_DIAMETER_MM),
      min: BRANCH_MIN_MM,
      max: MAX_DIAMETER_MM,
      rule: 'NAC branch rule: nothing smaller than ' + BRANCH_MIN_MM + ' mm.'
    };
  }
  // main, trunk, return.
  return {
    sizes: STOCKED_DIAMETERS_MM.filter(d => d >= AUTO_MIN_DIAMETER_MM && d <= MAX_DIAMETER_MM),
    min: AUTO_MIN_DIAMETER_MM,
    max: MAX_DIAMETER_MM,
    rule: 'NAC fits nothing smaller than ' + AUTO_MIN_DIAMETER_MM + ' mm.'
  };
}

/**
 * The final flex size NAC fits for this much air through one outlet.
 *
 * The same bands the outlet neck uses, because the final duct and the neck it
 * connects to ARE the same size — a "250 diffuser" is a 250 neck on a 250 run.
 * Sizing the duct from velocity and the neck from practice was how the two
 * came out different on the same outlet.
 */
export function finalSizeForAirflow(perOutletLs) {
  const flow = Number(perOutletLs) || 0;
  const band = FINAL_SIZE_BY_AIRFLOW.find(b => flow <= b.upToLs);
  return band ? band.sizeMm : FINAL_FLEX.maxMm;
}

/** Is this a size AUTO DESIGN is allowed to put on a final? */
export function isLegalAutoFinal(diameterMm) {
  return FINAL_FLEX.autoSizesMm.includes(Number(diameterMm));
}

/**
 * The most air one final should carry, from the 300 cap and the final velocity
 * limit. Above this the room gets another outlet.
 */
export function maxAirflowPerOutletLs(maxVelocityMs) {
  const r = FINAL_FLEX.maxMm / 2000;              // mm -> m, radius
  return Math.PI * r * r * maxVelocityMs * 1000;  // m3/s -> L/s
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE BTO — how a final leaves the main
// ═══════════════════════════════════════════════════════════════════════════
//
//   MAIN FLEX → BTO → CORRECTLY SIZED FINAL FLEX → OUTLET
//
// The BTO is the transition. There is NO reducer between the main and the
// outlet: you do not fit a reducer to get down to outlet size, you fit a
// branch take-off of the size you want. Modelling it as a reducer put a fitting
// on the order that nobody installs and a pressure loss on the calculation that
// does not exist.

export const BTO = Object.freeze({
  /** A take-off serving this many rooms runs one major branch to the group. */
  minRoomsForMajorBranch: 2,
  /**
   * How far apart two rooms can be along a main and still share ONE take-off,
   * as a fraction of the house's longest side. Bigger means fewer, larger BTOs
   * feeding a group — the minor bedrooms off one branch — which is how a house
   * goes in. Smaller means a take-off per room, which is the central explosion
   * of branches that made the drawing unreadable.
   */
  clusterFraction: 0.12,
  /** What every BTO must record. Asserted by the regression tests. */
  requiredFields: Object.freeze(['parentDiameterMm', 'branchDiameterMm', 'branchAirflowLs', 'serves'])
});

/**
 * A take-off is never larger than the run that feeds it.
 *
 * The branch velocity band is tighter than the trunk band, so a major branch
 * carrying 324 L/s wanted a 350 while the trunk that fed it had already stepped
 * down to a 300. You cannot pull more out of a duct than is going into it, and
 * nobody fits a bigger branch on a smaller main.
 */
export function capBranchToParent(branchDiameterMm, parentDiameterMm) {
  if (!parentDiameterMm || !branchDiameterMm) return branchDiameterMm;
  return Math.min(branchDiameterMm, parentDiameterMm);
}

/**
 * Is a reducer genuinely needed between these two runs?
 *
 * ONLY where a main or major duct actually steps down because the air it is
 * still carrying has dropped. Never to reach outlet size — that is what the BTO
 * is for.
 */
/**
 * THE SMALLEST DUCT NAC RUNS AS A MAIN.
 *
 * Nick's call, and it settles the one thing the schedule could not: a main
 * that had reduced to 250 was taking 250 finals off itself — a full-bore
 * take-off with air still to carry past it. A main is not a 250.
 *
 * It is a floor on the MAIN only. A major branch is a branch, and a final is
 * sized from its airflow; neither is bound by this.
 */
export const MIN_MAIN_DIAMETER_MM = 300;

/**
 * How small a main is allowed to get.
 *
 * A main may only step down as far as the LARGEST FINAL still to come off it.
 * This is not a new rule — it falls straight out of two Nick has already
 * stated: a final's size comes from its airflow, and a take-off is never
 * larger than the run feeding it. Put together, a main that reduces past a
 * final it still has to serve forces that final down a size.
 *
 * It bit on the real plan: LOUNGE has two outlets at 74 L/s, and both should
 * be 250. The second one came off a stretch of main that had already stepped
 * to 200, so the same room got a 250 and a 200 for identical airflow. The
 * velocity band wanted the smaller main; the install rule outranks it, because
 * a slow main tail is harmless and an undersized final is noise at the
 * diffuser.
 *
 * @param {number} sizedMm       what velocity chose for this stretch
 * @param {number[]} finalsMm    every final still downstream of it
 * @param {number} childMainMm   the next stretch of the same main, if any
 */
export function mainFloorForFinals(sizedMm, finalsMm = [], childMainMm = null) {
  // A MAIN IS ALWAYS AT LEAST ONE STOCK SIZE ABOVE THE LARGEST FINAL COMING
  // OFF IT. Level with it is a FULL-BORE take-off: the whole main turning into
  // one room's flex while it still has air to carry past. That is what Nick
  // rejected at 250, and it came back at 300 the moment a 300 final appeared,
  // which is how you can tell it was never about the number.
  //
  // MIN_MAIN_DIAMETER_MM falls out of this rather than standing beside it: 250
  // finals are the common case, and the size above 250 is 300.
  const largestFinal = Math.max(0, ...finalsMm.filter(Boolean));
  const aboveFinals = largestFinal
    ? (STOCKED_DIAMETERS_MM.find(mm => mm > largestFinal) ?? largestFinal)
    : 0;
  const wants = [sizedMm || 0, aboveFinals];
  if (childMainMm) wants.push(childMainMm);
  return Math.max(...wants) || sizedMm;
}

export function reducerRequired(parentSection, childSection) {
  if (!parentSection || !childSection) return false;
  // A take-off is a take-off, not a reduction. This is the rule that used to be
  // wrong: every branch and final looked like a reducer because it was smaller
  // than the run it came off.
  if (childSection.role === 'branch' || childSection.role === 'final') return false;
  if (!parentSection.diameterMm || !childSection.diameterMm) return false;
  return parentSection.diameterMm !== childSection.diameterMm;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. SUPPLY PLENUM — how the air leaves the fan coil
// ═══════════════════════════════════════════════════════════════════════════
//
// The plenum is a real distribution point, not a tee. Air leaves the fan coil
// on TWO OR THREE mains, each serving a group of the house — the bedroom wing,
// the living/family/meals area, the master and study. One single trunk leaving
// the unit is not how NAC installs and it is not what gets drawn.

/**
 * How often a main is allowed to reduce along its length.
 *
 * A main carrying 700 L/s down to 70 will technically pass through every size
 * on the ladder, and stepping it at each one puts five reducers on one run.
 * Nobody fits that: reducers cost money, take time and add resistance, so a
 * main is reduced once or twice where the drop is worth it and run slightly
 * oversized in between.
 *
 * It also bounds the topology — a main with five reductions is five segments,
 * and a final reached through five contrived segments is the artificial-segment
 * failure the NAC rules name.
 */
export const MAIN_REDUCTIONS = Object.freeze({
  maxPerMain: 2,
  /** Ignore a step smaller than this — not worth a fitting. */
  minStepMm: 50,

  /**
   * How far a main must run before it may be reduced.
   *
   * The balanced plenum put a take-off 130 mm off the box on one main, and the
   * reduction planner duly reduced there — 130 mm of 350 flex and then a
   * reducer. Nobody installs that: you run the size off the plenum a sensible
   * way into the roof before you neck it down.
   */
  minStretchM: 1.5
});

export const SUPPLY_PLENUM = Object.freeze({
  minMains: 2,
  maxMains: 3,
  /** Below this the house genuinely only warrants two mains. */
  thirdMainAboveLs: 700,

  /**
   * EVERY DUCT OFF THE PLENUM IS THE SAME SIZE, AND THE AIR IS SHARED
   * EVENLY BETWEEN THEM.
   *
   * This is how the plenum is actually made up: two or three spigots of one
   * size, not one big duct and two small ones. It follows from what a plenum
   * is — a box with identical outlets — and it is what the Dungannon Court
   * sheet shows.
   *
   * It also changes how the house is divided. Grouping the outlets purely by
   * where they sit put 702 L/s down one main and 208 down another: same
   * plenum, wildly different ducts. The groups now have to come out balanced,
   * so the division is by AIR as well as by area.
   */
  sameSizeMains: true,

  /**
   * The sizes NAC makes a plenum up in, biggest first.
   *
   * 400 is the standard spigot — 2 × 400 or 3 × 400 depending on the system —
   * and the smaller two are for houses where a 400 would be so slow it is a
   * waste of duct. A plenum spigot is never smaller than a main, so this
   * ladder stops at MIN_MAIN_DIAMETER_MM.
   */
  mainSizesMm: Object.freeze([400, 350, 300]),

  /** Counts to try, most mains first: more mains means shorter runs. */
  mainCounts: Object.freeze([3, 2]),

  /**
   * How far off an even share a main may be.
   *
   * Rooms come in whole outlets, so a perfectly even split is not usually
   * available — three mains on a 1202 L/s house cannot each carry exactly
   * 400.7. This is the band within which the split still counts as balanced.
   */
  balanceTolerancePct: 15,

  /** What each main must record. */
  requiredFields: Object.freeze(['diameterMm', 'airflowLs', 'serves'])
});

/**
 * CHOOSE THE PLENUM: how many ducts leave it, and what size they all are.
 *
 * Both at once, because they are one decision. 1202 L/s off a plenum is
 * 2 × ø400 at 4.78 m/s or 3 × ø400 at 3.19 m/s, and only the first is a duct
 * moving air — so the count cannot be settled before the size.
 *
 * Tried biggest duct first (a 400 is the standard spigot), and within a size,
 * most mains first (shorter runs). The first combination that puts every main
 * inside the velocity band wins. If nothing does, the closest to the target is
 * taken and the caller is told it is out of band rather than being given a
 * quiet answer.
 *
 * @param systemLs  the whole supply airflow
 * @param band      { preferredMin, preferred, max } for a main, from settings
 */
export function choosePlenumMains(systemLs, band = { preferredMin: 4, preferred: 6, max: 8 }, opts = {}) {
  const sizes = opts.sizesMm || SUPPLY_PLENUM.mainSizesMm;
  const counts = opts.counts || SUPPLY_PLENUM.mainCounts;
  const options = [];
  for (const diameterMm of sizes) {
    for (const count of counts) {
      const perMainLs = systemLs / count;
      const r = diameterMm / 2000;
      const velocityMs = Math.round(((perMainLs / 1000) / (Math.PI * r * r)) * 100) / 100;
      options.push({
        count, diameterMm,
        perMainLs: Math.round(perMainLs),
        velocityMs,
        inBand: velocityMs >= band.preferredMin && velocityMs <= band.max
      });
    }
  }
  const inBand = options.filter(o => o.inBand);
  const pick = inBand[0] || [...options]
    .sort((a, b) => Math.abs(a.velocityMs - band.preferred) - Math.abs(b.velocityMs - band.preferred))[0];
  return {
    ...pick,
    options,
    reason: pick.count + ' \u00d7 \u00f8' + pick.diameterMm + ' at ' + pick.velocityMs +
      ' m/s' + (pick.inBand ? '' : ' \u2014 OUTSIDE the ' + band.preferredMin + '\u2013' +
        band.max + ' m/s band for a main') + '.'
  };
}

/**
 * How evenly the air is shared across the mains.
 *
 * Returns the mean, the worst deviation from it as a percentage, and whether
 * that is inside the tolerance above.
 */
export function plenumBalance(mainAirflowsLs = []) {
  const flows = mainAirflowsLs.filter(n => Number.isFinite(n) && n > 0);
  if (!flows.length) return { meanLs: 0, worstDeviationPct: 0, balanced: true, flows };
  const mean = flows.reduce((a, b) => a + b, 0) / flows.length;
  const worst = Math.max(...flows.map(f => Math.abs(f - mean) / mean * 100));
  return {
    meanLs: Math.round(mean),
    worstDeviationPct: Math.round(worst * 10) / 10,
    balanced: worst <= SUPPLY_PLENUM.balanceTolerancePct,
    flows
  };
}

/**
 * How many mains should leave the plenum for this system.
 *
 * Two by default; three once the system is big enough that a third genuinely
 * shortens the runs. Never one, and never four.
 */
export function mainSupplyCount(systemAirflowLs, roomCount = 0) {
  const flow = Number(systemAirflowLs) || 0;
  if (flow >= SUPPLY_PLENUM.thirdMainAboveLs && roomCount >= 6) return SUPPLY_PLENUM.maxMains;
  return SUPPLY_PLENUM.minMains;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. RETURN AIR
// ═══════════════════════════════════════════════════════════════════════════
//
// One return, or two. Not an arbitrary number, and never zero. Sizing comes
// from the selected unit and the design airflow, through the return engine —
// this file decides only HOW MANY.

/**
 * THE RETURN DUCT LADDER.
 *
 * Separate from the supply ladder on purpose. Nick's rule that NAC never fits
 * a 450 or a 500 is about SUPPLY — on the return a 450 is exactly what goes on
 * a big unit, because the whole system comes back through one or two ducts and
 * a 400 runs them too fast. On the 25 kW unit the returns are 2 × ø450.
 *
 * ONE DUCT PER RETURN POINT. The number of RETURNS is what scales with the
 * system; running two ducts back from one grille was double-counting, and the
 * drawing and the schedule disagreed with the return engine because of it.
 */
export const RETURN_DUCT_SIZES_MM = Object.freeze([350, 400, 450]);

export const RETURN_AIR = Object.freeze({
  minReturns: 1,
  maxReturns: 2,
  /**
   * Above this airflow a single return grille becomes impractical.
   *
   * A round number, and it was the wrong one: at 800 L/s it left the design on
   * ONE return, which the biggest return duct NAC fits cannot carry inside its
   * velocity band. The tool then reported a return at 5.03 m/s and told the
   * estimator to add another — right information, wrong design. It should just
   * fit two. So the real limit is worked out from the duct, below, and this is
   * only a ceiling on top of it.
   */
  secondReturnAboveLs: 900
});

/**
 * The most air ONE return point can take.
 *
 * The largest duct on the return ladder, at the fastest that duct is allowed to
 * run. Physics, not a round number — so it moves if the ladder or the band
 * moves, instead of quietly disagreeing with them.
 */
export function maxAirflowPerReturnLs(maxVelocityMs = 5) {
  const d = Math.max(...RETURN_DUCT_SIZES_MM) / 2000;
  return Math.PI * d * d * maxVelocityMs * 1000;   // m3/s -> L/s
}

export function returnCountFor(designAirflowLs, opts = {}) {
  if (opts.override === 1 || opts.override === 2) return opts.override;
  const flow = Number(designAirflowLs) || 0;
  const perReturnCap = maxAirflowPerReturnLs(opts.maxVelocityMs ?? 5);
  // Two returns once ONE duct cannot carry it, or once a single grille becomes
  // impractical — whichever comes first.
  return (flow > perReturnCap || flow >= RETURN_AIR.secondReturnAboveLs)
    ? RETURN_AIR.maxReturns : RETURN_AIR.minReturns;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. OUTLETS
// ═══════════════════════════════════════════════════════════════════════════
//
// Room airflow → BRANCH DUCT → OUTLET NECK → DIFFUSER FACE. Four different
// things; collapsing them into one number is how a diffuser came to be labelled
// with a duct size NAC would never install.

export const OUTLET_RULES = Object.freeze({
  byRoomType: Object.freeze({
    bedroom: Object.freeze({ preferred: 1, maxAuto: 2, splitOverM: 6.0, splitOverSqM: 20,
      note: 'One outlet unless the room is long enough to need two.' }),
    living: Object.freeze({ preferred: 1, maxAuto: 4, splitOverM: 5.0, splitOverSqM: 18,
      note: 'Living and family areas are spread across the space for throw.' }),
    dining: Object.freeze({ preferred: 1, maxAuto: 3, splitOverM: 5.5, splitOverSqM: 20 }),
    kitchen: Object.freeze({ preferred: 1, maxAuto: 2, splitOverM: 5.5, splitOverSqM: 20 }),
    media: Object.freeze({ preferred: 1, maxAuto: 2, splitOverM: 6.0, splitOverSqM: 22 }),
    study: Object.freeze({ preferred: 1, maxAuto: 1, splitOverM: 7.0, splitOverSqM: 25,
      note: 'A study is small — one outlet.' }),
    hallway: Object.freeze({ preferred: 1, maxAuto: 2, splitOverM: 8.0, splitOverSqM: 25 }),
    other: Object.freeze({ preferred: 1, maxAuto: 3, splitOverM: 5.5, splitOverSqM: 20 })
  }),
  /** A hard ceiling on outlets in one room, whatever the airflow wants. */
  maxPerRoom: 4,
  /** The neck is how NAC orders a diffuser: a "250 diffuser" is a 250 neck. */
  neckSizesMm: Object.freeze([200, 250, 300]),
  /**
   * Face size is a property of the diffuser model NAC chooses and cannot be
   * calculated from airflow. Left blank until the model is known, and reported
   * as such rather than guessed.
   */
  faceSizeByNeckMm: Object.freeze({}),
  faceSizeNote: 'Face size comes from the selected diffuser model — confirm with the supplier.'
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. ZONING AND OPEN PLAN
// ═══════════════════════════════════════════════════════════════════════════

export const ZONING = Object.freeze({
  /** Room types that form a single open-plan living area. */
  openPlanTypes: Object.freeze(['kitchen', 'dining', 'living']),
  /** Circulation joins what it opens onto but never starts a group. */
  circulationTypes: Object.freeze(['hallway']),
  /** How close two rooms must be to count as touching: one wall. */
  adjacencyToleranceMm: 400,
  /** One damper per ZONE, on the run that feeds the whole of it. */
  oneDamperPerZone: true
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. ROUTING STYLE
// ═══════════════════════════════════════════════════════════════════════════
//
// This is FLEXIBLE duct. It sweeps; it does not turn a square corner. A drawing
// made of right angles reads as a schematic rather than as something somebody
// is going to install.

export const ROUTING = Object.freeze({
  flexible: true,
  /** Corner radius on the drawing, in screen pixels, scaled by line weight. */
  bendRadiusPx: 14,
  /** Runs leave the plenum on square axes — flex does not run diagonally. */
  squareAxes: true,
  /** Never describe an auto route as installable. */
  notice: 'AUTO ROUTE — VERIFY SITE CONDITIONS, STRUCTURE AND CLEARANCES BEFORE INSTALLATION'
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. DRAWING STANDARD
// ═══════════════════════════════════════════════════════════════════════════

export const DRAWING = Object.freeze({
  /** What INSTALLER VIEW shows. Everything else is behind ADVANCED. */
  installerViewShows: Object.freeze([
    'floor plan', 'fan coil', 'supply plenum', 'main supply ducts', 'BTOs',
    'final flex runs', 'outlets', 'return ducts', 'zones', 'duct sizes'
  ]),
  /** What it hides. */
  installerViewHides: Object.freeze([
    'debug nodes', 'confidence overlays', 'calibration lines', 'route points',
    'engineering text', 'heavy zone shading', 'calculation boxes'
  ]),
  /** The default label against a run: the size, and nothing else. */
  defaultLabel: 'diameter',
  /** NAC's own drawings write the size as "ø300". */
  diameterPrefix: 'ø',
  /** Labels are never allowed to overlap. */
  avoidLabelCollisions: true,
  /** The trunk belongs to no zone, so it carries its own neutral colour. */
  trunkColour: '#B061C6',
  /** The return is a different system and is the only grey line. */
  returnColour: '#8A8FA3',

  /**
   * COLOUR MEANS SIZE.
   *
   * On the drawing a duct's colour is its DIAMETER, not its zone. An installer
   * in a roof space is asking "what do I pull for this one", and the answer is
   * a size — so the size is what the eye should get first, without reading a
   * label. Zone identity is carried by the schedule, the badges and the damper
   * that actually controls it.
   *
   * Ordered so bigger reads heavier: cool and light for a 200, through green
   * and amber, to magenta for a 400.
   */
  sizeColours: Object.freeze({
    200: '#4A90D9',
    250: '#E8A33D',
    300: '#3FA96B',
    350: '#8E6ACB',
    400: '#C0479E'
  }),
  /** Anything off the ladder, so a manual override is still drawn. */
  sizeColourFallback: '#5A6377',
  /** One palette, shared by the plan, the chips and the tables. */
  zonePalette: Object.freeze([
    Object.freeze({ key: 'amber', line: '#E8A33D', fill: 'rgba(232,163,61,0.18)' }),
    Object.freeze({ key: 'green', line: '#3FA96B', fill: 'rgba(63,169,107,0.18)' }),
    Object.freeze({ key: 'blue', line: '#3E86C9', fill: 'rgba(62,134,201,0.18)' }),
    Object.freeze({ key: 'rose', line: '#D4688A', fill: 'rgba(212,104,138,0.18)' }),
    Object.freeze({ key: 'violet', line: '#8E72CE', fill: 'rgba(142,114,206,0.18)' }),
    Object.freeze({ key: 'teal', line: '#3BA5A0', fill: 'rgba(59,165,160,0.18)' }),
    Object.freeze({ key: 'clay', line: '#C4783C', fill: 'rgba(196,120,60,0.18)' }),
    Object.freeze({ key: 'slate', line: '#6B7FA3', fill: 'rgba(107,127,163,0.18)' })
  ])
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. BILL OF MATERIALS
// ═══════════════════════════════════════════════════════════════════════════
//
// The BOM follows the REAL topology. If the drawing shows a BTO, the order has
// a BTO on it; if the drawing has no reducer, neither does the order.

export const BOM_RULES = Object.freeze({
  /** What each final branch buys. Note: no reducer. */
  perFinalBranch: Object.freeze(['bto', 'final_flex', 'outlet', 'damper_if_zoned']),
  /** What the supply side buys. */
  perSupply: Object.freeze(['supply_plenum', 'main_supply_ducts']),
  /** What the return side buys. */
  perReturn: Object.freeze(['return_duct', 'return_grille', 'filter']),
  /** A reducer is bought only where a main or major duct genuinely steps down. */
  reducersOnlyOnMains: true
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. PRESSURE
// ═══════════════════════════════════════════════════════════════════════════
//
// The pressure calculation uses the ACTUAL ROUTED GEOMETRY and the same
// topology the drawing and the BOM use. A loss that is not on the drawing is
// not in the calculation, and the other way round.

export const PRESSURE_RULES = Object.freeze({
  /** Every element the index run must account for. */
  includes: Object.freeze([
    'main duct segments', 'BTOs', 'bends', 'main reducers', 'dampers',
    'final flex', 'outlets', 'return path'
  ]),
  /** No final-branch reducer loss unless a genuine reducer exists. */
  noFinalBranchReducerLoss: true,
  /** Walk the real tree, not a flat main → branch → final assumption. */
  walkRoutedTree: true
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. THE ESTIMATOR'S WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

export const QUICK_QUOTE = Object.freeze({
  steps: Object.freeze([
    'UPLOAD PLAN',
    'AUTO EXCLUDE NON-CONDITIONED ROOMS',
    'VERIFY ONLY UNCERTAIN CONDITIONED ROOMS',
    'AUTO DESIGN',
    'DRAW COMPLETE FLEX DUCT LAYOUT',
    'BOM',
    'PRICE',
    'SEND'
  ]),
  /** A normal quote never needs the engineering tabs. */
  advancedDesignRequired: false
});

// ═══════════════════════════════════════════════════════════════════════════

/** Everything above, in one object, for anything that wants to read it whole. */
export const NAC_DUCT_DESIGN_STANDARD = Object.freeze({
  version: '1.0.0',
  rooms: Object.freeze({ CONDITIONING, EXCLUDED_ROOMS, CONDITIONED_ROOMS,
                         FIXTURE_INSIDE_A_ROOM, OUTDOOR_AREAS, EXCLUDED_ROOMS_NEVER,
                         EXCLUDED_BANNER }),
  finalFlex: FINAL_FLEX,
  autoMinDiameterMm: AUTO_MIN_DIAMETER_MM,
  stockedDiametersMm: STOCKED_DIAMETERS_MM,
  maxDiameterMm: MAX_DIAMETER_MM,
  branchMinMm: BRANCH_MIN_MM,
  finalSizeByAirflow: FINAL_SIZE_BY_AIRFLOW,
  bto: BTO,
  supplyPlenum: SUPPLY_PLENUM,
  plenumBalance,
  choosePlenumMains,
  returnDuctSizesMm: RETURN_DUCT_SIZES_MM,
  maxAirflowPerReturnLs,
  mainReductions: MAIN_REDUCTIONS,
  minMainDiameterMm: MIN_MAIN_DIAMETER_MM,
  mainFloorForFinals,
  returnAir: RETURN_AIR,
  outlets: OUTLET_RULES,
  zoning: ZONING,
  routing: ROUTING,
  drawing: DRAWING,
  bom: BOM_RULES,
  pressure: PRESSURE_RULES,
  quickQuote: QUICK_QUOTE
});

export default NAC_DUCT_DESIGN_STANDARD;
