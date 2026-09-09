// NAC AI HVAC DESIGNER — PART 31: data models and revisions.
//
// A design is never overwritten in place. Every save appends a DesignRevision
// holding a full snapshot, so an earlier design can always be recovered and a
// quote can always be traced to the exact design that produced it.

import { DEFAULT_SETTINGS } from './settings.mjs';

export const MODEL_NAMES = [
  'DuctDesign', 'DesignPlan', 'PlanCalibration', 'DetectedDimension', 'DimensionChain',
  'PlanWall', 'DesignRoom', 'RoomMeasurement', 'RoomLoad', 'DesignEquipment',
  'DesignOutlet', 'DesignDuct', 'DesignFitting', 'DesignReturn', 'DesignZone',
  'DesignMaterial', 'DesignWarning', 'DesignAssumption', 'DesignRevision'
];

export function newDesignId(customerName = '', now = Date.now()) {
  const slug = String(customerName || 'DESIGN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10) || 'DESIGN';
  return 'NACD-' + slug + '-' + now;
}

/** A blank DuctDesign — the aggregate root everything else hangs off. */
export function createDesign({ customer = {}, job = {}, quoteId = null, settings = DEFAULT_SETTINGS, createdBy = null } = {}) {
  const now = new Date().toISOString();
  return {
    // ── Identity & relationships (PART 23) ───────────────────────────────────
    id: newDesignId(customer.name),
    designId: null,                 // set to id on first save
    quoteId,                        // nac_quotes.id once pushed to a quote
    jobId: job.id || null,          // ServiceM8 job number
    customerId: customer.id || null,
    customer: { name: customer.name || '', address: customer.address || '',
                phone: customer.phone || '', email: customer.email || '' },
    job: { description: job.description || 'Ducted AC Supply & Install',
           houseType: job.houseType || '', climate: job.climate || settings.load.defaultClimate },

    status: 'draft',                // draft | in_review | approved | quoted | superseded
    createdAt: now,
    updatedAt: now,
    createdBy,
    approvedBy: null,
    approvedAt: null,

    // ── DesignPlan ───────────────────────────────────────────────────────────
    plan: null,                     // { fileName, mediaType, dataUrl|storageUrl, widthPx, heightPx, pageCount, page }
    calibration: null,              // PlanCalibration
    scaleLabel: null,               // parsed from the drawing, advisory only

    // ── Plan interpretation ──────────────────────────────────────────────────
    detectedDimensions: [],         // DetectedDimension[]
    chains: [],                     // DimensionChain[]
    walls: [],                      // PlanWall[]
    openings: [],                   // windows / doors / sliders
    interpretation: null,           // raw AI reader output, kept for audit

    // ── Rooms & loads ────────────────────────────────────────────────────────
    rooms: [],                      // DesignRoom[] (each carries a RoomMeasurement)
    roomLoads: [],                  // RoomLoad[]
    systemLoad: null,
    loadWarnings: [],

    // ── System design ────────────────────────────────────────────────────────
    equipmentSelection: null,
    selectedUnit: null,             // DesignEquipment
    controller: null,
    airflow: null,
    outlets: null,                  // DesignOutlet[] inside .rows
    network: null,                  // DesignDuct[] inside .sections, DesignFitting inside each
    ductRoutes: {},                 // roomId -> drawn route (pixels + measured length)
    mainRoute: null,
    layout: { indoorUnit: null, returnGrille: null, outlets: {}, plenum: null },  // PART 18 overlay positions
    returnDesign: null,             // DesignReturn
    zones: null,                    // DesignZone[] inside .zones
    pressure: null,

    // ── Commercial ───────────────────────────────────────────────────────────
    bom: null,                      // DesignMaterial[] inside .items
    labour: null,
    commercials: null,

    // ── Governance ───────────────────────────────────────────────────────────
    assumptions: [],                // DesignAssumption[]
    warnings: [],                   // DesignWarning[]
    warningAcknowledgements: [],
    notes: '',
    settingsSnapshot: null,         // the settings actually used, frozen at approval
    revisions: []                   // DesignRevision[]
  };
}

/**
 * Append a revision. The snapshot excludes `revisions` itself and the plan
 * image bytes (which are stored once), so the history stays small.
 */
export function addRevision(design, { by = null, reason = '', label = '' } = {}) {
  const { revisions, plan, ...rest } = design;
  const snapshot = { ...rest, plan: plan ? { ...plan, dataUrl: undefined } : null };
  const revision = {
    number: (revisions?.length || 0) + 1,
    at: new Date().toISOString(),
    by, reason, label,
    snapshot
  };
  return { ...design, updatedAt: revision.at, revisions: [...(revisions || []), revision] };
}

/** Restore an earlier revision as a NEW revision — history is never destroyed. */
export function restoreRevision(design, number, by = null) {
  const rev = (design.revisions || []).find(r => r.number === number);
  if (!rev) return design;
  const restored = { ...rev.snapshot, plan: design.plan, revisions: design.revisions };
  return addRevision(restored, { by, reason: 'Restored revision ' + number, label: 'Restore r' + number });
}

export function diffDesigns(a, b) {
  const changes = [];
  const cmp = (path, x, y) => {
    if (x === y) return;
    if (typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) < 1e-9) return;
    changes.push({ field: path, from: x, to: y });
  };
  cmp('Total conditioned area (m²)', a.systemLoad?.totalConditionedAreaSqM, b.systemLoad?.totalConditionedAreaSqM);
  cmp('Design load (kW)', a.systemLoad?.designKw, b.systemLoad?.designKw);
  cmp('Selected system', a.selectedUnit ? a.selectedUnit.brandName + ' ' + a.selectedUnit.model : null,
                          b.selectedUnit ? b.selectedUnit.brandName + ' ' + b.selectedUnit.model : null);
  cmp('Total airflow (L/s)', a.airflow?.allocatedAirflowLs, b.airflow?.allocatedAirflowLs);
  cmp('Outlet count', a.outlets?.totals?.total, b.outlets?.totals?.total);
  cmp('Zone count', a.zones?.zoneCount, b.zones?.zoneCount);
  cmp('Total duct length (m)', a.network?.totalDuctLengthM, b.network?.totalDuctLengthM);
  cmp('Total job cost', a.commercials?.totalJobCost, b.commercials?.totalJobCost);
  cmp('Sell price (inc GST)', a.commercials?.sellPriceIncGst, b.commercials?.sellPriceIncGst);
  cmp('Gross profit', a.commercials?.grossProfit, b.commercials?.grossProfit);
  cmp('Gross margin %', a.commercials?.grossMarginPct, b.commercials?.grossMarginPct);
  return changes;
}
