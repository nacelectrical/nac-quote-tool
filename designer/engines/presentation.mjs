// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER QUOTE PRESENTATION — THE VIEW MODEL
//
// One job: turn the authoritative objects (design, quote revision, customer,
// job, content library) into exactly what a customer may see, and nothing else.
//
// Nick: "Use the existing quote and customer/job objects as the single source
// of truth. Do not duplicate totals, equipment, zones or inclusions into a
// separate presentation-only data model that can disagree with the quote."
//
// So every number here is READ from the design and the commercials on the way
// past. Nothing is stored, nothing is editable, and there is no second copy to
// drift. The HTML renderer and the PDF renderer both take this one object, so
// the two documents cannot disagree either — if they ever did, it would mean
// one of them invented something, and neither of them can.
//
// The other job is subtraction. Supplier costs, gross margin, job cost, every
// internal warning, the placeholder-rate blockers, the estimator's confidence
// scores — all of that exists on the design and none of it may appear on a
// customer page. That is enforced structurally: this builder constructs the
// view model by naming the fields it wants, so a new internal field added to
// the design tomorrow cannot leak into a quote issued the day after.
// ─────────────────────────────────────────────────────────────────────────────

import { quoteGate } from './quote-gate.mjs';
import { looksUnfilled, customerStatus } from './customer-data.mjs';
import { commercialTermsStatus } from './commercial-terms.mjs';
import { licencePromiseCheck } from './nac-terms.mjs';
export { looksUnfilled };
import {
  selectReviews, selectInstallations, publicReview, publicInstallation,
  resolveInclusions, resolveUpgrades, normaliseTrust, trustFacts
} from './presentation-content.mjs';

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
// Number(null) and Number('') are both 0, which meant a design with NO sell
// price read as a price of zero and sailed through the publish gate. Absent has
// to stay absent all the way to the check.
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const rows = (v) => Array.isArray(v) ? v : [];

/**
 * A room or zone name as a customer should read it.
 *
 * Plan labels are shouted — "MASTER BEDROOM", "BEDROOM 4" — because that is how
 * they are printed on a builder's drawing, and the estimator's screens show
 * them that way on purpose. A proposal is not a drawing, and a page of capitals
 * reads as a parts list. Short all-capital words are left alone, because WC and
 * WIR are not shouting, they are abbreviations.
 *
 * Zone names can also carry the grouping suffix the zoning engine attaches
 * ("Open plan — open-plan"). That suffix is internal bookkeeping and is dropped.
 */
