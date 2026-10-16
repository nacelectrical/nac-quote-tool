// ─────────────────────────────────────────────────────────────────────────────
// A QUOTE WITHOUT A DUCT DESIGN
//
// Nick, 16 October 2026: "Pause all duct-designer development and focus on
// completing NAC's quote tool... Quoting must work independently using
// information I enter and approve: equipment, installation scope, outlets,
// zones, inclusions, exclusions and price. Do not fabricate a completed duct
// design or require one to issue an installer-approved quote."
//
// NAC quoted jobs for years before this application existed. The estimator
// walks the house, knows what goes in, and prices it. The duct design is how
// the INSTALL is planned; it is not how the QUOTE is arrived at, and making
// one a precondition of the other meant a job could not be quoted until a
// drawing existed for it.
//
// So a quote draft is its own source of truth. Everything in it is typed and
// approved by a person, and NOTHING here is derived, inferred or calculated
// from a drawing. There is no load calculation behind these numbers and the
// draft never pretends there is.
//
// ── WHAT IS STILL CHECKED ───────────────────────────────────────────────────
//
// "Retain checks for missing quote information, invalid prices and
// incompatible options." A quote-only path is not an unchecked path: it drops
// the checks that are ABOUT A DRAWING — fittings, plenums, duct sizes, static
// pressure, the supply graph — and keeps every check about whether the OFFER
// is sound. A price of zero is still refused. An upgrade that does not fit the
// chosen system is still withheld.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
const list = (v) => Array.isArray(v) ? v : [];
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const bool = (v) => v === true || v === 'true' || v === 1;
const money = (v) => { const x = n(v); return x === null ? null : Math.round(x * 100) / 100; };

export const QUOTE_DRAFT_SCHEMA = 'nac.quote.draft.v1';

/** What a quote can be missing, and whether it stops the quote going out. */
export const DRAFT_BLOCK = Object.freeze({
  NO_EQUIPMENT: 'DRAFT_NO_EQUIPMENT',
  NO_PRICE: 'DRAFT_NO_PRICE',
  BAD_PRICE: 'DRAFT_BAD_PRICE',
  NO_CUSTOMER: 'DRAFT_NO_CUSTOMER',
  NO_SCOPE: 'DRAFT_NO_SCOPE',
  OPTION_UNPRICED: 'DRAFT_OPTION_UNPRICED',
  OPTION_INCOMPATIBLE: 'DRAFT_OPTION_INCOMPATIBLE',
  SENSOR_COUNT_NOT_SET: 'DRAFT_SENSOR_COUNT_NOT_SET',
  ZONE_COUNT_MISMATCH: 'DRAFT_ZONE_COUNT_MISMATCH',
  OUTLET_COUNT_MISMATCH: 'DRAFT_OUTLET_COUNT_MISMATCH',
  CONTROLLER_TOO_SMALL: 'DRAFT_CONTROLLER_TOO_SMALL',
  NO_CONTROLLER: 'DRAFT_NO_CONTROLLER'
});

export function createQuoteDraft(seed = {}) {
  return normaliseQuoteDraft({
    schema: QUOTE_DRAFT_SCHEMA,
    createdAt: new Date().toISOString(),
    ...seed
  });
}

/**
 * One system NAC is offering. A quote may offer more than one — a Daikin and
 * a Braemar, say — and the customer picks.
 */
export function normaliseDraftSystem(input = {}, index = 0) {
  const u = input || {};
  return {
    id: trimmed(u.id) || ('sys-' + (index + 1)),
    brand: trimmed(u.brand),
    brandId: trimmed(u.brandId) || trimmed(u.brand).toLowerCase().replace(/[^a-z0-9]+/g, ''),
    model: trimmed(u.model),
    outdoorModel: trimmed(u.outdoorModel),
    capacityKw: n(u.capacityKw),
    phase: trimmed(u.phase) || '1Ph',
    /** GST-inclusive, as NAC quotes. */
    priceIncGst: money(u.priceIncGst),
    warrantyYears: n(u.warrantyYears),
    recommended: bool(u.recommended),
    note: trimmed(u.note)
  };
}

