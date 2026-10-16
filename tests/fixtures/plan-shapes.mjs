// ─────────────────────────────────────────────────────────────────────────────
// THREE FLOOR PLANS THAT ARE NOT THE SAME HOUSE
//
// THESE ARE SYNTHETIC TEST FIXTURES. They are not NAC jobs, they are not
// anybody's house, and no drawing, address or customer is behind them. They
// exist because the review said, correctly:
//
//   "Some safeguards and reference-job tests were added, but those results do
//    not establish reliability on new floor plans."
//
// Dungannon and the three-area house are both the same SHAPE of problem: a
// roughly square single storey with a central plant position and a bedroom
// wing. A router can be tuned to that one shape and look finished. So each
// plan here is chosen for the thing it does that the others cannot, and a
// renamed or rotated copy of the reference plan would be worth nothing:
//
//   LONG_NARROW   28 m end to end, 4.2 m wide, plant at one END. There is no
//                 "radiate from the middle" answer. The index run is as long
//                 as the house and the pressure has nowhere to hide.
//
//   L_SHAPED      Two wings meeting at a right angle, plant in the inside
//                 corner. The mains have to leave at ninety degrees to each
//                 other; a router that fans them out evenly puts duct through
//                 the garden.
//
//   COMPACT_CORE  Nine small rooms around a central core on a 13 × 11 m
//                 footprint. Short runs, high room count, and the minimum
//                 branch diameter — not velocity — is what sizes the duct.
//
// Every room carries a printed size, so the scale is derived from the plan's
// own figures (calibration.deriveCalibrationFromRooms) rather than measured off
// an image that does not exist.
// ─────────────────────────────────────────────────────────────────────────────

import { parseRoomDimensionPair } from '../../designer/engines/dimensions.mjs';
import { buildRoom, architecturalMeasurement, deriveBoundariesFromPrintedSizes }
  from '../../designer/engines/rooms.mjs';
import { createDesign } from '../../designer/engines/model.mjs';
import { runPipeline } from '../../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../../designer/engines/catalogue.mjs';
import { DEFAULT_SETTINGS } from '../../designer/engines/settings.mjs';

/** 0.05 px per mm — a 20 m house is 1000 px, which is a plausible sheet. */
const PPM = 0.05;

function calibration(wPx, hPx) {
  return {
    pixelsPerMm: PPM, mmPerPixel: 1 / PPM,
    imageWidthPx: wPx, imageHeightPx: hPx,
    // A scale with an ORIGIN on it. scaleTrust() refuses a bare number, and
    // these fixtures must pass the same gate a real job does.
    source: 'measured', calibrationDistanceMm: 9000,
    pointA: { x: 0, y: 0 }, pointB: { x: 450, y: 0 },
    display: {}, calibratedAt: '2026-10-01T00:00:00Z'
  };
}

/**
 * @param {Array} sheet  [label, centreXpx, centreYpx, 'W x Lm' | null]
 */
