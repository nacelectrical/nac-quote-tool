// NAC AI HVAC DESIGNER — PART 36: realistic Australian builder plan fixture.
//
// This is NOT a set of tidy 3 m × 3 m boxes. It is a single-storey brick-veneer
// project home drawn the way a builder draws one: chained perimeter dimension
// rows with wall thicknesses inside the chain, an outer overall row, window and
// door widths on a separate row mixed in among them, and level/spec annotations
// that look like numbers but are not lengths.
//
// No room carries its own printed "3.6 × 3.4" label. Every room dimension in
// this fixture has to be RECONSTRUCTED from the chains — which is exactly the
// problem PART 3 and PART 4 exist to solve.
//
// Overall building: 18 020 mm wide × 14 250 mm deep (external face to face).
//
//   Horizontal (X) chain, front elevation, left to right:
//     110 | 3600 | 90 | 1800 | 90 | 3200 | 90 | 3200 | 90 | 5640 | 110  = 18020
//      ^brick      ^stud       ^stud       ^stud       ^stud      ^brick
//   Vertical (Y) chain, front to rear:
//     110 | 3400 | 90 | 2600 | 90 | 3600 | 90 | 4160 | 110              = 14250

export const SAMPLE_PLAN_META = {
  name: 'Sample AU builder plan — single storey 4 bed + media + double garage',
  externalWidthMm: 18020,
  externalDepthMm: 14250,
  scaleLabelText: 'SCALE 1:100 @ A3',
  // Pretend upload: a 1400 × 1120 px screenshot of the plan sheet.
  imageWidthPx: 1400,
  imageHeightPx: 1120,
  originPx: { x: 120, y: 120 },
  // The estimator calibrates across a printed 6000 mm dimension: 386.24 px.
  calibrationPointA: { x: 120, y: 1040 },
  calibrationPointB: { x: 506.24, y: 1040 },
  calibrationKnownDistance: 6000,
  calibrationUnit: 'mm'
};

export const PX_PER_MM = 386.24 / 6000;      // 0.0643733…

// Horizontal (X) chain, front elevation.
export const H_CHAIN_SEGMENTS = [110, 3600, 90, 1800, 90, 3200, 90, 3200, 90, 5640, 110];
export const H_OVERALL_MM = 18020;
// Reconstructed stations (index → mm):
//  0:0  1:110  2:3710  3:3800  4:5600  5:5690  6:8890  7:8980  8:12180  9:12270  10:17910  11:18020
export const H_STATIONS = [0, 110, 3710, 3800, 5600, 5690, 8890, 8980, 12180, 12270, 17910, 18020];

// Vertical (Y) chain, front to rear.
export const V_CHAIN_SEGMENTS = [110, 3400, 90, 2600, 90, 3600, 90, 4160, 110];
export const V_OVERALL_MM = 14250;
//  0:0  1:110  2:3510  3:3600  4:6200  5:6290  6:9890  7:9980  8:14140  9:14250
export const V_STATIONS = [0, 110, 3510, 3600, 6200, 6290, 9890, 9980, 14140, 14250];

const X = (mm) => SAMPLE_PLAN_META.originPx.x + mm * PX_PER_MM;
const Y = (mm) => SAMPLE_PLAN_META.originPx.y + mm * PX_PER_MM;

/**
 * Raw detections in the shape an OCR / vision pass hands them over: the text
 * that was read, a bounding box in image pixels, an orientation, and the
 * dimension row it was drawn on.
 */
export function sampleDetections() {
  const det = [];
  let n = 0;

  // ── Row 0: the outer overall dimension on each axis ────────────────────────
  det.push({ id: 'h0_overall', text: String(H_OVERALL_MM), orientation: 'horizontal', row: 0,
    box: { x: X(H_OVERALL_MM / 2) - 22, y: Y(0) - 62, w: 44, h: 12 } });
  det.push({ id: 'v0_overall', text: String(V_OVERALL_MM), orientation: 'vertical', row: 0,
    box: { x: X(0) - 62, y: Y(V_OVERALL_MM / 2) - 22, w: 12, h: 44 } });

  // ── Row 1: the setting-out chains ─────────────────────────────────────────
  let acc = 0;
  for (const seg of H_CHAIN_SEGMENTS) {
    det.push({ id: 'h1_' + (++n), text: String(seg), orientation: 'horizontal', row: 1,
      box: { x: X(acc + seg / 2) - 12, y: Y(0) - 30, w: 24, h: 10 } });
    acc += seg;
  }
  acc = 0; n = 0;
  for (const seg of V_CHAIN_SEGMENTS) {
    det.push({ id: 'v1_' + (++n), text: String(seg), orientation: 'vertical', row: 1,
      box: { x: X(0) - 30, y: Y(acc + seg / 2) - 12, w: 10, h: 24 } });
    acc += seg;
  }

  // ── Row 2: opening widths, drawn on the wall line itself ──────────────────
  // These are the numbers that must NOT become room dimensions.
  const openings = [
    { id: 'win1',    centreMm: 1900,  widthMm: 1800 },
    { id: 'door1',   centreMm: 4700,  widthMm: 820 },
    { id: 'slider1', centreMm: 14500, widthMm: 2400 }
  ];
  for (const o of openings) {
    det.push({ id: o.id, text: String(o.widthMm), orientation: 'horizontal', row: 2,
      box: { x: X(o.centreMm) - 12, y: Y(0) + 34, w: 24, h: 10 } });
  }

  // ── Row 3+: annotations that look numeric but are not lengths ─────────────
  det.push({ id: 'note1', text: 'R2.5',      orientation: 'horizontal', row: 3, box: { x: X(4000), y: Y(6000), w: 30, h: 10 } });
  det.push({ id: 'note2', text: 'FFL 12.50', orientation: 'horizontal', row: 3, box: { x: X(4600), y: Y(6400), w: 52, h: 10 } });
  det.push({ id: 'note3', text: 'BED 3',     orientation: 'horizontal', row: 3, box: { x: X(9500), y: Y(1800), w: 40, h: 10 } });
  det.push({ id: 'note4', text: '3',         orientation: 'horizontal', row: 3, box: { x: X(9800), y: Y(2100), w: 10, h: 10 } });
  // A boundary setback, outside the building envelope.
  det.push({ id: 'setback1', text: '900',    orientation: 'vertical',   row: 4, box: { x: X(0) - 110, y: Y(2000), w: 20, h: 10 } });

  return det;
}

