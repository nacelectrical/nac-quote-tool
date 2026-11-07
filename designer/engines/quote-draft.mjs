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

import { firmnessOf } from './option-pricing.mjs';
import { ZONE_CONTROLLERS } from './catalogue.mjs';

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
    /**
     * WHAT NAC PAY, ex GST unless told otherwise. Internal, and never carried
     * into a customer document — draftToQuoteSource() does not pass it on.
     *
     * Left null the figure is taken off NAC's MMEM trade list by model, and if
     * it is not on that list either then the margin on this option is UNKNOWN.
     * It is not estimated. designer/engines/option-pricing.mjs does that work.
     */
    supplierCost: n(u.supplierCost),
    supplierCostIncGst: bool(u.supplierCostIncGst),
    /** A picture of this unit, when NAC hold one. Never invented. */
    image: u.image && trimmed(u.image.src)
      ? { src: trimmed(u.image.src), alt: trimmed(u.image.alt) }
      : null,
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
      /**
       * IS THE ZONE CONTROL IN THE PRICE?
       *
       * On a quote-only job the system price is all-in, so a named controller
       * is included unless somebody says otherwise — which is what a customer
       * most wants to know about it and what the page had no way to say.
       *
       * It also made duplicateCharges()' first rule dead: that rule asks
       * whether a controller is marked included AND carries its own charge,
       * and the draft carried neither field, so it could never fire on a real
       * quote. It can now.
       */
      includedInPrice: d.controller?.includedInPrice === false
        ? false
        : !!trimmed(d.controller?.name),
      /** A separate charge, on the rare job where the kit is not in the price. */
      priceIncGst: money(d.controller?.priceIncGst),
      /**
       * THE PICTURE OF THIS PART.
       *
       * Nick, 5 November 2026, sending a Zonemaster six-zone wall panel, then
       * "Just put it in the pic for siemens."
       *
       * There is no automatic MATCH worth having here. Every zone controller
       * is named with the words "zone" and "control", so a matcher scoring on
       * them would put any panel in the library beside any kit — a Zonemaster
       * photograph on a Siemens line, under its price, on the page a customer
       * signs. The link between the Siemens kits and the Zonemaster plate is
       * not something a matcher could ever have worked out: the kit is badged
       * Siemens and the plate is badged Zonemaster. It is a FACT NAC STATED,
       * and it is recorded against the part, in the catalogue.
       *
       * So three states, and the estimator controls all of them:
       *
       *   ''            the part's own picture, out of the catalogue
       *   NO_PICTURE    this quote shows none, deliberately
       *   '<id>'        this picture, on this quote
       */
      imageId: trimmed(d.controller?.imageId),
      note: trimmed(d.controller?.note)
    },

    // ── THE SCOPE, AS THE ESTIMATOR SAW IT ─────────────────────────────────
    // Counts typed by a person who walked the house. They are NOT a design
    // and are never presented as one.
    scope: (() => {
      const conditionedRooms = list(d.scope?.conditionedRooms).map(r => ({
        label: trimmed(r && r.label),
        zone: trimmed(r && r.zone),
        outlets: n(r && r.outlets)
      })).filter(r => r.label);

      /**
       * ── THE ZONES, AS A LIST ─────────────────────────────────────────
       *
       * Nick, 5 November 2026: "Want to be able to choose the zones."
       *
       * Before this there was no such thing as a zone. There was a NUMBER in
       * the scope, and a free-text box on every room where the estimator
       * typed a zone name again and again — so "Living" and "living" were two
       * zones, a typo was a seventh zone on a six-zone house, and the quote
       * then blocked itself on a mismatch the estimator had to go and hunt
       * for. Nothing could be renamed, reordered, or created empty.
       *
       * A zone is now a thing the estimator makes, names and orders, and a
       * room POINTS at one. The rooms still carry the name, so everything
       * downstream — the quote source, the presentation, an old saved
       * quote — reads exactly as it did.
       *
       * SEEDED FROM THE ROOMS where a draft has none, which is every quote
       * raised before today and every one the ops API creates. Nothing is
       * invented: the zones are the distinct names already typed, in the
       * order they first appear.
       */
      const dedupe = (names) => {
        const seen = new Set(); const out = [];
        for (const name of names) {
          const k = name.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k); out.push(name);
        }
        return out;
      };
      const named = dedupe(list(d.scope?.zones)
        .map(z => trimmed(typeof z === 'string' ? z : z && z.name))
        .filter(Boolean));
      /**
       * HAS ANYBODY ACTUALLY SET THE ZONES UP?
       *
       * This is a STORED FLAG, not "is the list non-empty", and the
       * difference matters: normalising seeds a list from the rooms, so one
       * round trip through the store would otherwise turn every legacy quote
       * into one whose zones had been "chosen" — and the typed zone count
       * would be silently replaced by the rooms' word for it, on a quote
       * somebody may already have sent.
       *
       * The builder sets it when the estimator uses the zone editor. Seeding
       * never does.
       */
      const chosen = bool(d.scope?.zonesChosen) && named.length > 0;
      // A draft that has never seen the zone editor — every quote raised
      // before today, and every one the ops API creates. The zones are the
      // distinct names already typed on the rooms, in the order they appear.
      // NOTHING IS INVENTED, and the typed count is NOT quietly replaced: see
      // zoneCount below, and the gate.
      const zones = chosen
        ? named : dedupe(conditionedRooms.map(r => r.zone).filter(Boolean));

      return {
        outletCount: n(d.scope?.outletCount),
        returnCount: n(d.scope?.returnCount),
        /**
         * The number the customer page prints.
         *
         * Where the estimator has BUILT a zone list, the count follows it and
         * the two can no longer disagree — which is the whole point of having
         * a list. Where they have not, the typed number stands exactly as it
         * did, including when it contradicts the rooms: that contradiction is
         * the estimator's to resolve and the gate still says so. Taking the
         * rooms' word for it here would silently change a number on a
         * customer's page.
         */
        zoneCount: chosen ? zones.length : n(d.scope?.zoneCount),
        zones,
        /** True once somebody has actually set the zones up. */
        zonesChosen: chosen,
        conditionedRooms,
        summary: trimmed(d.scope?.summary)
      };
    })(),

    inclusions: list(d.inclusions).map(trimmed).filter(Boolean),
    exclusions: list(d.exclusions).map(trimmed).filter(Boolean),

    /**
     * HOW THIS PRICE WAS ARRIVED AT, where the tool worked it out.
     *
     * Internal. It never reaches draftToQuoteSource() and so never reaches a
     * customer — what NAC's cost and margin were is NAC's business. It is kept
     * so a figure can be explained in a month's time without rebuilding it
     * from memory, and it is NOT what the quote goes out at: the price is
     * whatever is in the price box, typed or filled.
     */
    pricedBy: d.pricedBy && typeof d.pricedBy === 'object' ? {
      method: trimmed(d.pricedBy.method) || null,
      costExGst: money(d.pricedBy.costExGst),
      feeExGst: money(d.pricedBy.feeExGst),
      at: trimmed(d.pricedBy.at) || null
    } : null,

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

    // ── THE FLOOR PLAN, AND WHAT WAS READ OFF IT ───────────────────────────
    //
    // Nick, 4 November 2026: "Create enquiry → upload floor plan → review
    // rooms and preliminary sizing."
    //
    // The plan FILE and the plan IMAGE are two different things and this
    // draft carries both. `plan` is the working document the estimator reads
    // rooms off — a PDF or a photograph, whatever they were sent — and it
    // stays internal. `planImage` further down is the one a customer may see
    // on the proposal, and only when it is approved.
    plan: d.plan && (trimmed(d.plan.src) || trimmed(d.plan.name)) ? {
      name: trimmed(d.plan.name),
      mediaType: trimmed(d.plan.mediaType),
      src: trimmed(d.plan.src),
      page: n(d.plan.page) ?? 1,
      pageCount: n(d.plan.pageCount),
      widthPx: n(d.plan.widthPx),
      heightPx: n(d.plan.heightPx),
      /** When the reader last ran over it, and what it reported. */
      readAt: trimmed(d.plan.readAt),
      notes: list(d.plan.notes).map(trimmed).filter(Boolean),
      /** The printed under-roof area, when the sheet states one. */
      printedFloorAreaSqM: n(d.plan.printedFloorAreaSqM),
      /**
       * How the scale came to be known. Only a source in
       * VERIFIED_SCALE_SOURCES may stand behind a fixed price — never one
       * guessed off a car, a bed or a kitchen bench.
       */
      calibration: d.plan.calibration || null
    } : null,

    /**
     * THE ROOMS, as read and then as corrected.
     *
     * Each is a room record from rooms.mjs: a label, a measurement with the
     * source it came from, and whether it is conditioned. The estimator
     * corrects any of it, and `buildRoom()` keeps the original beside the
     * correction rather than overwriting it.
     */
    rooms: list(d.rooms),

    /**
     * The sizing decision. The CALCULATION is not stored — it is derived from
     * the rooms every time by preliminarySizing(), so it can never go stale
     * against a room that was corrected afterwards. What is stored is the
     * method chosen and any override, because those are decisions.
     */
    sizing: {
      method: trimmed(d.sizing?.method) || 'per_room',
      ceilingHeightMm: n(d.sizing?.ceilingHeightMm),
      override: d.sizing?.override && n(d.sizing.override.designKw) ? {
        designKw: n(d.sizing.override.designKw),
        reason: trimmed(d.sizing.override.reason),
        by: trimmed(d.sizing.override.by),
        at: trimmed(d.sizing.override.at)
      } : null
    },

    /** An approved plan image, when one has been supplied. Never invented. */
    planImage: d.planImage && trimmed(d.planImage.src)
      ? { src: trimmed(d.planImage.src), alt: trimmed(d.planImage.alt),
          approved: bool(d.planImage.approved) }
      : null,

    /**
     * A NEW INSTALLATION OR A REPLACEMENT.
     *
     * Not the same job: a replacement has to deal with the old system, and
     * quoting one as the other is how the old unit ends up still on the roof
     * with nobody paid to take it away. option-pricing.mjs says what a
     * replacement's scope is missing; it never prices those lines, because
     * what a licensed de-gas costs on a given roof is NAC's to say.
     */
    jobType: d.jobType === 'replacement' ? 'replacement' : 'new_install',

    /**
     * The customer and job records this quote belongs to.
     *
     * Section 11: "Stable customer, job, quote and revision identifiers that
     * work across systems." The same two ids the operations surface uses, so a
     * quote Nick types into the builder and a quote an assistant opens through
     * /api/ops end up on the same customer and the same job. Null while NAC's
     * CRM tables are not in the project, which is a supported state — the
     * application has always worked without them.
     */
    customerRef: trimmed(d.customerRef) || null,
    jobRef: trimmed(d.jobRef) || null,

    /**
     * A PROVISIONAL ESTIMATE RATHER THAN A FIXED PRICE.
     *
     * Different promises, and a customer reading the second as the first is
     * how a job is argued about at invoice time. The estimator can say so
     * themselves and it wins outright — they know something about the job that
     * nothing here does. firmnessOf() also decides it on its own when
     * something is still open.
     */
    provisional: bool(d.provisional),
    provisionalReason: trimmed(d.provisionalReason),

    intro: trimmed(d.intro),
    /**
     * What the site is like, in the estimator's own words — storey count, roof
     * type, access, anything the plan does not say. Internal: it feeds the
     * estimator's judgement, not the customer's page.
     */
    siteNotes: trimmed(d.siteNotes),
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
  d.systems.forEach((s, i) => {
    // ── NAMING A SYSTEM THAT HAS NO NAME ────────────────────────────────
    //
    // This was:
    //
    //     const label = trimmed(s.brand) + ' ' + trimmed(s.model) || s.id;
    //
    // `+` binds tighter than `||`, so the whole concatenation is evaluated
    // first — and for a system with neither brand nor model that is ' ', a
    // single space, which is TRUTHY. The fallback to s.id could never run.
    // On the first row of a new quote, which has no id either, the checks
    // panel then read:
    //
    //     A system on this quote has no brand or model: .
    //     has no price.
    //
    // A list of problems that cannot say which thing has the problem is a
    // list somebody stops reading.
    const named = [trimmed(s.brand), trimmed(s.model)].filter(Boolean).join(' ');
    // "System 1", not "sys-1": the id is this application's bookkeeping and
    // means nothing to the person reading the panel.
    const label = named || ('System ' + (i + 1));
    if (!trimmed(s.brand) || !trimmed(s.model)) {
      block(DRAFT_BLOCK.NO_EQUIPMENT, named
        // Half-named: say which half is missing, and which system it is.
        ? named + ' is missing its ' + (trimmed(s.brand) ? 'model' : 'brand') + '.'
        : label + ' has no brand or model yet.');
    }
    if (s.priceIncGst === null) {
      block(DRAFT_BLOCK.NO_PRICE, label + ' has no price.');
    } else if (!(s.priceIncGst > 0)) {
      // A zero or negative price is not a discount, it is a mistake.
      block(DRAFT_BLOCK.BAD_PRICE, label + ' is priced at $' + s.priceIncGst.toFixed(2)
        + '. A quote cannot go out at nothing.');
    }
  });

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
  if (d.scope.zonesChosen) {
    // The count follows the list, so those two can no longer disagree. What
    // still can is a room pointing at a zone that is not ON the list — which a
    // draft reaching the gate from the ops API or an old save can carry.
    const onList = new Set(d.scope.zones.map(z => z.toLowerCase()));
    const stray = [...new Set(d.scope.conditionedRooms.map(r => trimmed(r.zone))
      .filter(Boolean).filter(z => !onList.has(z.toLowerCase())))];
    if (stray.length) {
      block(DRAFT_BLOCK.ZONE_COUNT_MISMATCH,
        'These rooms are in zones that are not on the zone list: ' + stray.join(', ')
        + '. Add them on the scope step, or put the rooms in a zone that is listed.');
    }

    // ── LOOSE ENDS, SAID OUT LOUD ───────────────────────────────────────
    //
    // Neither of these is a reason to stop a quote — a zone really can be
    // quoted before its rooms are settled, and a room really can be outside
    // the zoning. But both print on the customer's page, so the estimator is
    // told rather than finding out from the customer.
    if (d.scope.conditionedRooms.length) {
      const empty = d.scope.zones.filter(z => !d.scope.conditionedRooms
        .some(r => trimmed(r.zone).toLowerCase() === z.toLowerCase()));
      if (empty.length && empty.length < d.scope.zones.length) {
        warn('DRAFT_ZONE_WITHOUT_ROOMS',
          'No rooms are in ' + empty.join(', ') + '. The proposal lists '
          + (empty.length === 1 ? 'that zone' : 'those zones')
          + ' with nothing in ' + (empty.length === 1 ? 'it' : 'them') + '.');
      }
      const loose = d.scope.conditionedRooms.filter(r => !trimmed(r.zone))
        .map(r => r.label);
      if (loose.length) {
        warn('DRAFT_ROOM_WITHOUT_ZONE',
          loose.join(', ') + (loose.length === 1 ? ' is' : ' are')
          + ' not in any zone, so ' + (loose.length === 1 ? 'it' : 'they')
          + ' will not appear on the zone schedule.');
      }
    }
  } else {
    // No list yet. The original rule, unchanged: the typed count against the
    // zones the rooms name between them.
    const zoneNames = d.scope.zones;
    if (zoneNames.length && d.scope.zoneCount !== null
        && zoneNames.length !== d.scope.zoneCount) {
      block(DRAFT_BLOCK.ZONE_COUNT_MISMATCH,
        'The scope records ' + d.scope.zoneCount + ' zone(s), but the rooms are grouped into '
        + zoneNames.length + ' (' + zoneNames.join(', ') + '). The proposal would print one '
        + 'of those two numbers.');
    }
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

/**
 * "This quote shows no picture of the zone control."
 *
 * A blank means "whatever the part's own picture is", which is what an
 * estimator who never touched the field wants. So saying NO picture needs a
 * value of its own, or there would be no way back from a catalogue default.
 */
export const NO_PICTURE = 'none';

/**
 * Which photograph goes beside the zone control: the one chosen on this quote,
 * or the one recorded against the part NAC buys.
 *
 * The catalogue lookup is a LOOKUP, not a match — `siemens_z6` is the id of
 * the kit the estimator selected, and the picture is the one NAC recorded
 * against that id. A controller typed by hand has no catalogue id and so gets
 * nothing unless somebody picks a picture for it.
 */
export function controllerImageId(controller = {}) {
  const chosen = trimmed(controller.imageId);
  if (chosen === NO_PICTURE) return null;
  if (chosen) return chosen;
  const part = ZONE_CONTROLLERS.find(c => c.id === trimmed(controller.id));
  return (part && part.imageId) || null;
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
  // IN THE ESTIMATOR'S ORDER, from the zone list, and a zone with no rooms in
  // it yet is still a zone: it is on the quote because somebody put it there,
  // and dropping it would quietly change the count the page prints.
  const zones = d.scope.zones.length
    ? d.scope.zones.map(name => ({
        name,
        rooms: d.scope.conditionedRooms
                 .filter(r => trimmed(r.zone).toLowerCase() === name.toLowerCase())
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

    // What a customer may be told about the zone control: the part, how many
    // zones it handles, and whether it is in the price. Never what NAC paid.
    controller: trimmed(d.controller.name)
      ? { name: d.controller.name, maxZones: d.controller.zoneCount,
          includedInSystem: d.controller.includedInPrice === true,
          priceIncGst: d.controller.includedInPrice === true
            ? null : d.controller.priceIncGst,
          // The photograph for this part. The presentation resolves it
          // against the approved library; an id naming nothing publishable
          // shows no picture rather than the nearest lookalike.
          imageId: controllerImageId(d.controller) }
      : null,

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

    // ── WHAT A CUSTOMER MAY SEE OF AN OPTION ────────────────────────────
    // The exact indoor and outdoor pair, the capacity, the phase, the picture
    // and the price. NOT `supplierCost`: what NAC pay is not on this list and
    // must never be, because this object is what the proposal is built from.
    systemOptions: d.systems.map(s => ({
      id: s.id, brand: s.brand, brandId: s.brandId, model: s.model,
      outdoorModel: s.outdoorModel,
      image: s.image ? { ...s.image } : null,
      capacityKw: s.capacityKw, phase: s.phase, priceIncGst: s.priceIncGst,
      warrantyYears: s.warrantyYears, recommended: s.recommended, note: s.note
    })),
    chosenSystemId: d.chosenSystemId,

    /** A new installation or a replacement, for the scope the page prints. */
    jobType: d.jobType,

    /**
     * FIXED PRICE OR PROVISIONAL ESTIMATE, for the customer's page.
     *
     * The LABEL and the NOTE only. The reasons behind a provisional estimate
     * are the estimator's working — "nothing in the scope mentions removing
     * the old units" is a note to NAC, not a sentence to put in front of a
     * customer. What the customer is told is which of the two this is, and,
     * where the estimator wrote one, what still has to be confirmed in their
     * own words.
     */
    priceFirmness: (() => {
      const f = firmnessOf(d);
      return {
        fixed: f.fixed,
        label: f.customerLabel,
        note: f.customerNote,
        confirmWhat: d.provisional ? trimmed(d.provisionalReason) : ''
      };
    })(),

    intro: d.intro
  };
}

export default {
  QUOTE_DRAFT_SCHEMA, DRAFT_BLOCK, createQuoteDraft, normaliseQuoteDraft,
  normaliseDraftSystem, chosenSystem, quoteDraftGate, draftToQuoteSource,
  draftSelectedOptions
};
