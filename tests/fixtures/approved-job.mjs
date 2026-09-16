// 19 <plan> — THE APPROVED JOB, run through the real engine.
// Manual outlet positions, Study on spill air, min o250, fan coil above the
// Study (installer-approved), two hallway returns.
import { parseRoomDimensionPair } from '../../designer/engines/dimensions.mjs';
import { buildRoom, architecturalMeasurement, deriveBoundariesFromPrintedSizes }
  from '../../designer/engines/rooms.mjs';
import { createDesign } from '../../designer/engines/model.mjs';
import { runPipeline } from '../../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../../designer/engines/catalogue.mjs';
import { DEFAULT_SETTINGS } from '../../designer/engines/settings.mjs';
import { PLACEMENT, OUTLET_SOURCE } from '../../designer/engines/placement.mjs';

const SHEET = [
  ['LIVING',297,155,'4.3 x 7.1m'],['KITCHEN',203,382,'3.7 x 4.2m'],['MEALS',398,436,'3.6 x 3.4m'],
  ['LOUNGE',578,334,'4.0 x 4.9m'],['FAMILY',238,633,'5.8 x 3.9m'],['STUDY',378,600,'2.8 x 2.6m'],
  ['FOYER',548,663,'3.0 x 3.9m'],['MASTER BEDROOM',790,560,'2.7 x 4.0m'],['BEDROOM 4',430,772,'3.0 x 3.4m'],
  ['BEDROOM 2',196,1068,'3.0 x 3.2m'],['BEDROOM 3',415,1068,'3.0 x 3.2m'],
  ['ENSUITE',790,700,null],['WC',222,737,null],["L'DRY",186,771,'2.9 x 2.3m'],['BATH',196,884,'2.9 x 1.4m'],
  ['GARAGE',855,799,'6.0 x 6.9m'],['COVERED ALFRESCO',845,335,null],['PORCH',658,775,null],
  ["P'TRY",137,438,null],["CUP'D",313,987,null]
];
const PPM = 340/6000;
export const CAL = { pixelsPerMm: PPM, mmPerPixel: 1/PPM, imageWidthPx: 1179, imageHeightPx: 1262, display: {} };

// Approved outlet positions. Nine were read off the marked sheet; MEALS and
// FAMILY-2 were placed by the estimator and are recorded as such.
export const APPROVED_OUTLETS = {
  'LIVING':         [{ x: 209, y: 139,  src: OUTLET_SOURCE.DETECTED }],
  'KITCHEN':        [{ x: 212, y: 410,  src: OUTLET_SOURCE.DETECTED }],
  'MEALS':          [{ x: 398, y: 430,  src: OUTLET_SOURCE.MANUAL }],
  'LOUNGE':         [{ x: 565, y: 347,  src: OUTLET_SOURCE.DETECTED }],
  'FAMILY':         [{ x: 201, y: 609,  src: OUTLET_SOURCE.DETECTED },
                     { x: 258, y: 518,  src: OUTLET_SOURCE.MANUAL }],
  'FOYER':          [{ x: 535, y: 643,  src: OUTLET_SOURCE.DETECTED }],
  'MASTER BEDROOM': [{ x: 800, y: 456,  src: OUTLET_SOURCE.DETECTED }],
  'BEDROOM 4':      [{ x: 471, y: 844,  src: OUTLET_SOURCE.DETECTED }],
  'BEDROOM 2':      [{ x: 185, y: 1053, src: OUTLET_SOURCE.DETECTED }],
  'BEDROOM 3':      [{ x: 431, y: 1063, src: OUTLET_SOURCE.DETECTED }]
};

/** The fan coil, approved by the installer above the Study. */
export const FAN_COIL = { x: 402, y: 596 };
/** Both return grilles, in the bedroom hallway, well apart. */
// Both in the bedroom corridor, clear of every bedroom boundary, 2.8 m apart
// so they draw from the whole circulation rather than one patch of ceiling.
export const RETURN_GRILLES = [{ x: 312, y: 782 }, { x: 312, y: 940 }];

export async function buildApproved(opts = {}) {
  const rooms = SHEET.map(([label,x,y,printed]) => {
    const dd = printed ? parseRoomDimensionPair(printed) : null;
    return buildRoom({ label,
      measurement: architecturalMeasurement(dd?.widthMm ?? null, dd?.lengthMm ?? null, printed?['printed']:[]),
      labelPx: { x: x-label.length*4, y: y-9, w: label.length*8, h: 18 } });
  });
  const d = createDesign();
  d.rooms = deriveBoundariesFromPrintedSizes(rooms, CAL, { imageWidthPx:1179, imageHeightPx:1262 });
  d.plan = { name:'19 <plan>', widthPx:1179, heightPx:1262 };
  d.calibration = CAL;
  d.selectedUnitKey = 'daikin:mmem_fdyan160av1_rza160c2v1';

  const id = (label) => d.rooms.find(r => r.label === label)?.id;

  // THE STUDY TAKES SPILL AIR. Load and area stay; outlet and duct do not.
  d.spillRoomIds = [id('STUDY')];
  d.spillIntoRoomIds = ['LIVING','KITCHEN','MEALS','LOUNGE','FAMILY'].map(id);

  // Outlet quantity and position, fixed by the estimator.
  d.outletOverrides = {}; d.layout = {}; d.outletPositionSources = {};
  for (const [label, list] of Object.entries(APPROVED_OUTLETS)) {
    const rid = id(label);
    d.outletOverrides[rid] = { quantity: list.length };
    d.outletPositionSources[rid] = list.some(o => o.src === OUTLET_SOURCE.MANUAL)
      ? OUTLET_SOURCE.MANUAL : OUTLET_SOURCE.DETECTED;
    list.forEach((o, i) => { d.layout['outlet_' + rid + '_' + i] = { x: o.x, y: o.y }; });
  }

  // THE APPROVED FAN-COIL POSITION — above the Study, and signed off.
  d.layout.indoorUnit = { ...FAN_COIL };
  d.layout.plenum = { ...FAN_COIL };
  d.fanCoilStatus = opts.fanCoilStatus || PLACEMENT.APPROVED;
  d.fanCoilApprovedBy = 'installer';

  // Two return grilles, both in the bedroom hallway, 600 x 400.
  d.layout.returnGrille = { ...RETURN_GRILLES[0] };
  d.layout.returnGrille_2 = { ...RETURN_GRILLES[1] };
  d.returnCount = 2;
  d.returnGrilleOverrides = [[600, 400], [600, 400]];

  // The old Lounge partitions are gone. Recorded, not erased.
  d.demolishedWalls = [
    { id: 'w_lounge_west', label: 'Lounge / Meals partition', between: ['LOUNGE','MEALS'],
      x0: 460, y0: 288, x1: 460, y1: 572,
      reason: 'Removed in the renovation — open plan.', approvedBy: 'installer' },
    { id: 'w_lounge_south', label: 'Lounge / Foyer partition', between: ['LOUNGE','FOYER'],
      x0: 460, y0: 568, x1: 690, y1: 568,
      reason: 'Removed in the renovation — open plan.', approvedBy: 'installer' }
  ];

  // THREE o400 SUPPLY MAINS — installer-approved for this job, not a global
  // default. Its presence is what switches the router to one main per area.
  d.supplyMainConfig = { count: 3, diameterMm: 400, approvedBy: 'installer',
                         note: 'Installer-approved for this job.' };

  // NAC's install minimum for this job.
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.duct.minimumSupplyBranchDiameterMm = 250;

  const cat = await buildCatalogue({});
  return { out: runPipeline(d, { catalogue: cat, settings }), design: d, settings };
}