/** Detected window / door symbols, aligned with the row-2 dimensions above. */
export function sampleOpenings() {
  return [
    { id: 'o_win1',    type: 'window',       box: { x: X(1900 - 900),  y: Y(0) + 32, w: 1800 * PX_PER_MM, h: 12 } },
    { id: 'o_door1',   type: 'door',         box: { x: X(4700 - 410),  y: Y(0) + 32, w: 820 * PX_PER_MM,  h: 12 } },
    { id: 'o_slider1', type: 'sliding door', box: { x: X(14500 - 1200), y: Y(0) + 32, w: 2400 * PX_PER_MM, h: 12 } }
  ];
}

/** Detected wall centrelines, used as supporting geometry only. */
export function sampleWalls() {
  const walls = [];
  H_STATIONS.forEach((mm, i) => walls.push({ id: 'wv' + i, orientation: 'vertical', xPx: X(mm), atMm: mm }));
  V_STATIONS.forEach((mm, i) => walls.push({ id: 'wh' + i, orientation: 'horizontal', yPx: Y(mm), atMm: mm }));
  return walls;
}

/**
 * Room definitions expressed the way the plan actually defines them: by the
 * chain stations that bound each room. `h` / `v` are station INDICES into the
 * reconstructed chains above.
 *
 *   H bays:  [1-2] 3600   [3-4] 1800   [5-6] 3200   [7-8] 3200   [9-10] 5640
 *   V bands: [1-2] 3400   [3-4] 2600   [5-6] 3600   [7-8] 4160
 */
export const SAMPLE_ROOMS = [
  // Front band — bedroom wing and the garage.
  { label: 'Master Bedroom', h: [1, 2],  v: [1, 2], orientation: 'N',  externalWalls: 2, glazingAreaSqM: 2.9, ceilingHeightMm: 2550 },
  { label: 'Ensuite',        h: [3, 4],  v: [1, 2] },
  { label: 'Bed 2',          h: [5, 6],  v: [1, 2], orientation: 'N',  externalWalls: 2, glazingAreaSqM: 1.9 },
  { label: 'Bed 3',          h: [7, 8],  v: [1, 2], orientation: 'NE', externalWalls: 2, glazingAreaSqM: 1.9 },
  { label: 'Garage',         h: [9, 10], v: [1, 4] },

  // Second band — hall and the wet areas.
  { label: 'Hall',           h: [1, 2],  v: [3, 4], externalWalls: 1 },
  { label: 'WIR',            h: [3, 4],  v: [3, 4] },
  { label: "L'DRY",          h: [5, 6],  v: [3, 4] },
  { label: 'Bath',           h: [7, 8],  v: [3, 4] },

  // Third band — remaining bedroom, study, media and the open-plan core.
  { label: 'Bed 4',          h: [1, 2],  v: [5, 6], orientation: 'W',  externalWalls: 2, glazingAreaSqM: 1.9 },
  { label: 'Study',          h: [3, 4],  v: [5, 6], orientation: 'W',  externalWalls: 1, glazingAreaSqM: 1.2 },
  { label: 'Media',          h: [5, 6],  v: [5, 6], shading: 'heavy',  externalWalls: 0, glazingAreaSqM: 0 },
  { label: 'Kitchen',        h: [7, 8],  v: [5, 6], orientation: 'S',  externalWalls: 1, glazingAreaSqM: 1.8,
    openPlanGroup: 'living-dining-kitchen' },
  { label: 'Living',         h: [9, 10], v: [5, 6], orientation: 'SE', externalWalls: 2, glazingAreaSqM: 5.4,
    openPlanGroup: 'living-dining-kitchen' },

  // Rear band — dining and the alfresco.
  { label: 'Dining',         h: [7, 8],  v: [7, 8], orientation: 'S',  externalWalls: 2, glazingAreaSqM: 4.2,
    openPlanGroup: 'living-dining-kitchen' },
  { label: 'Alfresco',       h: [9, 10], v: [7, 8] }
];

export const SAMPLE_CUSTOMER = {
  name: 'Sample Residence',
  address: '14 Wattlebird Drive, Springfield Lakes QLD 4300',
  phone: '0400 000 000',
  email: 'sample@example.com'
};

export const SAMPLE_JOB = {
  description: 'Ducted AC Supply & Install',
  houseType: 'Single storey brick veneer, new build',
  climate: 'qld-seq'
};