export function normaliseQuoteDraft(input = {}) {
  const d = input || {};
  const systems = list(d.systems).map(normaliseDraftSystem);
  return {
    schema: QUOTE_DRAFT_SCHEMA,
    /** Marks everything downstream: this quote has no duct design behind it. */
    quoteOnly: true,
    id: trimmed(d.id) || null,
    createdAt: trimmed(d.createdAt) || null,
    updatedAt: trimmed(d.updatedAt) || null,
    createdBy: trimmed(d.createdBy) || null,

    customer: {
      name: trimmed(d.customer?.name),
      email: trimmed(d.customer?.email),
      phone: trimmed(d.customer?.phone),
      address: trimmed(d.customer?.address)
    },
    siteAddress: trimmed(d.siteAddress) || trimmed(d.customer?.address),
    proposalNumber: trimmed(d.proposalNumber),

    systems,
    chosenSystemId: trimmed(d.chosenSystemId)
      || (systems.find(s => s.recommended) || systems[0] || {}).id || null,

    /**
     * THE ZONE CONTROL.
     *
     * `id` is the catalogue entry when one was chosen — a Siemens kit, an
     * AirTouch, a manufacturer's own box — and the name and zone capacity come
     * with it. A controller typed by hand carries a name and no id, which is
     * the manual way through and is still quotable.
     *
     * NO COST LIVES HERE. The kit's supplier cost is NAC's business and the
     * draft is the thing that becomes a customer's page; what a customer may
     * be told is the part, how many zones it handles, and whether it is in the
     * price. `draftToQuoteSource()` carries exactly that and nothing else.
     */
    controller: {
      id: trimmed(d.controller?.id),
      /** True while this kit is the house rule's default rather than a choice. */
      auto: bool(d.controller?.auto),
      name: trimmed(d.controller?.name),
      zoneCount: n(d.controller?.zoneCount),
      note: trimmed(d.controller?.note)
    },

    // ── THE SCOPE, AS THE ESTIMATOR SAW IT ─────────────────────────────────
    // Counts typed by a person who walked the house. They are NOT a design
    // and are never presented as one.
    scope: {
      outletCount: n(d.scope?.outletCount),
      returnCount: n(d.scope?.returnCount),
      zoneCount: n(d.scope?.zoneCount),
      conditionedRooms: list(d.scope?.conditionedRooms).map(r => ({
        label: trimmed(r && r.label),
        zone: trimmed(r && r.zone),
        outlets: n(r && r.outlets)
      })).filter(r => r.label),
      summary: trimmed(d.scope?.summary)
    },

    inclusions: list(d.inclusions).map(trimmed).filter(Boolean),
    exclusions: list(d.exclusions).map(trimmed).filter(Boolean),

    /** Optional upgrades offered ON THIS QUOTE, chosen from the library. */
    selectedUpgradeIds: list(d.selectedUpgradeIds).map(trimmed).filter(Boolean),
    /** How many sensors are offered, where the controller takes them. */
    sensorCount: n(d.sensorCount),
    /**
     * HOW MANY OF A COUNTED UPGRADE.
     *
     * An upgrade priced per unit — room sensors at $110 each — is worth
     * nothing to the customer page without a number, because an absent count
     * falls back to the library's default and a default of 0 drops the
     * upgrade off the offer entirely. So the count lives here, against the
     * upgrade's own id, and it is a number a person entered.
     *
     * `sensorCount` above is the same figure for the one upgrade the zoning
     * path also needs it for; the builder writes both when the estimator sets
     * the sensor count, and this map is what prices the offer.
     */
    upgradeQuantities: Object.fromEntries(
      Object.entries(d.upgradeQuantities || {})
        .map(([k, v]) => [trimmed(k), n(v)])
        .filter(([k, v]) => k && v !== null && v >= 0)),

    /** An approved plan image, when one has been supplied. Never invented. */
    planImage: d.planImage && trimmed(d.planImage.src)
      ? { src: trimmed(d.planImage.src), alt: trimmed(d.planImage.alt),
          approved: bool(d.planImage.approved) }
      : null,

    intro: trimmed(d.intro),
    validDays: n(d.validDays) ?? 30,
    status: trimmed(d.status) || 'draft',

    /**
     * A TEST QUOTE: issued on the real content library at a real price so the
     * link and the acceptance can be proved end to end, and banner-labelled
     * TEST QUOTE on every surface. Never implied — the draft has to say so,
     * and it is false unless somebody ticked the box.
     */
    testQuote: bool(d.testQuote)
  };
}