function roomsFrom(sheet) {
  return sheet.map(([label, x, y, printed]) => {
    const dd = printed ? parseRoomDimensionPair(printed) : null;
    return buildRoom({ label,
      measurement: architecturalMeasurement(dd?.widthMm ?? null, dd?.lengthMm ?? null,
                                            printed ? ['printed'] : []),
      labelPx: { x: x - label.length * 4, y: y - 9, w: label.length * 8, h: 18 } });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LONG AND NARROW — plant at one end, nothing is central
// ─────────────────────────────────────────────────────────────────────────────
const LONG_NARROW = {
  key: 'long-narrow',
  title: 'Long narrow — 28 m end to end, plant at one end',
  challenge: 'There is no middle to radiate from. The index run is the length of '
    + 'the house, so the static pressure has nowhere to hide and the main cannot '
    + 'be stepped down early.',
  widthPx: 1480, heightPx: 320,
  // x runs 60 → 1420 px = 1.2 → 28.4 m. The house is 4.2 m deep.
  sheet: [
    ['LIVING',        220, 160, '4.2 x 6.0m'],
    ['KITCHEN',       470, 160, '4.2 x 4.0m'],
    ['DINING',        660, 160, '4.2 x 3.6m'],
    ['BEDROOM 3',     860, 160, '4.0 x 3.2m'],
    ['BEDROOM 2',    1040, 160, '4.0 x 3.2m'],
    ['MASTER',       1270, 160, '4.2 x 4.4m'],
    ['BATH',          760, 160, null],
    ["L'DRY",         150, 160, null]
  ],
  // Over the kitchen end, because that is where the roof space is.
  fanCoil: { x: 470, y: 150 },
  returns: [{ x: 360, y: 150 }],
  returnCount: 1,
  outlets: { LIVING: 2, KITCHEN: 1, DINING: 1, 'BEDROOM 3': 1, 'BEDROOM 2': 1, MASTER: 1 },
  openPlan: ['LIVING', 'KITCHEN', 'DINING'],
  installerAreaCount: 2,
  installerAreas: [
    { name: 'Living end', airflowLs: 300 },
    { name: 'Bedroom end', airflowLs: 240 }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. L-SHAPED — two wings at ninety degrees, plant in the inside corner
// ─────────────────────────────────────────────────────────────────────────────
const L_SHAPED = {
  key: 'l-shaped',
  title: 'L-shaped — two wings at right angles, plant in the inside corner',
  challenge: 'The two mains have to leave the plenum at ninety degrees to each '
    + 'other. A router that fans them out evenly, or that treats the plan as one '
    + 'rectangle, routes duct through the garden.',
  widthPx: 1020, heightPx: 980,
  // West wing runs down the left; north wing runs along the top.
  sheet: [
    ['LIVING',        300, 170, '6.0 x 5.2m'],
    ['DINING',        560, 170, '4.0 x 4.6m'],
    ['KITCHEN',       790, 170, '3.8 x 4.6m'],
    ['MASTER',        190, 430, '4.4 x 4.2m'],
    ['BEDROOM 2',     190, 630, '3.6 x 3.4m'],
    ['BEDROOM 3',     190, 810, '3.4 x 3.4m'],
    ['STUDY',         420, 430, '3.0 x 3.0m'],
    ['BATH',          420, 650, null],
    ['ENS',           380, 300, null],
    ['GARAGE',        820, 760, null]
  ],
  fanCoil: { x: 300, y: 300 },
  returns: [{ x: 250, y: 300 }, { x: 480, y: 200 }],
  returnCount: 2,
  outlets: { LIVING: 2, DINING: 1, KITCHEN: 1, MASTER: 1,
             'BEDROOM 2': 1, 'BEDROOM 3': 1, STUDY: 1 },
  openPlan: ['LIVING', 'DINING', 'KITCHEN'],
  installerAreaCount: 2,
  installerAreas: [
    { name: 'North wing — living', airflowLs: 330 },
    { name: 'West wing — bedrooms', airflowLs: 260 }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. COMPACT CORE — nine rooms on a small footprint, plant in the middle
// ─────────────────────────────────────────────────────────────────────────────
const COMPACT_CORE = {
  key: 'compact-core',
  title: 'Compact core — nine rooms on 13 × 11 m, plant central',
  challenge: 'Every run is short and every room is small, so the minimum branch '
    + 'diameter sizes the duct rather than the velocity band. A router that only '
    + 'ever sizes on velocity puts ø150 on a bedroom.',
  widthPx: 700, heightPx: 600,
  sheet: [
    ['LIVING',        180, 150, '4.4 x 4.0m'],
    ['KITCHEN',       440, 140, '3.2 x 3.0m'],
    ['DINING',        580, 150, '2.8 x 3.0m'],
    ['MASTER',        170, 400, '3.6 x 3.4m'],
    ['BEDROOM 2',     360, 460, '3.0 x 2.8m'],
    ['BEDROOM 3',     530, 460, '2.8 x 2.8m'],
    ['BEDROOM 4',     600, 300, '2.6 x 2.6m'],
    ['STUDY',         330, 300, '2.4 x 2.4m'],
    ['BATH',          460, 300, null],
    ["L'DRY",         250, 250, null],
    ['WC',            250, 520, null]
  ],
  fanCoil: { x: 370, y: 290 },
  returns: [{ x: 310, y: 290 }],
  returnCount: 1,
  outlets: { LIVING: 2, KITCHEN: 1, DINING: 1, MASTER: 1, 'BEDROOM 2': 1,
             'BEDROOM 3': 1, 'BEDROOM 4': 1, STUDY: 1 },
  openPlan: ['LIVING', 'KITCHEN', 'DINING'],
  installerAreaCount: 2,
  installerAreas: [
    { name: 'Living side', airflowLs: 250 },
    { name: 'Bedroom side', airflowLs: 230 }
  ]
};

export const PLAN_SHAPES = [LONG_NARROW, L_SHAPED, COMPACT_CORE];

/** Build and run one of them through the real pipeline. */
export async function buildPlan(spec, opts = {}) {
  const CAL = calibration(spec.widthPx, spec.heightPx);
  const rooms = roomsFrom(spec.sheet);
  const d = createDesign();
  d.rooms = deriveBoundariesFromPrintedSizes(rooms, CAL,
    { imageWidthPx: CAL.imageWidthPx, imageHeightPx: CAL.imageHeightPx });
  d.plan = { name: spec.title + ' (SYNTHETIC TEST FIXTURE)',
             widthPx: CAL.imageWidthPx, heightPx: CAL.imageHeightPx };
  d.calibration = CAL;
  d.selectedUnitKey = opts.unitKey || 'daikin:mmem_fdyan160av1_rza160c2v1';
  d.routingStrategy = 'area';

  const id = (label) => d.rooms.find(r => r.label === label)?.id;
  const open = new Set(spec.openPlan || []);
  d.rooms = d.rooms.map(r => open.has(r.label)
    ? { ...r, openPlanGroup: 'open-plan', zoneGroupSource: 'estimator' } : r);

  d.outletOverrides = {};
  for (const [label, quantity] of Object.entries(spec.outlets)) {
    const rid = id(label);
    if (rid) d.outletOverrides[rid] = { quantity };
  }

  d.layout = { indoorUnit: { ...spec.fanCoil }, plenum: { ...spec.fanCoil },
               returnGrille: { ...spec.returns[0] },
               ...(spec.returns[1] ? { returnGrille_2: { ...spec.returns[1] } } : {}) };
  d.returnCount = spec.returnCount;
  d.returnGrilleOverrides = spec.returns.map(() => [700, 500]);
  d.installerAreaCount = spec.installerAreaCount;
  d.installerAreas = spec.installerAreas;

  const settings = JSON.parse(JSON.stringify(opts.settings || DEFAULT_SETTINGS));
  const cat = await buildCatalogue({});
  const out = runPipeline(d, { catalogue: cat, settings });
  return { spec, design: d, settings, out, id,
           rerun: (dd) => runPipeline(dd || d, { catalogue: cat, settings }) };
}

export default { PLAN_SHAPES, buildPlan };