export function friendlyLabel(value) {
  let v = trimmed(value);
  if (!v) return '';
  // Drop an engine-generated slug suffix: "Open plan — open-plan".
  const dash = v.split(/\s+[—–-]\s+/);
  if (dash.length === 2 && /^[a-z0-9-]+$/.test(dash[1])) v = dash[0];
  if (!/[A-Z]/.test(v) || !/^[^a-z]*$/.test(v)) {
    // Mixed case already, or no capitals at all — leave the author's wording.
    return v;
  }
  return v.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part;
    if (part.length <= 3 && /^[A-Z]+$/.test(part)) return part;   // WC, WIR, ENS
    if (/^\d+$/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join('');
}

/** Australian money, the way a customer reads it. */
export function money(value) {
  const x = n(value);
  if (x === null) return '';
  return '$' + x.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Money with no cents, for headline totals where cents are noise. */
export function moneyRound(value) {
  const x = n(value);
  if (x === null) return '';
  return '$' + Math.round(x).toLocaleString('en-AU');
}

export function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH GATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * May a customer presentation be produced from this design at all?
 *
 * The internal design sheet is always allowed out; a customer quote is not.
 * This reuses the EXISTING quote gate rather than inventing a second opinion,
 * and adds the two things a presentation needs beyond a priced bill: something
 * to sell, and a price to sell it at.
 *
 * Nick: "If a technical or pricing gate blocks the quote, do not publish a
 * customer presentation."
 */
/** The credentials a proposal states as fact. Each is checked, not assumed. */
const CREDENTIAL_FIELDS = Object.freeze([
  ['abn', 'ABN'],
  ['electricalLicence', 'Electrical contractor licence'],
  ['arcAuthorisation', 'ARC refrigeration authorisation'],
  ['insuranceStatement', 'Insurance']
]);

/**
 * May a customer presentation be produced from this design at all?
 *
 * The internal design sheet is always allowed out; a customer quote is not.
 * This reuses the EXISTING quote gate rather than inventing a second opinion,
 * and adds what a PRESENTATION needs beyond a priced bill: something to sell, a
 * price to sell it at, a system that meets the load it was sized for, numbers
 * that agree with one another across the page, and credentials that are real.
 *
 * Nick: "If a technical or pricing gate blocks the quote, do not publish a
 * customer presentation."
 *
 * @param {object} design
 * @param {object} opts
 * @param {object} opts.trust    the normalised trust block, when one is known
 * @param {boolean} opts.issuing true when this is a real proposal going to a
 *   customer, rather than an internal preview. Some checks only bite on issue.
 */
export function presentationGate(design, opts = {}) {
  const gate = quoteGate(design);
  const blockers = [...(gate.blockers || [])];
  const issuing = opts.issuing !== false;

  if (!design?.selectedUnit) {
    blockers.push({ code: 'NO_EQUIPMENT_SELECTED', severity: 'CRITICAL',
      message: 'No unit has been selected, so there is nothing to present.' });
  }
  if (n(design?.commercials?.sellPriceIncGst) === null) {
    blockers.push({ code: 'NO_SELL_PRICE', severity: 'CRITICAL',
      message: 'The quote has no sell price. A presentation cannot be issued without one.' });
  }

  // ── A PROPOSAL PRICE MAY NOT BE DRESSED AS A FIXED ONE ───────────────────
  // The one thing that must never happen with this feature: a customer signs a
  // number believing it cannot move. If the design is proposal-priced, the
  // document says so, and if the wording that says so is missing the proposal
  // does not go out.
  if (design?.commercials?.proposalPrice === true) {
    const terms = trimmed(opts.termsAndConditions);
    if (design.commercials.fixedPrice === true) {
      blockers.push({ code: 'PROPOSAL_PRICE_MARKED_FIXED', severity: 'CRITICAL',
        message: 'This design carries a proposal price and is also marked as a fixed price. '
          + 'It is one or the other.' });
    }
    if (terms && /\bfixed[- ]price\b/i.test(terms)) {
      blockers.push({ code: 'TERMS_CLAIM_FIXED_PRICE', severity: 'CRITICAL',
        message: 'The terms describe this as a fixed price, but the ductwork is a declared '
          + 'allowance and the figure can move. Reword the terms before issuing.' });
    }
  }

  // ── A SYSTEM THAT CANNOT MEET THE LOAD IS NOT PRESENTED AS ADEQUATE ──────
  // Internally this is a CRITICAL warning an estimator may knowingly override,
  // and NAC really has installed a 16 kW machine against a 22.5 kW calculated
  // load. What may never happen is a customer reading a proposal that calls it
  // sized for their house.
  // The one way past it is a RECORDED DECISION: who accepted the reduced
  // capacity, when, and the words the customer is to be given about what the
  // system will and will not do. A decision with a name on it is a decision;
  // a flag is not, so all three are required.
  const decision = design?.capacityDecision || null;
  const decisionRecorded = !!(decision && trimmed(decision.acknowledgedBy)
    && trimmed(decision.at) && trimmed(decision.customerWording));
  const cap = n(design?.selectedUnit?.capacityKw);
  const load = n(design?.systemLoad?.designKw);
  if (cap !== null && load !== null && load > 0 && cap < load && !decisionRecorded) {
    blockers.push({
      code: 'CAPACITY_BELOW_CALCULATED_LOAD',
      severity: 'CRITICAL',
      message: 'The ' + cap + ' kW system is below the ' + (Math.round(load * 10) / 10)
        + ' kW calculated load for this house. A proposal may not describe it as adequate. '
        + 'Either select a system that meets the load, or record the reduced-capacity '
        + 'decision and the wording the customer is to be given.',
      capacityKw: cap, designKw: Math.round(load * 100) / 100
    });
  }

  // ── THE PAGE MUST AGREE WITH ITSELF ──────────────────────────────────────
  // Room count, outlet count and the coverage table are three renderings of one
  // design. A customer who counts the rooms in the table and finds a different
  // number from the one in the summary has caught NAC out on their own quote.
  // Three renderings of one house, and each has a population it legitimately
  // covers. The coverage table lists EVERY conditioned room. The outlet
  // schedule lists the rooms with an outlet — a room on SPILL AIR is
  // conditioned and deliberately has none, which the Dungannon study is. The
  // zone schedule covers every conditioned room, spill included, because a
  // spill room is still in a zone.
  const spill = new Set(rows(design?.spillRoomIds));
  const conditionedRooms = rows(design?.rooms).filter(r => r && r.conditioned);
  const coverageRoomCount = conditionedRooms.length;
  const ductedRoomCount = conditionedRooms.filter(r => !spill.has(r.id)).length;
  const outletRowRooms = rows(design?.outlets?.rows).filter(o => !spill.has(o.roomId)).length;
  const registerRooms = design?.outletConsistency?.roomCount ?? null;
  // The register counts rooms that actually carry an outlet, which is the same
  // population as `outletRowRooms` once spill rooms are out of both.

  if (ductedRoomCount && outletRowRooms && ductedRoomCount !== outletRowRooms) {
    blockers.push({
      code: 'ROOM_COUNT_DISAGREEMENT',
      severity: 'CRITICAL',
      message: 'The coverage table would list ' + ductedRoomCount + ' ducted room(s) '
        + 'against ' + outletRowRooms + ' room(s) with outlets. The proposal cannot state two '
        + 'different sizes for the same house.'
    });
  }
  if (registerRooms !== null && outletRowRooms && registerRooms !== outletRowRooms) {
    blockers.push({
      code: 'OUTLET_COUNT_DISAGREEMENT',
      severity: 'CRITICAL',
      message: 'The outlet register covers ' + registerRooms + ' room(s) against '
        + outletRowRooms + ' in the outlet schedule.'
    });
  }

  // ── A ZONE CONTROLLER IS A REAL PART AT A REAL PRICE ─────────────────────
  // A zoned proposal names a controller. Naming one NAC has not priced is
  // selling a component nobody has costed.
  const zoneCount = rows(design?.zones?.zones).filter(z => z && z.closable !== false).length;
  if (zoneCount > 1) {
    const c = design?.controller || null;
    if (!c || !trimmed(c.name)) {
      blockers.push({
        code: 'NO_ZONE_CONTROLLER',
        severity: 'CRITICAL',
        message: 'This is a ' + zoneCount + '-zone system with no zone controller selected. '
          + 'A zoned proposal has to name the controller the customer is buying.'
      });
    } else if (c.includedInSystem === true) {
      // The manufacturer's own controller, in the box with the system. Zero is
      // its real price, not a missing one.
    } else if (n(c.cost) === null && n(c.price) === null) {
      blockers.push({
        code: 'ZONE_CONTROLLER_NOT_PRICED',
        severity: 'CRITICAL',
        message: 'The zone controller "' + trimmed(c.name) + '" carries no price. '
          + 'Enter its cost before this proposal is issued.'
      });
    }
  }

  // ── IS THERE A REAL CUSTOMER BEHIND THIS? ───────────────────────────────
  // HELLO SAMPLE went out to sample@example.invalid on 0400 000 000. Every one
  // of those fields was populated, so every presence check passed.
  if (issuing) {
    const cust = customerStatus(opts.customer || {}, { siteAddress: opts.siteAddress });
    for (const f of cust.failures) {
      blockers.push({
        code: 'CUSTOMER_DATA_NOT_REAL',
        severity: 'CRITICAL',
        field: f.field,
        message: f.reason + ' A proposal cannot be issued to a customer record that is not real.'
      });
    }
  }

  // ── NOTHING UNAPPROVED REACHES A CUSTOMER ───────────────────────────────
  // The content library already filters on approval. This is the belt on top of
  // those braces: if anything unapproved survived into the built page, the
  // proposal does not go out.
  const unapprovedReviews = rows(opts.reviews).filter(r => r && r.approved !== true);
  const unapprovedWork = rows(opts.installations).filter(i => i && i.approved !== true);
  if (unapprovedReviews.length) {
    blockers.push({ code: 'UNAPPROVED_REVIEW', severity: 'CRITICAL',
      message: unapprovedReviews.length + ' review(s) on this proposal have not been approved '
        + 'for marketing use. A review NAC has not approved is not published.' });
  }
  if (unapprovedWork.length) {
    blockers.push({ code: 'UNAPPROVED_PROJECT', severity: 'CRITICAL',
      message: unapprovedWork.length + ' past installation(s) on this proposal have not been '
        + 'approved. A customer\'s house is not marketing material until they have said so.' });
  }

  // ── THE ZONE SCHEDULE RECONCILES TOO ────────────────────────────────────
  // Room count and outlet count are checked above. The zone schedule is the
  // third rendering of the same design and has to agree with them.
  const zoneRooms = new Set();
  for (const z of rows(design?.zones?.zones)) {
    for (const r of rows(z.rooms)) zoneRooms.add(trimmed(r));
  }
  if (zoneRooms.size && coverageRoomCount && zoneRooms.size !== coverageRoomCount) {   // eslint-disable-line
    blockers.push({
      code: 'ZONE_COUNT_DISAGREEMENT',
      severity: 'CRITICAL',
      message: 'The zone schedule covers ' + zoneRooms.size + ' room(s) against '
        + coverageRoomCount + ' conditioned room(s) in the coverage table. The proposal '
        + 'cannot describe the same house two ways.'
    });
  }

  // ── NAC'S OWN COMMERCIAL TERMS ──────────────────────────────────────────
  // The demonstration proposal carried a 20% deposit and 30-day validity that
  // I invented. A customer signs these.
  if (issuing) {
    const terms = commercialTermsStatus(opts.settings);
    for (const f of terms.failures) {
      blockers.push({ code: f.code, severity: 'CRITICAL', message: f.message,
                      missing: f.missing || undefined });
    }
  }

  // ── NO FABRICATED CREDENTIALS ────────────────────────────────────────────
  if (issuing && opts.trust) {
    const t = opts.trust;
    for (const [key, label] of CREDENTIAL_FIELDS) {
      if (looksUnfilled(t[key])) {
        blockers.push({
          code: 'PLACEHOLDER_CREDENTIAL',
          severity: 'CRITICAL',
          message: label + ' reads "' + trimmed(t[key]) + '", which is a placeholder rather '
            + 'than a credential. A proposal may not state one NAC does not hold. Enter the '
            + 'real value, or leave the field empty so it is omitted.',
          field: key
        });
      }
    }
    for (const w of [t.workmanshipWarranty, t.manufacturerWarranty]) {
      if (looksUnfilled(w)) {
        blockers.push({
          code: 'PLACEHOLDER_WARRANTY_CLAIM',
          severity: 'CRITICAL',
          message: 'A warranty statement reads "' + trimmed(w) + '". A warranty the customer '
            + 'is told they have is a commitment NAC has to honour, so it comes from the '
            + 'settings or it is not shown.'
        });
      }
    }
  }

  // ── CLAUSE 17.2 ─────────────────────────────────────────────────────────
  //
  // NAC's terms tell the customer that licence numbers appear on quotations
  // and invoices. Nick has asked to leave the electrical contractor licence
  // out for now, so this does not block — but a document promising something
  // the quotation does not carry should never be a thing nobody mentioned.
  const notes = [];
  const promise = licencePromiseCheck(opts.trust || {});
  if (issuing && !promise.ok) {
    notes.push({ code: 'LICENCE_PROMISED_BY_TERMS', severity: 'CHECK',
                 message: promise.note, missing: promise.missing });
  }

  return { ok: blockers.length === 0, blockers, notes, summary: gate.summary ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE
//
// What this job demonstrably contains, read off the bill of materials and the
// design. Every value is a strict boolean, because `resolveInclusions` will
// only print a card for `true` — an absent key means "not shown to be present"
// and prints nothing, which is the behaviour Nick asked for.
// ─────────────────────────────────────────────────────────────────────────────

function bomHas(design, ...keys) {
  const items = rows(design?.bom?.items);
  return items.some(i => keys.includes(trimmed(i.key)));
}

export function inclusionEvidence(design, { trust = {}, standardInclusions = {} } = {}) {
  const d = design || {};
  const unit = d.selectedUnit || null;
  const outletCount = n(d.outlets?.totals?.total) ?? 0;
  const returnCount = n(d.returnDesign?.returnCount) ?? 0;
  const zoneCount = rows(d.zones?.zones).length;
  const t = normaliseTrust(trust);

  const ev = {
    indoor_unit: !!unit,
    outdoor_unit: !!unit && bomHas(d, 'indoor_outdoor_system'),
    outlets: outletCount > 0,
    returns: returnCount > 0,
    // Zoning is only claimed once there is a controller AND more than one zone.
    // A single-zone system is not "zoned" however many rooms it serves.
    zoning: zoneCount > 1 && !!d.controller,
    controller: !!trimmed(d.controller?.name),
    wifi: bomHas(d, 'wifi_adaptor', 'wifi_module') || standardInclusions.wifi === true,
    ductwork: bomHas(d, 'flex_duct', 'rigid_duct', 'duct') || n(d.network?.totalDuctLengthM) > 0,
    pipework: bomHas(d, 'refrigerant_pipe'),
    condensate: bomHas(d, 'drain_kit', 'drain_pipe', 'drain_elbow', 'drain_insulation'),
    electrical: bomHas(d, 'power_cable', 'isolator', 'interconnect_cable'),
    // Services are not materials, so their evidence is what the administrator
    // has configured as standard on every NAC job. Default false: an unset
    // toggle promises nothing.
    commissioning: standardInclusions.commissioning === true,
    waste_removal: standardInclusions.wasteRemoval === true,
    equipment_warranty: !!t.manufacturerWarranty,
    workmanship_warranty: !!t.workmanshipWarranty
  };

  // Detail lines that quote real quantities rather than generic wording.
  if (ev.outlets) ev.outlets_detail = outletCount + ' ceiling outlet' + (outletCount === 1 ? '' : 's')
    + ' to the conditioned areas of your home.';
  if (ev.returns) {
    const sizes = rows(d.returnDesign?.returns).map(r => trimmed(r.grilleSize)).filter(Boolean);
    ev.returns_detail = returnCount + ' filtered return air grille' + (returnCount === 1 ? '' : 's')
      + (sizes.length ? ' (' + [...new Set(sizes)].join(', ') + ')' : '') + '.';
  }
  if (ev.zoning) ev.zoning_detail = zoneCount + ' independently controlled zones, so you condition '
    + 'only the areas you are using.';
  if (ev.controller) ev.controller_detail = trimmed(d.controller.name) + ', wall mounted in a central location.';
  if (ev.equipment_warranty) ev.equipment_warranty_detail = t.manufacturerWarranty;
  if (ev.workmanship_warranty) ev.workmanship_warranty_detail = t.workmanshipWarranty;
  return ev;
}

/** What the design can support, for deciding which upgrades may be offered. */
export function upgradeCapabilities(design) {
  const d = design || {};
  const zoneCount = rows(d.zones?.zones).length;
  const controller = d.controller || {};
  return {
    has_zoning: zoneCount > 1,
    has_controller: !!trimmed(controller.name),
    // A controller can only take more zones if it has headroom.
    zone_headroom: (n(controller.maxZones) ?? 0) > zoneCount,
    has_outlets: (n(d.outlets?.totals?.total) ?? 0) > 0,
    has_returns: (n(d.returnDesign?.returnCount) ?? 0) > 0,
    ducted_system: !!d.selectedUnit,
    single_phase: /1\s*ph/i.test(str(d.selectedUnit?.phase))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

function heroSection(d, ctx) {
  const c = ctx.customer || {};
  const privacy = ctx.privacy || {};
  // ── A NAME, OR NO NAME. NEVER HALF A PLACEHOLDER ───────────────────────
  //
  // Nick: "no customer first name: use neutral wording". Never "Hi ,".
  //
  // And never "Hello Not" either, which is what a customer record reading
  // "Not recorded" produced — the greeting took the first word of a field that
  // exists to say the field is empty. Any name that reads as unfilled is no
  // name: the proposal opens with a plain "Hello" rather than inventing a
  // person out of a placeholder.
  const name = trimmed(c.name);
  const first = (name && !looksUnfilled(name) && !/^not\b/i.test(name))
    ? (name.split(/\s+/)[0] || '') : '';
  const greeting = first ? 'Hello ' + first : 'Hello';
  const site = privacy.showFullAddress
    ? trimmed(ctx.job?.siteAddress || c.address)
    : suburbOf(ctx.job?.siteAddress || c.address);
  return {
    greeting,
    // Same rule: a placeholder is not a name anywhere on the page.
    customerName: first ? name : '',
    title: 'Your Ducted Air Conditioning Proposal',
    site,
    proposalNumber: trimmed(ctx.proposalNumber),
    preparedDate: formatDate(ctx.preparedAt),
    expiryDate: formatDate(ctx.expiresAt),
    expired: !!ctx.expired,
    heroImage: ctx.heroImage || null,
    intro: trimmed(ctx.intro) || DEFAULT_INTRO
  };
}

export const DEFAULT_INTRO =
  'Thank you for the opportunity to design a ducted air-conditioning solution for your home. '
+ 'This proposal has been prepared around the layout of your property, the rooms you want '
+ 'conditioned and how you want to use the system.';

/** Last comma-separated part that is not a postcode/state, else the whole string. */
export function suburbOf(address) {
  const a = trimmed(address);
  if (!a) return '';
  const parts = a.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return a;
  const tail = parts[parts.length - 1];
  // "34 Kauri Crescent, Peregian Springs QLD 4573" → "Peregian Springs"
  return tail.replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b/gi, '')
             .replace(/\b\d{4}\b/g, '').replace(/\s+/g, ' ').trim() || tail;
}

function systemSection(d, ctx) {
  const u = d.selectedUnit;
  if (!u) return null;
  // Model strings arrive as "FDYA160AV19 / RZAS160C2V1" — indoor / outdoor.
  const parts = trimmed(u.model).split('/').map(p => p.trim()).filter(Boolean);
  const conditioned = rows(d.rooms).filter(r => r.conditioned);
  return {
    brand: trimmed(u.brandName),
    indoorModel: parts[0] || trimmed(u.model),
    outdoorModel: parts[1] || '',
    capacityKw: n(u.capacityKw),
    phase: /3\s*ph/i.test(str(u.phase)) ? 'Three phase' : 'Single phase',
    conditionedRooms: conditioned.length,
    outlets: n(d.outlets?.totals?.total) ?? 0,
    zones: rows(d.zones?.zones).length,
    controller: trimmed(d.controller?.name),
    wifi: ctx.evidence?.wifi === true,
    warranty: trimmed(ctx.trust?.manufacturerWarranty),
    totalIncGst: n(d.commercials?.sellPriceIncGst),
    // Only a catalogue asset that was actually matched to this model. Nick:
    // "Never use an incorrect generic product image merely because it looks
    // similar." A null here renders a clean branded card instead.
    image: ctx.productImage || null
  };
}

function rationaleSection(d, ctx) {
  const load = d.systemLoad || {};
  const u = d.selectedUnit;
  if (!u) return null;
  const areas = rows(d.rooms).filter(r => r.conditioned).map(r => friendlyLabel(r.label)).filter(Boolean);
  const zoneCount = rows(d.zones?.zones).length;
  const points = [];

  const designKw = n(load.designCoolingKw);
  const area = n(load.totalConditionedAreaSqM);
  if (designKw !== null && area !== null) {
    points.push('We calculated the cooling requirement for ' + area.toFixed(0) + ' m² of conditioned '
      + 'living space at ' + designKw.toFixed(1) + ' kW, based on the room sizes, ceiling height and '
      + 'the way the home is laid out.');
  }
  // ── "SENSIBLE HEADROOM" IS A CLAIM, AND IT HAS TO BE TRUE ───────────────
  //
  // This sentence was printed unconditionally, including on the demonstration
  // proposal where a 16 kW unit sat against a 22.5 kW calculated load. A
  // system 6.5 kW SHORT was described to a customer as having headroom.
  //
  // The wording now follows the arithmetic. Above the load it may claim
  // headroom; at or below it, it says what the machine actually is. The
  // publish gate refuses an under-capacity proposal outright unless the
  // reduced-capacity decision is on record — so this wording exists for the
  // case where somebody HAS made that call and the customer must be told
  // plainly what they are buying.
  const capKw = n(u.capacityKw);
  if (capKw !== null && designKw !== null) {
    if (capKw >= designKw * 1.05) {
      points.push('The ' + trimmed(u.brandName) + ' ' + capKw + ' kW system was selected to meet '
        + 'that requirement with sensible headroom — large enough for a hot Queensland afternoon, '
        + 'without being so oversized that it short-cycles and leaves the air feeling damp.');
    } else if (capKw >= designKw) {
      points.push('The ' + trimmed(u.brandName) + ' ' + capKw + ' kW system was selected to meet '
        + 'that requirement. It is matched closely to the calculated load rather than oversized, '
        + 'which keeps it running steadily instead of short-cycling.');
    } else {
      points.push('The ' + trimmed(u.brandName) + ' ' + capKw + ' kW system is sized to the home\'s '
        + 'everyday cooling and heating needs rather than to the peak calculated load of '
        + designKw.toFixed(1) + ' kW. On the hottest afternoons of the year it will run '
        + 'continuously and may not hold the set temperature in every room at once.');
    }
  } else if (capKw !== null) {
    points.push('The ' + trimmed(u.brandName) + ' ' + capKw + ' kW system was selected for this home.');
  }
  if (areas.length) {
    points.push('Conditioned areas: ' + listSentence(areas) + '.');
  }
  if (zoneCount > 1) {
    points.push('The system is divided into ' + zoneCount + ' zones, so you can switch off the parts of '
      + 'the house you are not using and put that capacity where you actually are. That is where most of '
      + 'the running-cost saving in a ducted system comes from.');
  }
  // A real operating requirement, in the customer's language, when the design
  // has one. This is the honest version of a constraint, not a hidden one.
  const constant = rows(d.zones?.zones).find(z => z.closable === false);
  if (constant) {
    points.push('The ' + friendlyLabel(constant.name) + ' zone runs whenever the system is on. Ducted systems '
      + 'need a minimum amount of air moving through them at all times, and keeping this area open is how '
      + 'that is achieved.');
  }
  return points.length ? { points } : null;
}

function listSentence(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

function zonesSection(d) {
  const zs = rows(d.zones?.zones);
  if (!zs.length) return null;
  const c = d.controller || {};
  const built = {
    // THE ACTUAL COMPATIBLE CONTROLLER, not "Brand Standard Controller" with
    // nothing behind it. A zoned proposal names the part, its supplier code
    // and what it costs — a component the customer is buying is a component
    // somebody has priced.
    controller: trimmed(c.name),
    controllerSku: trimmed(c.supplierCode || c.sku) || null,
    controllerMaxZones: n(c.maxZones),
    controllerIncludedInSystem: c.includedInSystem === true,
    // NO PRICE. `controllerPriceIncGst` carried `c.cost` — MMEM's ex-GST
    // SUPPLIER cost, on a payload that is stored against the issued quote and
    // served to the customer's browser. Nothing rendered it, so it leaked
    // silently; it only showed up when the fitted controller stopped being the
    // $0 one supplied with the system. What a customer may be told about the
    // controller is the part, its code, how many zones it handles, and whether
    // it is included — never what NAC paid for it.
    rows: zs.map((z, i) => {
      const name = friendlyLabel(z.name) || ('Zone ' + (i + 1));
      const roomNames = rows(z.rooms).map(friendlyLabel).filter(Boolean);
      // "Bedroom 2 / Rooms: Bedroom 2" is noise. When the zone is one room of
      // the same name, the rooms line says nothing and is dropped.
      const sameAsName = roomNames.length === 1
        && roomNames[0].toLowerCase() === name.toLowerCase();
      return {
      name,
      rooms: sameAsName ? '' : (listSentence(roomNames) || ''),
      switchable: z.closable !== false,
      note: z.closable === false
        ? 'Runs whenever the system is on, to keep airflow through the unit'
        : ''
      };
    })
  };
  // When every zone is a single room of its own name, a "Rooms" column repeats
  // the zone name down the page and tells the customer nothing. The column is
  // dropped rather than filled with blanks or dashes.
  built.showRooms = built.rows.some(r => r.rooms !== '');
  return built;
}

function coverageSection(d) {
  const conditioned = rows(d.rooms).filter(r => r.conditioned);
  if (!conditioned.length) return null;
  const outletRows = rows(d.outlets?.rows);
  const byLabel = new Map();
  for (const o of outletRows) byLabel.set(trimmed(o.label || o.roomLabel), o);

  const friendlyType = (t) => ({
    round_diffuser: 'Round diffuser',
    square_diffuser: 'Square diffuser',
    linear_bar: 'Linear bar grille',
    slot_diffuser: 'Slot diffuser'
  })[trimmed(t)] || '';

  return {
    rooms: conditioned.map(r => {
      const o = byLabel.get(trimmed(r.label));
      return {
        name: friendlyLabel(r.label),
        outlets: n(o?.quantity) ?? 0,
        type: friendlyType(o?.type)
      };
    }),
    excluded: rows(d.rooms).filter(r => !r.conditioned).map(r => friendlyLabel(r.label)).filter(Boolean),
    // Nick: "If no final duct design exists, state ... Do not display a fake
    // final duct layout."
    provisional: !(n(d.network?.totalDuctLengthM) > 0),
    provisionalNote: 'Final outlet, return-air and indoor-unit positions are confirmed during '
      + 'detailed design and roof-space assessment.'
  };
}

function investmentSection(d, ctx) {
  const c = d.commercials || {};
  const total = n(c.sellPriceIncGst);
  if (total === null) return null;
  const selected = rows(ctx.selectedOptions);
  const optionsTotal = selected.reduce((s, o) => s + (n(o.priceIncGst) ?? 0), 0);
  const grand = total + optionsTotal;
  const terms = ctx.paymentTerms || {};
  const depositPct = n(terms.depositPercent);
  // ── A PROPOSAL PRICE IS LABELLED AS ONE, ON THE PAGE ────────────────────
  // Not in a footnote and not in the terms. A customer reading a number and a
  // signature box is entitled to know whether the number can move.
  const isProposal = c.proposalPrice === true;
  return {
    proposalPrice: isProposal,
    priceLabel: isProposal ? 'Proposal price' : 'Your investment',
    proposalNote: isProposal
      ? 'This is a proposal price, not a fixed price. The ductwork is carried at NAC\'s '
        + 'standard installation allowance because the duct design for your home has not '
        + 'been done yet. Once it is, the ductwork is measured and this figure is confirmed '
        + 'or adjusted — we will show you exactly what changed and why before any work '
        + 'starts.'
      : null,
    subtotalExGst: n(c.sellPriceExGst),
    gst: n(c.gstAmount),
    baseIncGst: total,
    selectedOptions: selected.map(o => ({ id: o.id, title: trimmed(o.title), priceIncGst: n(o.priceIncGst) })),
    optionsTotal: optionsTotal || null,
    totalIncGst: grand,
    deposit: depositPct !== null ? {
      percent: depositPct,
      amount: Math.round(grand * depositPct) / 100
    } : (n(terms.depositAmount) !== null ? { percent: null, amount: n(terms.depositAmount) } : null),
    stages: rows(terms.stages).map(s => ({ label: trimmed(s.label), detail: trimmed(s.detail) }))
      .filter(s => s.label),
    validity: trimmed(terms.validity),
    expiryDate: formatDate(ctx.expiresAt)
  };
}

/**
 * What NAC commits to after handover.
 *
 * A WARRANTY AND A SERVICING PROMISE ARE COMMITMENTS, NOT COPY. Everything a
 * customer is told here, NAC has to honour — so the two that carry a legal
 * weight come from the TRUST SETTINGS, which are Nick's own and are blank until
 * he fills them in. A placeholder that survived into either field is caught by
 * the gate before this runs; anything that still reads as unfilled is dropped
 * here rather than printed.
 */
function warrantySection(ctx) {
  const t = normaliseTrust(ctx.trust);
  const care = ctx.aftercare || {};
  const items = [];
  const real = (v) => { const s = trimmed(v); return (s && !looksUnfilled(s)) ? s : ''; };

  if (real(t.manufacturerWarranty)) {
    items.push({ title: 'Equipment warranty', detail: real(t.manufacturerWarranty),
                 source: 'settings' });
  }
  if (real(t.workmanshipWarranty)) {
    items.push({ title: 'NAC workmanship warranty', detail: real(t.workmanshipWarranty),
                 source: 'settings' });
  }
  if (real(care.commissioning)) items.push({ title: 'Commissioning', detail: real(care.commissioning) });
  if (real(care.filterCare)) items.push({ title: 'Filter care', detail: real(care.filterCare) });
  if (real(care.servicing)) items.push({ title: 'Servicing', detail: real(care.servicing) });
  if (real(care.support)) items.push({ title: 'Support', detail: real(care.support) });
  return items.length ? { items } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the customer presentation view model.
 *
 * Returns `{ ok:false, blockers }` when the quote may not be shown at all, so
 * a caller cannot accidentally render a blocked quote by ignoring a flag on an
 * otherwise complete object.
 */
export function buildPresentation({
  design, customer = {}, job = {}, content = {}, settings = {},
  proposalNumber = '', preparedAt = null, expiresAt = null,
  revision = null, status = 'draft', selectedOptionIds = [],
  privacy = {}, intro = '', heroImage = null, productImage = null
} = {}) {
  const d = design || {};
  const trust = normaliseTrust(content.trust || settings.trust);

  // ── DEMONSTRATION DATA IS NEVER A PROPOSAL ───────────────────────────────
  //
  // Nick: "quote-proposal.pdf is DEMONSTRATION DATA ONLY and must never be
  // publishable." The demo content library exists so the presentation can be
  // designed, reviewed and tested against something that looks like a real
  // quote. That is exactly what makes it dangerous: it looks like a real quote.
  //
  // So it is marked at the source, the mark travels into the presentation, and
  // every surface that renders one renders the watermark. A demonstration may
  // be previewed; it may not be issued, accepted or sent.
  const demonstration = content.demonstration === true || settings.demonstration === true;
  const issuing = status === 'issued' || status === 'accepted' || status === 'sent';
  if (demonstration && issuing) {
    return {
      ok: false,
      presentation: null,
      blockers: [{
        code: 'DEMONSTRATION_CONTENT',
        severity: 'CRITICAL',
        message: 'This presentation is built on DEMONSTRATION content. It can be previewed '
          + 'and reviewed, but it may not be issued, accepted or sent to anybody. Point it at '
          + 'the real content library first.'
      }]
    };
  }

  const evidence = inclusionEvidence(d, {
    trust, standardInclusions: content.standardInclusions || {}
  });
  const caps = upgradeCapabilities(d);
  const { offerable, withheld } = resolveUpgrades(content.upgrades || [], caps);
  // Exclusive groups are settled HERE, not in the page. The browser enforces
  // them for the customer's benefit; this enforces them for the price's.
  const wanted = rows(selectedOptionIds);
  const seenGroups = new Set();
  const selectedOptions = [];
  for (const o of offerable) {
    if (!wanted.includes(o.id)) continue;
    if (o.group) {
      if (seenGroups.has(o.group)) continue;   // first in the group wins
      seenGroups.add(o.group);
    }
    selectedOptions.push(o);
  }

  const imagesById = {};
  for (const img of rows(content.images)) if (img && img.id) imagesById[img.id] = img;

  const selectionCtx = {
    brand: trimmed(d.selectedUnit?.brandName),
    systemType: 'ducted',
    suburb: suburbOf(job.siteAddress || customer.address),
    tags: content.selectionTags || []
  };
  // The SELECTED records are kept alongside the public ones. publicReview and
  // publicInstallation deliberately strip everything internal — including the
  // approval flag — because that is the shape a customer is allowed to see. So
  // the gate has to be shown the sources, or it is checking objects that never
  // carried the field it is asking about.
  const selectedReviewSources = selectReviews(content.reviews || [], {
    ...selectionCtx,
    selectedIds: content.selectedReviewIds, excludedIds: content.excludedReviewIds
  });
  const reviews = selectedReviewSources.map(publicReview);

  const selectedInstallSources = selectInstallations(content.installations || [], imagesById, {
    ...selectionCtx,
    selectedIds: content.selectedInstallationIds, excludedIds: content.excludedInstallationIds
  });
  const installations = selectedInstallSources.map(i => publicInstallation(i, imagesById));

  // THE GATE RUNS HERE, once the reviews and installations that would actually
  // be published are known. Asking before they are resolved would be asking
  // about a different page from the one about to be built.
  const gate = presentationGate(d, {
    trust, issuing,
    termsAndConditions: content.termsAndConditions,
    customer, siteAddress: job.siteAddress || customer.address,
    reviews: selectedReviewSources, installations: selectedInstallSources,
    settings
  });
  if (!gate.ok) return { ok: false, blockers: gate.blockers, presentation: null };

  const expired = !!expiresAt && Date.parse(expiresAt) < Date.now();

  const ctx = {
    customer, job, trust, evidence, privacy, intro, heroImage, productImage,
    proposalNumber, preparedAt, expiresAt, expired,
    selectedOptions, paymentTerms: content.paymentTerms || {}, aftercare: content.aftercare || {}
  };

  const presentation = {
    schema: 'nac.presentation.v1',
    revision: revision ?? d.quoteRevision ?? 1,
    status,
    expired,
    /** Renders as a watermark on every surface. Never quietly true. */
    demonstration,
    demonstrationNote: demonstration
      ? 'DEMONSTRATION — NOT FOR CUSTOMER ISSUE. This is not a quote and no price on it '
        + 'is offered.' : null,
    brand: {
      name: trust.businessName || 'NAC Electrical Air & Refrigeration',
      abn: trust.abn, phone: trust.phone, email: trust.email, website: trust.website,
      logo: content.logo || null
    },
    hero: heroSection(d, ctx),
    system: systemSection(d, ctx),
    rationale: rationaleSection(d, ctx),
    inclusions: resolveInclusions(evidence),
    zones: zonesSection(d),
    coverage: coverageSection(d),
    installations,
    reviews,
    trust: { points: trust.points, facts: trustFacts(trust) },
    investment: investmentSection(d, ctx),
    options: offerable.map(o => ({
      id: o.id, title: o.title, description: o.description,
      priceIncGst: o.priceIncGst, group: o.group,
      selected: selectedOptions.some(s => s.id === o.id)
    })),
    warranty: warrantySection(ctx),
    acceptance: {
      canAccept: status !== 'accepted' && status !== 'declined' && status !== 'revoked' && !expired,
      accepted: status === 'accepted',
      declined: status === 'declined',
      revoked: status === 'revoked',
      terms: trimmed(content.termsAndConditions),
      depositInstructions: trimmed(content.paymentTerms?.depositInstructions)
    },
    // Estimator-side only. Never rendered by the customer templates; carried so
    // the admin preview can explain why an option is not on offer.
    _internal: { withheldUpgrades: withheld }
  };

  // ── ONE IMMUTABLE REVISION, BOTH RENDERINGS ──────────────────────────────
  // Nick: "HTML and PDF must use the same immutable quote revision." They are
  // rendered from this one object, so they cannot differ by construction — and
  // freezing it means nothing can quietly edit the revision, the price or the
  // acceptance state between the two renders either.
  return { ok: true, blockers: [], presentation: deepFreeze(presentation) };
}

/** Freeze an object and everything under it. Object.freeze is shallow. */
function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj)) deepFreeze(v);
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAK CHECK
//
// A structural builder is only as safe as the fields it names, and the cost of
// being wrong is a customer reading NAC's margin. This walks the finished view
// model and fails on anything that looks like internal commercial data, so the
// test suite can assert it directly rather than eyeballing a rendered page.
// ─────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = Object.freeze([
  'supplierCost', 'supplierCode', 'supplierSource', 'totalJobCost', 'equipmentCost',
  'materialsCost', 'labourCost', 'grossProfit', 'grossMarginPct', 'jobFee',
  'cataloguePrice', 'subcontractorCost', 'otherCost', 'placeholderCount',
  'unpricedCount', 'warnings', 'warningSummary', 'confidence', 'confidenceFactors',
  'bom', 'labour', 'commercials', 'systemLoad', 'pressure', 'network', 'topologyCheck'
]);

/**
 * @returns {{ok:boolean, leaks:Array<{path:string, key:string}>}}
 */
export function auditPresentation(presentation) {
  const leaks = [];
  const seen = new WeakSet();
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, path + '[' + i + ']')); return; }
    for (const [k, v] of Object.entries(node)) {
      // The estimator-side bag is excluded from customer rendering by contract
      // and is checked separately by the renderers, not here.
      if (path === '' && k === '_internal') continue;
      if (FORBIDDEN_KEYS.includes(k)) leaks.push({ path: path + '.' + k, key: k });
      walk(v, path + '.' + k);
    }
  };
  walk(presentation, '');
  return { ok: leaks.length === 0, leaks };
}
