// THREE NEW DESIGNS THAT CHOOSE THREE DIFFERENT SUPPLY SPIGOT ARRANGEMENTS.
//
// Nick: "Add separate fixture tests demonstrating valid new designs using:
// 2 × Ø350; 2 × Ø400; 3 × Ø400."
//
// These are NEW designs: none of them carries `supplyMainConfig`, so the
// arrangement is chosen by the engine rather than read off a saved job. They
// differ in the things the decision is actually made on — the indoor unit and
// its discharge flange, the system airflow, the installer areas, how far the
// longest main has to reach and what the roof will take — and NOT in outlet
// count, which is deliberately similar across two of them.

import { parseRoomDimensionPair } from '../../designer/engines/dimensions.mjs';
import { buildRoom, architecturalMeasurement, deriveBoundariesFromPrintedSizes }
  from '../../designer/engines/rooms.mjs';
import { createDesign } from '../../designer/engines/model.mjs';
import { runPipeline } from '../../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../../designer/engines/catalogue.mjs';
import { DEFAULT_SETTINGS } from '../../designer/engines/settings.mjs';
import { PLACEMENT, OUTLET_SOURCE } from '../../designer/engines/placement.mjs';

const PPM = 340 / 6000;                       // the same plan scale as the approved job
export const CAL = { pixelsPerMm: PPM, mmPerPixel: 1 / PPM,
                     imageWidthPx: 1200, imageHeightPx: 1300, display: {} };

/**
 * Build and run one house.
 *
 * `sheet` rows are [label, x, y, 'W x Lm']; a row with no printed size is an
 * excluded wet area or garage and gets no outlet, exactly as on a real plan.
 */
async function buildHouse({ sheet, unitKey, fanCoil, returns, installerAreaCount,
                            roofClearanceMm = null, longestMainRouteM = null,
                            widthPx = 1200, heightPx = 1300 }) {
  const rooms = sheet.map(([label, x, y, printed]) => {
    const dd = printed ? parseRoomDimensionPair(printed) : null;
    return buildRoom({
      label,
      measurement: architecturalMeasurement(dd?.widthMm ?? null, dd?.lengthMm ?? null,
                                            printed ? ['printed'] : []),
      labelPx: { x: x - label.length * 4, y: y - 9, w: label.length * 8, h: 18 }
    });
  });

  const d = createDesign();
  d.rooms = deriveBoundariesFromPrintedSizes(rooms, CAL,
    { imageWidthPx: widthPx, imageHeightPx: heightPx });
  d.plan = { name: 'spigot fixture', widthPx, heightPx };
  d.calibration = CAL;
  d.selectedUnitKey = unitKey;

  // Every conditioned room gets one outlet at its label, which is a plain,
  // repeatable placement — the point of these fixtures is the spigot decision.
  d.outletOverrides = {}; d.layout = {}; d.outletPositionSources = {};
  for (const [label, x, y, printed] of sheet) {
    if (!printed) continue;
    const rid = d.rooms.find(r => r.label === label)?.id;
    if (!rid) continue;
    d.outletOverrides[rid] = { quantity: 1 };
    d.outletPositionSources[rid] = OUTLET_SOURCE.MANUAL;
    d.layout['outlet_' + rid + '_0'] = { x, y };
  }

  d.layout.indoorUnit = { ...fanCoil };
  d.layout.plenum = { ...fanCoil };
  d.fanCoilStatus = PLACEMENT.APPROVED;
  d.fanCoilApprovedBy = 'installer';

  returns.forEach((r, i) => {
    d.layout[i === 0 ? 'returnGrille' : 'returnGrille_' + (i + 1)] = { ...r };
  });
  d.returnCount = returns.length;
  d.returnGrilleOverrides = returns.map(() => [600, 400]);

  // ── NEW DESIGN: NO STORED ARRANGEMENT ──────────────────────────────────
  // `supplyMainConfig` is deliberately absent. The engine picks.
  d.routingStrategy = 'area';
  d.installerAreaCount = installerAreaCount;
  if (roofClearanceMm !== null) d.roofGeometry = { minClearanceMm: roofClearanceMm };
  if (longestMainRouteM !== null) d.longestMainRouteM = longestMainRouteM;

  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.duct.minimumSupplyBranchDiameterMm = 250;
  const cat = await buildCatalogue({});
  return { out: runPipeline(d, { catalogue: cat, settings }), design: d, settings };
}