/** The system the customer is being quoted, or null. */
export function chosenSystem(draft) {
  const d = normaliseQuoteDraft(draft);
  return d.systems.find(s => s.id === d.chosenSystemId) || d.systems[0] || null;
}

/**
 * Is this quote ready to go out?
 *
 * Blockers stop it. Warnings are worth saying and do not.
 */
export function quoteDraftGate(draft, { upgrades = [] } = {}) {
  const d = normaliseQuoteDraft(draft);
  const blockers = [], warnings = [];
  const block = (code, message) => blockers.push({ code, severity: 'CRITICAL', message });
  const warn = (code, message) => warnings.push({ code, severity: 'CHECK', message });

  if (!d.systems.length) {
    block(DRAFT_BLOCK.NO_EQUIPMENT,
      'No system has been entered, so there is nothing to quote.');
  }
  for (const s of d.systems) {
    const label = trimmed(s.brand) + ' ' + trimmed(s.model) || s.id;
    if (!trimmed(s.brand) || !trimmed(s.model)) {
      block(DRAFT_BLOCK.NO_EQUIPMENT,
        'A system on this quote has no brand or model: ' + (label || s.id) + '.');
    }
    if (s.priceIncGst === null) {
      block(DRAFT_BLOCK.NO_PRICE, label + ' has no price.');
    } else if (!(s.priceIncGst > 0)) {
      // A zero or negative price is not a discount, it is a mistake.
      block(DRAFT_BLOCK.BAD_PRICE, label + ' is priced at $' + s.priceIncGst.toFixed(2)
        + '. A quote cannot go out at nothing.');
    }
  }

  if (!trimmed(d.customer.name)) {
    block(DRAFT_BLOCK.NO_CUSTOMER, 'The customer has no name on this quote.');
  }
  if (!trimmed(d.siteAddress)) {
    block(DRAFT_BLOCK.NO_CUSTOMER, 'No site address is on this quote.');
  }

  // Scope: a proposal with no inclusions tells the customer nothing about what
  // they are buying, and is the thing arguments start over.
  if (!d.inclusions.length) {
    block(DRAFT_BLOCK.NO_SCOPE,
      'No inclusions are listed. A customer accepting this would not know what is in it.');
  }
  if (d.scope.outletCount === null) {
    warn('DRAFT_NO_OUTLET_COUNT', 'No outlet count is recorded, so the proposal cannot say '
      + 'how many outlets are being installed.');
  }
  if (!d.exclusions.length) {
    warn('DRAFT_NO_EXCLUSIONS', 'No exclusions are listed. What is NOT included is usually '
      + 'where a job goes wrong.');
  }

  // ── THE QUOTE MUST AGREE WITH ITSELF ───────────────────────────────────
  // Two figures the estimator typed can contradict one another: a zone count
  // in the scope, and the zone names against the rooms. The customer page
  // prints ONE of them ("6 independently controlled zones"), so if they differ
  // the page states a number the rest of the quote does not support. This is
  // not a design check — there is no drawing involved — it is the quote
  // disagreeing with itself, and it is the estimator's to resolve.
  const zoneNames = [...new Set(d.scope.conditionedRooms.map(r => trimmed(r.zone))
    .filter(Boolean))];
  if (zoneNames.length && d.scope.zoneCount !== null
      && zoneNames.length !== d.scope.zoneCount) {
    block(DRAFT_BLOCK.ZONE_COUNT_MISMATCH,
      'The scope records ' + d.scope.zoneCount + ' zone(s), but the rooms are grouped into '
      + zoneNames.length + ' (' + zoneNames.join(', ') + '). The proposal would print one '
      + 'of those two numbers.');
  }

  // Outlets, the same way: the per-room counts have to add up to the total the
  // proposal prints. A room list that sums to something else means one of the
  // two is wrong, and the customer is told how many outlets they are buying.
  const roomOutlets = d.scope.conditionedRooms
    .reduce((sum, r) => sum + (n(r.outlets) ?? 0), 0);
  const anyRoomOutlets = d.scope.conditionedRooms.some(r => n(r.outlets) !== null);
  if (anyRoomOutlets && d.scope.outletCount !== null && roomOutlets !== d.scope.outletCount) {
    block(DRAFT_BLOCK.OUTLET_COUNT_MISMATCH,
      'The scope records ' + d.scope.outletCount + ' outlet(s), but the rooms add up to '
      + roomOutlets + '.');
  }

  // ── A CONTROLLER THAT CANNOT COVER THE JOB ─────────────────────────────
  //
  // Nick: "Siemens is used if not AirTouch." The kits come in 4, 6 and 8 zone
  // and they are sized to the job — a 4-zone kit on a 6-zone house is short by
  // two zones, and the quote would go out naming a part that cannot do what
  // the rest of the page promises.
  if (trimmed(d.controller.name) && d.controller.zoneCount !== null
      && d.scope.zoneCount !== null && d.controller.zoneCount < d.scope.zoneCount) {
    block(DRAFT_BLOCK.CONTROLLER_TOO_SMALL,
      trimmed(d.controller.name) + ' handles ' + d.controller.zoneCount
      + ' zone(s) and this quote is for ' + d.scope.zoneCount
      + '. Choose a kit that covers the job.');
  }

  // A zoned job with no controller named is a zoned job nobody has specified.
  if ((d.scope.zoneCount ?? 0) > 1 && !trimmed(d.controller.name)) {
    block(DRAFT_BLOCK.NO_CONTROLLER,
      'This is a ' + d.scope.zoneCount + '-zone system and no zone control has been '
      + 'chosen. A zoned proposal has to name the controller being installed.');
  }

  // ── INCOMPATIBLE OPTIONS ───────────────────────────────────────────────
  // An upgrade that does not fit the chosen system must never be offered, and
  // an upgrade with no price must never be offerable at all.
  const sys = chosenSystem(d);
  const byId = new Map(list(upgrades).map(u => [trimmed(u.id), u]));
  for (const id of d.selectedUpgradeIds) {
    const u = byId.get(id);
    if (!u) {
      warn('DRAFT_UPGRADE_UNKNOWN', 'An upgrade on this quote (' + id
        + ') is not in the content library and will not be offered.');
      continue;
    }
    const flat = n(u.priceIncGst), unit = n(u.unitPriceIncGst);
    if (flat === null && unit === null) {
      block(DRAFT_BLOCK.OPTION_UNPRICED,
        'The upgrade "' + (trimmed(u.title) || id) + '" has no price.');
    }
    const requires = list(u.requires).map(trimmed).filter(Boolean);
    const brandLock = requires.filter(r => /_system$/.test(r));
    if (sys && brandLock.length) {
      const ours = trimmed(sys.brandId) + '_system';
      if (!brandLock.includes(ours)) {
        block(DRAFT_BLOCK.OPTION_INCOMPATIBLE,
          'The upgrade "' + (trimmed(u.title) || id) + '" only fits '
          + brandLock.map(b => b.replace(/_system$/, '')).join(' or ')
          + ', and this quote is on a ' + (trimmed(sys.brand) || 'different brand') + '.');
      }
    }
    if (requires.includes('has_zoning') && !((d.scope.zoneCount ?? 0) > 1)) {
      block(DRAFT_BLOCK.OPTION_INCOMPATIBLE,
        'The upgrade "' + (trimmed(u.title) || id) + '" needs a zoned system, and this '
        + 'quote records ' + (d.scope.zoneCount ?? 0) + ' zone(s).');
    }
    // A per-unit upgrade with no count is an order form, not a quote.
    if (unit !== null && d.sensorCount === null && /sensor/i.test(trimmed(u.title))) {
      block(DRAFT_BLOCK.SENSOR_COUNT_NOT_SET,
        'The sensors are priced per unit and no number has been set for this quote.');
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

/**
 * Present the draft in the shape buildPresentation() already reads.
 *
 * This is a TRANSLATION, not a fabrication. Every value comes from something a
 * person typed; nothing is derived from a drawing, and the pieces a duct
 * design would carry — the network, the bill of materials, the pressure
 * estimate, the load calculation — are absent rather than filled with
 * plausible numbers. `quoteOnly` tells every gate downstream why.
 */
/**
 * The upgrade selections, in the shape buildPresentation() prices them from.
 *
 * A bare id means "offer this one"; an id with a count means "offer this many".
 * A counted upgrade sent as a bare id takes the library's default, and where
 * that default is 0 the upgrade silently disappears from the offer — which is
 * how four room sensors the estimator had entered came to be priced at nothing
 * and shown as not selected.
 */
export function draftSelectedOptions(draft, { upgrades = [] } = {}) {
  const d = normaliseQuoteDraft(draft);
  const byId = new Map(list(upgrades).map(u => [trimmed(u.id), u]));
  return d.selectedUpgradeIds.map(id => {
    const u = byId.get(id);
    const counted = u && n(u.unitPriceIncGst) !== null;
    if (!counted) return id;
    const qty = d.upgradeQuantities[id] ?? d.sensorCount;
    return qty === null || qty === undefined ? id : { id, quantity: qty };
  });
}

export function draftToQuoteSource(draft, { upgrades = [] } = {}) {
  const d = normaliseQuoteDraft(draft);
  const sys = chosenSystem(d);
  const zoneCount = d.scope.zoneCount ?? 0;

  // ── ZONES, AS THE ESTIMATOR GROUPED THEM ─────────────────────────────────
  // Where the rooms carry a zone name, the zone schedule is built from them and
  // each zone names its rooms. Where only a count was entered, the zones are
  // numbered and name no rooms rather than being given invented ones.
  //
  // NOTHING here says which zone runs constantly. On a designed job the zoning
  // engine works that out from the airflow; on a quote nobody has, and marking
  // one "always open" would be the application deciding a commissioning detail
  // on the customer's page. The presentation prints no constant-zone note
  // unless a design put one there.
  const zoneNames = [...new Set(d.scope.conditionedRooms.map(r => r.zone).filter(Boolean))];
  const zones = zoneNames.length
    ? zoneNames.map(name => ({
        name,
        rooms: d.scope.conditionedRooms.filter(r => r.zone === name)
                 .map(r => r.label).filter(Boolean)
      }))
    : Array.from({ length: Math.max(0, zoneCount) }, (_, i) => ({
        name: 'Zone ' + (i + 1), rooms: [] }));

  return {
    quoteOnly: true,
    id: d.id, designId: d.id,
    customer: { ...d.customer },
    job: { siteAddress: d.siteAddress },

    selectedUnit: sys ? {
      brandName: sys.brand, brandId: sys.brandId,
      model: sys.model, outdoorModel: sys.outdoorModel,
      capacityKw: sys.capacityKw, phase: sys.phase
    } : null,

    controller: trimmed(d.controller.name)
      ? { name: d.controller.name, maxZones: d.controller.zoneCount } : null,

    commercials: sys && sys.priceIncGst !== null ? {
      sellPriceIncGst: sys.priceIncGst,
      // Derived from the GST-inclusive figure the estimator entered, which is
      // the number NAC quotes on. The rate is the configured one.
      gstRate: 0.1
    } : {},

    outlets: { totals: { total: d.scope.outletCount ?? 0 } },
    returnDesign: { returnCount: d.scope.returnCount ?? 0, returns: [] },
    zones: { zones, zoneCount: zones.length },
    rooms: d.scope.conditionedRooms.map((r, i) => ({
      id: 'r' + (i + 1), label: r.label, conditioned: true,
      zoneName: r.zone, outlets: r.outlets
    })),

    /** The scope, carried verbatim for the presentation to print. */
    quoteScope: {
      inclusions: [...d.inclusions],
      exclusions: [...d.exclusions],
      summary: d.scope.summary,
      planImage: d.planImage && d.planImage.approved ? { ...d.planImage } : null
    },

    selectedUpgradeIds: [...d.selectedUpgradeIds],
    sensorCount: d.sensorCount,
    upgradeQuantities: { ...d.upgradeQuantities },
    testQuote: d.testQuote,

    systemOptions: d.systems.map(s => ({
      id: s.id, brand: s.brand, brandId: s.brandId, model: s.model,
      capacityKw: s.capacityKw, phase: s.phase, priceIncGst: s.priceIncGst,
      warrantyYears: s.warrantyYears, recommended: s.recommended, note: s.note
    })),
    chosenSystemId: d.chosenSystemId,
    intro: d.intro
  };
}

export default {
  QUOTE_DRAFT_SCHEMA, DRAFT_BLOCK, createQuoteDraft, normaliseQuoteDraft,
  normaliseDraftSystem, chosenSystem, quoteDraftGate, draftToQuoteSource,
  draftSelectedOptions
};
