// ═══════════════════════════════════════════════════════════════════════════
// THE DUNGANNON COURT REFERENCE — NAC's own drawing, as data
// ═══════════════════════════════════════════════════════════════════════════
//
// 19 Dungannon Court, Buderim, upper level. This is the sheet Nick set as the
// golden reference for what a NAC duct layout IS, and until now the project
// held it only as two sentences in a comment.
//
// Every figure below is READ OFF THAT DRAWING — the zone boxes, the diameters
// written against each run, and the four silver manifolds. Nothing is
// calculated here and nothing is invented: it is a record of what NAC drew, so
// the engine can be held against it.
export const DUNGANNON = Object.freeze({
  job: '19 Dungannon Court, Buderim — UPPER LEVEL',
  source: 'NAC drawing, read off the sheet',

  // The zone boxes, verbatim.
  zones: Object.freeze([
    Object.freeze({ n: 1, name: 'BED 3',     kw: 1.41, ls: 65,  m2: 9.4 }),
    Object.freeze({ n: 2, name: 'BED 2',     kw: 2.43, ls: 146, m2: 16.2 }),
    Object.freeze({ n: 3, name: 'BED 4',     kw: 1.53, ls: 92,  m2: 10.2 }),
    Object.freeze({ n: 4, name: 'LIVING',    kw: 6.23, ls: 374, m2: 41.5 }),
    Object.freeze({ n: 5, name: 'OPEN PLAN', kw: 8.49, ls: 509, m2: 56.6 })
  ]),

  /** Three ducts off the plenum, all one size — NAC's plenum rule, in the field. */
  plenum: Object.freeze({ ductCount: 3, ductSizeMm: 400 }),

  /**
   * THE FOUR PHYSICAL FITTINGS. Positions are pixels on the reference image.
   *
   * Note what is NOT here: there is no fitting per outlet and none per room.
   * Eight outlets are served by four manifolds, and one of those manifolds is a
   * REDUCING TEE — the main goes in at 400 and leaves at 350 with a 250 dropped
   * on the way.
   */
  btos: Object.freeze([
    Object.freeze({ id: 'BTO-1', x: 322, y: 1200, inletMm: 400, inletLs: 374,
      ports: Object.freeze([
        Object.freeze({ mm: 300, ls: 187, serves: 'LIVING' }),
        Object.freeze({ mm: 300, ls: 187, serves: 'LIVING' })]) }),
    Object.freeze({ id: 'BTO-2', x: 565, y: 1310, inletMm: 400, inletLs: 509,
      ports: Object.freeze([
        Object.freeze({ mm: 300, ls: 170, serves: 'OPEN PLAN' }),
        Object.freeze({ mm: 300, ls: 170, serves: 'OPEN PLAN' }),
        Object.freeze({ mm: 300, ls: 169, serves: 'OPEN PLAN' })]) }),
    Object.freeze({ id: 'BTO-3', x: 815, y: 1372, inletMm: 400, inletLs: 303,
      reducingTee: true,
      ports: Object.freeze([
        Object.freeze({ mm: 250, ls: 146, serves: 'BED 2' }),
        Object.freeze({ mm: 350, ls: 157, feedsBto: 'BTO-4' })]) }),
    Object.freeze({ id: 'BTO-4', x: 930, y: 1293, inletMm: 350, inletLs: 157,
      ports: Object.freeze([
        Object.freeze({ mm: 250, ls: 92, serves: 'BED 4' }),
        Object.freeze({ mm: 250, ls: 65, serves: 'BED 3' })]) })
  ]),

  /** Colour on the sheet means SIZE, sampled off the image. */
  sizeColours: Object.freeze({ 400: '#EE64C3', 350: '#939393', 300: '#00FB3E', 250: '#FAFA00' }),

  /** The smallest supply run on the sheet — a 65 L/s bedroom on a 250. */
  smallestSupplyMm: 250,
  outletCount: 8,
  systemLs: 1186
});

export default DUNGANNON;
