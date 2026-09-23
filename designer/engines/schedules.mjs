// THE TWO SCHEDULES A SHEET-METAL SHOP AND AN INSTALLER ACTUALLY WORK FROM.
//
// Both are built from the SAME component objects the plan draws, the site
// editor edits, the BOM orders and the quote prices. Nick: "Use the same BTO
// and damper component objects for plan, site editor, schedules, BOM, pricing,
// internal report and customer quote. These outputs must not be able to
// disagree." There is nothing derived a second time in here — every column is a
// field off the component, or arithmetic on fields off the component.

import { btoSpec } from './bto.mjs';
import { resolveBtoPrice, btoRateBook } from './bto-pricing.mjs';

/**
 * THE BTO FABRICATION SCHEDULE.
 *
 * What the shop has to make: one row per fitting, with every collar it carries,
 * what goes through each one and where each one goes. A row is enough to cut
 * the metal from without opening the drawing.
 */
export function btoFabricationSchedule(design) {
  const book = btoRateBook(design?.btoRates || null);
  return (design?.btos || []).map(b => {
    const spec = btoSpec(b, { price: resolveBtoPrice(
      // The key is computed inside btoSpec; ask for it the same way.
      btoSpec(b).configKey, { book }) });
    return {
      id: spec.label,
      componentId: spec.id,
      inletDiameterMm: spec.inletDiameterMm,
      inletAirflowLs: spec.inletAirflowLs,
      outletCollarCount: spec.outletCollarCount,
      outletDiametersMm: spec.ports.map(p => p.diameterMm),
      outletAirflowsLs: spec.ports.map(p => p.airflowLs),
      destinations: spec.ports.map(p => p.destination),
      /** `ø250 Kitchen — 113 L/s` per collar, which is how it is read on site. */
      collarLines: spec.ports.map(p =>
        'ø' + (p.diameterMm ?? '?') + ' ' + (p.destination || 'NOT CONNECTED') +
        ' — ' + (p.airflowLs ?? '?') + ' L/s'),
      shapeText: spec.shapeText,
      bodyLengthMm: spec.bodyLengthMm,
      bodyWidthMm: spec.bodyWidthMm,
      bodyHeightMm: spec.bodyHeightMm,
      bodyDepthMm: spec.bodyDepthMm,
      bodyText: spec.bodyText,
      dimensionsSource: spec.dimensionsSource,
      dimensionsVerified: spec.dimensionsVerified,
      fabricationStatus: spec.fabricationStatus,
      // ── THE PHYSICAL COLLAR LAYOUT ───────────────────────────────────────
      // Nick: "which physical face each collar occupies; collar centre position
      // on that face; collar outside diameter; edge clearance; clearance between
      // adjacent collars; seam/fold allowance; inlet position; outlet positions;
      // required face width and height; available face width and height;
      // pass/fail result." All of it, per collar, off the same component object.
      faceLayout: spec.faceLayout,
      collarFaceLines: spec.collarFaceLines,
      layoutStatus: spec.layoutStatus,
      layoutPass: spec.layoutPass,
      layoutValidated: spec.layoutValidated,
      fabricationReady: spec.fabricationReady,
      multiFace: spec.multiFace,
      facesUsed: spec.facesUsed,
      proposedBodyText: spec.proposedBodyText,
      unplacedCollars: spec.unplacedCollars,
      /** `Side A 225 mm` per collar — where to punch it. */
      collarPositions: (spec.faceLayout?.collars || []).map(c =>
        c.faceLabel + ' — ø' + c.nominalDiameterMm + ' (OD ' + c.outsideDiameterMm +
        ') centre ' + c.centreUmm + ' × ' + c.centreVmm + ' mm, edge ' +
        c.edgeClearanceUmm + ' mm' +
        (c.clearanceToPreviousMm ? ', ' + c.clearanceToPreviousMm + ' mm to the last collar' : '')),
      fits: spec.fits,
      fitIssues: spec.fitIssues,
      configKey: spec.configKey,
      fabricator: spec.price?.supplier || null,
      quoteRef: spec.price?.quoteRef || null,
      sku: spec.price?.sku || null,
      cost: spec.price?.cost ?? null,
      effectiveDate: spec.price?.effectiveDate || null,
      priceStatus: spec.priceStatus,
      zone: b.zone || null
    };
  });
}

/**
 * THE MOTORISED ZONE-DAMPER SCHEDULE.
 *
 * Every motor on the job, the duct it goes in, the air through it and the part
 * number it is bought as. There is no manual balancing damper on it, because
 * there is no manual balancing damper on the job.
 */
export function zoneDamperSchedule(design) {
  return (design?.zoneDampers || []).map(d => ({
    id: 'ZM-' + d.motorNumber,
    componentId: d.id,
    zone: d.zone,
    ductSection: d.sectionLabel || d.sectionId,
    diameterMm: d.diameterMm,
    ductDiameterMm: d.ductDiameterMm,
    sizeLockedToDuct: d.sizeLockedToDuct,
    sizeMismatch: d.sizeMismatch,
    airflowLs: d.airflowLs,
    velocityMs: d.velocityMs,
    actuator: d.actuator,
    sku: d.supplierCode,
    skuKey: d.skuKey,
    supplier: d.supplier,
    quantity: 1,
    cost: d.unitCost,
    effectiveDate: d.effectiveDate,
    verified: d.priceVerified,
    priceStatus: d.priceStatus
  }));
}

/** Both schedules, and whether either one is holding the job up. */
export function buildSchedules(design) {
  const bto = btoFabricationSchedule(design);
  const dampers = zoneDamperSchedule(design);
  return {
    bto,
    zoneDampers: dampers,
    btoNeedingFabricationReview: bto.filter(r => !r.fabricationReady).map(r => r.id),
    /** Bodies whose collars were laid out and DO NOT physically go on. */
    btoFailingCollarLayout: bto.filter(r => r.layoutPass === false).map(r => r.id),
    btoWithMultiFaceCollars: bto.filter(r => r.multiFace).map(r => r.id),
    btoNeedingPrice: bto.filter(r => r.priceStatus !== 'VERIFIED').map(r => r.id),
    damperSizeMismatches: dampers.filter(r => r.sizeMismatch).map(r => r.id)
  };
}

export default { buildSchedules, btoFabricationSchedule, zoneDamperSchedule };
