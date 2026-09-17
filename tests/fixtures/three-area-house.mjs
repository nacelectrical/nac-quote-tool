// A THREE-AREA HOUSE, built from printed room sizes like any uploaded plan.
//
// Deliberately NOT anybody's job: the labels, sizes and positions here are test
// data, chosen to give the router the one shape it has to be able to find on its
// own — an open-plan living area, a separate kitchen/lounge side, and a wing of
// four bedrooms sitting in two obvious pairs. Nothing about this plan is known
// to the engine, and the test asserts what the geometry produces, never a
// coordinate.
import { parseRoomDimensionPair } from '../../designer/engines/dimensions.mjs';
import { buildRoom, architecturalMeasurement, deriveBoundariesFromPrintedSizes }
  from '../../designer/engines/rooms.mjs';
import { createDesign } from '../../designer/engines/model.mjs';
import { runPipeline } from '../../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../../designer/engines/catalogue.mjs';
import { DEFAULT_SETTINGS } from '../../designer/engines/settings.mjs';

const SHEET = [
  ['LIVING / DINING', 690, 178, '6.1 x 8.7m'],
  ['KITCHEN',         688, 534, '3.3 x 3.6m'],
  ['LOUNGE',          670, 670, '4.5 x 4.2m'],
  ['MASTER BEDROOM',  140, 576, '3.8 x 3.9m'],
  ['BEDROOM 2',       290, 594, '3.5 x 3.0m'],
  ['BEDROOM 3',       248, 378, '2.9 x 2.9m'],
  ['BEDROOM 4',       490, 596, '3.0 x 3.0m'],
  ['BATH',            364, 336, null],
  ['ENS',             100, 338, null],
  ["L'DRY",           498, 364, null]
];
const PPM = 210 / 4500;            // the Lounge's printed 4.5 m across 210 px
export const CAL = { pixelsPerMm: PPM, mmPerPixel: 1 / PPM,
                     imageWidthPx: 818, imageHeightPx: 902, display: {} };
/** Above the hallway / laundry junction — never above a bedroom. */
export const FAN_COIL = { x: 464, y: 428 };
export const RETURN_GRILLES = [{ x: 352, y: 444 }, { x: 524, y: 412 }];
/** What each installer area carries, which is what the spigot choice is made on. */
export const AREA_AIRFLOWS = [
  { name: 'Living / Dining', airflowLs: 349 },
  { name: 'Kitchen / Lounge', airflowLs: 267 },
  { name: 'Bedroom wing', airflowLs: 284 }
];

export async function buildThreeAreaHouse(opts = {}) {
  const rooms = SHEET.map(([label, x, y, printed]) => {
    const dd = printed ? parseRoomDimensionPair(printed) : null;
    return buildRoom({ label,
      measurement: architecturalMeasurement(dd?.widthMm ?? null, dd?.lengthMm ?? null,
                                            printed ? ['printed'] : []),
      labelPx: { x: x - label.length * 4, y: y - 9, w: label.length * 8, h: 18 } });
  });
  const d = createDesign();
  d.rooms = deriveBoundariesFromPrintedSizes(rooms, CAL,
    { imageWidthPx: CAL.imageWidthPx, imageHeightPx: CAL.imageHeightPx });
  d.plan = { name: 'three-area test house', widthPx: CAL.imageWidthPx, heightPx: CAL.imageHeightPx };
  d.calibration = CAL;
  d.selectedUnitKey = 'daikin:mmem_fdyan160av1_rza160c2v1';
  // The area router, which is what the application itself uses.
  d.routingStrategy = 'area';

  const id = (label) => d.rooms.find(r => r.label === label)?.id;
  // One open-plan thermal zone; the Lounge is walled off and is its own.
  d.rooms = d.rooms.map(r => (r.label === 'LIVING / DINING' || r.label === 'KITCHEN')
    ? { ...r, openPlanGroup: 'open-plan', zoneGroupSource: 'estimator' } : r);

  d.outletOverrides = {
    [id('LIVING / DINING')]: { quantity: 3 },
    [id('KITCHEN')]: { quantity: 1 },
    [id('LOUNGE')]: { quantity: 1, type: 'linear_bar' },
    [id('MASTER BEDROOM')]: { quantity: 1 },
    [id('BEDROOM 2')]: { quantity: 1 },
    [id('BEDROOM 3')]: { quantity: 1 },
    [id('BEDROOM 4')]: { quantity: 1 },
    ...(opts.outletOverrides || {})
  };

  d.layout = { indoorUnit: { ...FAN_COIL }, plenum: { ...FAN_COIL },
               returnGrille: { ...RETURN_GRILLES[0] },
               returnGrille_2: { ...RETURN_GRILLES[1] } };
  d.returnCount = 2;
  d.returnGrilleOverrides = [[700, 500], [700, 500]];
  d.installerAreaCount = 3;
  d.installerAreas = AREA_AIRFLOWS;

  const settings = JSON.parse(JSON.stringify(opts.settings || DEFAULT_SETTINGS));
  const cat = await buildCatalogue({});
  return { design: d, settings, out: runPipeline(d, { catalogue: cat, settings }), id,
           rerun: (dd) => runPipeline(dd || d, { catalogue: cat, settings }) };
}

export { SHEET };