// ── A. A LARGE HOUSE ACROSS THREE INSTALLER AREAS → 3 × ø400 ──────────────
const SHEET_LARGE = [
  ['LIVING', 297, 155, '4.3 x 7.1m'], ['KITCHEN', 203, 382, '3.7 x 4.2m'],
  ['MEALS', 398, 436, '3.6 x 3.4m'], ['LOUNGE', 578, 334, '4.0 x 4.9m'],
  ['FAMILY', 238, 633, '5.8 x 3.9m'], ['FOYER', 548, 663, '3.0 x 3.9m'],
  ['MASTER BEDROOM', 790, 560, '2.7 x 4.0m'], ['BEDROOM 4', 430, 772, '3.0 x 3.4m'],
  ['BEDROOM 2', 196, 1068, '3.0 x 3.2m'], ['BEDROOM 3', 415, 1068, '3.0 x 3.2m'],
  ['ENSUITE', 790, 700, null], ['WC', 222, 737, null], ["L'DRY", 186, 771, null],
  ['BATH', 196, 884, null], ['GARAGE', 855, 799, null]
];
export const buildThreeByFourHundred = () => buildHouse({
  sheet: SHEET_LARGE,
  unitKey: 'daikin:mmem_fdyan160av1_rza160c2v1',
  fanCoil: { x: 402, y: 596 },
  returns: [{ x: 312, y: 782 }, { x: 312, y: 940 }],
  installerAreaCount: 3, roofClearanceMm: 600, longestMainRouteM: 14
});

// ── B. A LONG HOUSE, TWO AREAS, MAINS THAT HAVE TO REACH → 2 × ø400 ───────
// The same number of conditioned rooms as house C below. What differs is the
// airflow, the areas and how far the mains run — not the outlet count.
const SHEET_LONG = [
  ['LIVING', 220, 180, '4.6 x 6.8m'], ['KITCHEN', 210, 430, '3.8 x 4.4m'],
  ['MEALS', 400, 430, '3.8 x 3.8m'], ['FAMILY', 250, 660, '5.4 x 4.2m'],
  ['MASTER BEDROOM', 820, 300, '3.4 x 4.2m'], ['BEDROOM 2', 830, 560, '3.2 x 3.4m'],
  ['BEDROOM 3', 840, 820, '3.2 x 3.4m'], ['BEDROOM 4', 850, 1060, '3.0 x 3.4m'],
  ['BATH', 640, 900, null], ['GARAGE', 300, 1080, null]
];
export const buildTwoByFourHundred = () => buildHouse({
  sheet: SHEET_LONG,
  unitKey: 'daikin:mmem_fdyan125av1_rza125c2v1',
  fanCoil: { x: 540, y: 600 },
  returns: [{ x: 520, y: 700 }, { x: 560, y: 480 }],
  installerAreaCount: 2, roofClearanceMm: 600, longestMainRouteM: 20
});

// ── C. A COMPACT HOUSE, TWO AREAS, SHORT MAINS → 2 × ø350 ─────────────────
const SHEET_COMPACT = [
  ['LIVING', 260, 240, '3.8 x 4.6m'], ['KITCHEN', 250, 430, '3.0 x 3.4m'],
  ['MEALS', 410, 430, '3.0 x 3.0m'], ['FAMILY', 270, 600, '3.6 x 3.6m'],
  ['MASTER BEDROOM', 600, 300, '3.2 x 3.6m'], ['BEDROOM 2', 620, 500, '3.0 x 3.0m'],
  ['BEDROOM 3', 620, 680, '3.0 x 3.0m'], ['BEDROOM 4', 600, 850, '2.8 x 3.0m'],
  ['BATH', 450, 760, null], ['GARAGE', 250, 880, null]
];
export const buildTwoByThreeFifty = () => buildHouse({
  sheet: SHEET_COMPACT,
  unitKey: 'daikin:mmem_fdyan100av1_rza100c2v1',
  fanCoil: { x: 440, y: 520 },
  returns: [{ x: 430, y: 600 }, { x: 450, y: 440 }],
  installerAreaCount: 2, roofClearanceMm: 430, longestMainRouteM: 8
});

export default { buildThreeByFourHundred, buildTwoByFourHundred, buildTwoByThreeFifty };
