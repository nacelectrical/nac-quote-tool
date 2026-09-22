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
export function presentationGate(design) {
  const gate = quoteGate(design);
  const blockers = [...(gate.blockers || [])];

  if (!design?.selectedUnit) {
    blockers.push({ code: 'NO_EQUIPMENT_SELECTED', severity: 'CRITICAL',
      message: 'No unit has been selected, so there is nothing to present.' });
  }
  if (n(design?.commercials?.sellPriceIncGst) === null) {
    blockers.push({ code: 'NO_SELL_PRICE', severity: 'CRITICAL',
      message: 'The quote has no sell price. A presentation cannot be issued without one.' });
  }
  return { ok: blockers.length === 0, blockers, summary: gate.summary ?? null };
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
  const first = trimmed(c.name).split(/\s+/)[0] || '';
  // Nick: "no customer first name: use neutral wording". Never "Hi ,".
  const greeting = first ? 'Hello ' + first : 'Hello';
  const site = privacy.showFullAddress
    ? trimmed(ctx.job?.siteAddress || c.address)
    : suburbOf(ctx.job?.siteAddress || c.address);
  return {
    greeting,
    customerName: trimmed(c.name),
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
  if (n(u.capacityKw) !== null) {
    points.push('The ' + trimmed(u.brandName) + ' ' + n(u.capacityKw) + ' kW system was selected to meet '
      + 'that requirement with sensible headroom — large enough for a hot Queensland afternoon, without '
      + 'being so oversized that it short-cycles and leaves the air feeling damp.');
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
  const built = {
    controller: trimmed(d.controller?.name),
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
  return {
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

function warrantySection(ctx) {
  const t = normaliseTrust(ctx.trust);
  const care = ctx.aftercare || {};
  const items = [];
  if (t.manufacturerWarranty) items.push({ title: 'Equipment warranty', detail: t.manufacturerWarranty });
  if (t.workmanshipWarranty) items.push({ title: 'NAC workmanship warranty', detail: t.workmanshipWarranty });
  if (trimmed(care.commissioning)) items.push({ title: 'Commissioning', detail: trimmed(care.commissioning) });
  if (trimmed(care.filterCare)) items.push({ title: 'Filter care', detail: trimmed(care.filterCare) });
  if (trimmed(care.servicing)) items.push({ title: 'Servicing', detail: trimmed(care.servicing) });
  if (trimmed(care.support)) items.push({ title: 'Support', detail: trimmed(care.support) });
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
  const gate = presentationGate(d);
  if (!gate.ok) return { ok: false, blockers: gate.blockers, presentation: null };

  const trust = normaliseTrust(content.trust || settings.trust);
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
  const reviews = selectReviews(content.reviews || [], {
    ...selectionCtx,
    selectedIds: content.selectedReviewIds, excludedIds: content.excludedReviewIds
  }).map(publicReview);

  const installations = selectInstallations(content.installations || [], imagesById, {
    ...selectionCtx,
    selectedIds: content.selectedInstallationIds, excludedIds: content.excludedInstallationIds
  }).map(i => publicInstallation(i, imagesById));

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

  return { ok: true, blockers: [], presentation };
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
