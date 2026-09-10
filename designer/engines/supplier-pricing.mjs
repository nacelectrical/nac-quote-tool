// NAC AI HVAC DESIGNER — NAC's supplier price list.
//
// Source: MMEM Trade Price List, January 2026, ex GST (NAC account 201169),
// as supplied by Nick. These are COSTS, not sell prices. On the job-cost-plus-
// fee basis they feed straight into the customer's price, so they are dated and
// attributed here rather than buried in the engines.
//
// Review these against MMEM's current list when it is reissued.

export const MMEM_META = {
  source: 'MMEM Trade Price List',
  edition: 'January 2026',
  basis: 'ex GST',
  account: '201169',
  loadedAt: '2026-01',
  note: 'Trade cost to NAC, excluding GST. Update when MMEM reissue their list.'
};

/**
 * Ducted indoor + outdoor sets. `code` is the pair exactly as MMEM list it;
 * `indoor` is the first half, which is what the tool matches models on.
 */
export const MMEM_DUCTED = [
  // ── Daikin — Premium Inverter, single phase ────────────────────────────────
  { brandId: 'daikin', code: 'FDYA71AV19 / RZAS71C2V1',   kw: 7.0,  phase: '1Ph', cost: 3200, series: 'Premium Inverter' },
  { brandId: 'daikin', code: 'FDYA85AV19 / RZAS85C2V1',   kw: 8.0,  phase: '1Ph', cost: 3625, series: 'Premium Inverter' },
  { brandId: 'daikin', code: 'FDYA100AV19 / RZAS100C2V1', kw: 10.0, phase: '1Ph', cost: 4000, series: 'Premium Inverter' },
  { brandId: 'daikin', code: 'FDYA125AV19 / RZAS125C2V1', kw: 12.0, phase: '1Ph', cost: 4625, series: 'Premium Inverter' },
  { brandId: 'daikin', code: 'FDYA140AV19 / RZAS140C2V1', kw: 14.0, phase: '1Ph', cost: 5200, series: 'Premium Inverter' },
  { brandId: 'daikin', code: 'FDYA160AV19 / RZAS160C2V1', kw: 16.0, phase: '1Ph', cost: 5700, series: 'Premium Inverter' },

  // ── Daikin — Standard Inverter, single phase ───────────────────────────────
  { brandId: 'daikin', code: 'FDYAN50AV1 / RZA50C2V1',   kw: 5.0,  phase: '1Ph', cost: 2250, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN60AV1 / RZA60C2V1',   kw: 6.0,  phase: '1Ph', cost: 2500, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN71AV1 / RZA71C2V1',   kw: 7.0,  phase: '1Ph', cost: 2705, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN85AV1 / RZA85C2V1',   kw: 8.0,  phase: '1Ph', cost: 3050, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN100AV1 / RZA100C2V1', kw: 10.0, phase: '1Ph', cost: 3300, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN125AV1 / RZA125C2V1', kw: 12.0, phase: '1Ph', cost: 3820, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN140AV1 / RZA140C2V1', kw: 14.0, phase: '1Ph', cost: 4400, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN160AV1 / RZA160C2V1', kw: 16.0, phase: '1Ph', cost: 4820, series: 'Standard Inverter' },

  // ── Daikin — Standard Inverter, three phase ────────────────────────────────
  { brandId: 'daikin', code: 'FDYAN71AV1 / RZA71C2Y1',   kw: 7.0,  phase: '3Ph', cost: 3150, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN100AV1 / RZA100C2Y1', kw: 10.0, phase: '3Ph', cost: 3800, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN125AV1 / RZA125C2Y1', kw: 12.0, phase: '3Ph', cost: 4300, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN140AV1 / RZA140C2Y1', kw: 14.0, phase: '3Ph', cost: 4720, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYAN160AV1 / RZA160C2Y1', kw: 16.0, phase: '3Ph', cost: 4995, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYQN180LCV1 / RZQ180M2Y1', kw: 18.0, phase: '3Ph', cost: 4985, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYQN200LCV1 / RZQ200MY1',  kw: 20.0, phase: '3Ph', cost: 5285, series: 'Standard Inverter' },
  { brandId: 'daikin', code: 'FDYQN250LBV1 / RZQ250LY1',  kw: 24.0, phase: '3Ph', cost: 6435, series: 'Standard Inverter' },

  // ── Mitsubishi Electric ────────────────────────────────────────────────────
  { brandId: 'me', code: 'PEA-M100GAA.TH / PUZ-M100VKA-A.TH',  kw: 10.0, phase: '1Ph', cost: 3225, series: 'Ducted Inverter R32' },
  { brandId: 'me', code: 'PEA-M125GAA.TH / PUZ-M125VKA-A.TH',  kw: 12.0, phase: '1Ph', cost: 3520, series: 'Ducted Inverter R32' },
  { brandId: 'me', code: 'PEA-M140GAA.TH / PUZ-M140VKA-A.TH',  kw: 14.0, phase: '1Ph', cost: 4100, series: 'Ducted Inverter R32' },
  { brandId: 'me', code: 'PEA-M100HAA / PUZ-M100VKA-A.TH',     kw: 10.0, phase: '1Ph', cost: 3360, series: '2pc Ducted Inverter' },
  { brandId: 'me', code: 'PEA-M125HAA / PUZ-M125VKA-A.TH',     kw: 12.0, phase: '1Ph', cost: 3645, series: '2pc Ducted Inverter' },
  { brandId: 'me', code: 'PEA-M140HAA / PUZ-M140VKA-A.TH',     kw: 14.0, phase: '1Ph', cost: 4225, series: '2pc Ducted Inverter' },
  { brandId: 'me', code: 'PEA-M160HAA / PUZ-ZM160VKA-A.TH',    kw: 16.0, phase: '1Ph', cost: 4950, series: '2pc Ducted Inverter' },
  { brandId: 'me', code: 'PEA-M180LAA.TH / PUZ-ZM180VKA-A.TH', kw: 18.0, phase: '1Ph', cost: 5515, series: '2pc Ducted Inverter' },

  // ── Fujitsu — Airstage High Static ─────────────────────────────────────────
  { brandId: 'fujitsu', code: 'ARTH24KHTA / AOTH24KBTA', kw: 7.0,  phase: '1Ph', cost: 2495, series: 'Airstage High Static' },
  { brandId: 'fujitsu', code: 'ARTH30KHTA / AOTH30KBTA', kw: 8.0,  phase: '1Ph', cost: 2830, series: 'Airstage High Static' },
  { brandId: 'fujitsu', code: 'ARTH36KHTA / AOTH36KBTA', kw: 10.0, phase: '1Ph', cost: 3050, series: 'Airstage High Static' },
  { brandId: 'fujitsu', code: 'ARTH45KHTA / AOTH45KBTA', kw: 12.0, phase: '1Ph', cost: 3500, series: 'Airstage High Static' },
  { brandId: 'fujitsu', code: 'ARTH54KHTA / AOTH54KBTA', kw: 14.0, phase: '1Ph', cost: 4000, series: 'Airstage High Static' },
  { brandId: 'fujitsu', code: 'ARTH60KHTA / AOTH60KBTA', kw: 16.0, phase: '1Ph', cost: 4400, series: 'Airstage High Static' },
  { brandId: 'fujitsu', code: 'ARTH65KHTA / AOTH65KBTA', kw: 18.0, phase: '1Ph', cost: 4620, series: 'Airstage High Static' },

  // ── Gree ───────────────────────────────────────────────────────────────────
  { brandId: 'gree', code: 'GUD50PHS1/C-S / GUD50W1/NhC-S',   kw: 5.0,  phase: '1Ph', cost: 1415, series: 'Ducted' },
  { brandId: 'gree', code: 'GUD71PHS1/C-S / GUD71W1/NhC-S',   kw: 7.0,  phase: '1Ph', cost: 1600, series: 'Ducted' },
  { brandId: 'gree', code: 'GUD100PHS1/C-S / GUD100W1/NhC-S', kw: 10.0, phase: '1Ph', cost: 2230, series: 'Ducted' },
  { brandId: 'gree', code: 'GUD125PHS1/C-S / GUD125W1/NhC-S', kw: 12.0, phase: '1Ph', cost: 2675, series: 'Ducted' },
  { brandId: 'gree', code: 'GUD140PHS1/C-S / GUD140W1/NhC-S', kw: 14.0, phase: '1Ph', cost: 2965, series: 'Ducted' },
  { brandId: 'gree', code: 'GUD160PHS1/C-S / GUD160W1/NhC-S', kw: 16.0, phase: '1Ph', cost: 3280, series: 'Ducted' },

  // ── Panasonic — NX High Static ─────────────────────────────────────────────
  { brandId: 'panasonic', code: 'S-60PE3R / U-60PZ3R5',   kw: 6.0,  phase: '1Ph', cost: 2506, series: 'NX High Static' },
  { brandId: 'panasonic', code: 'S-71PE3R / U-71PZ3R5',   kw: 7.0,  phase: '1Ph', cost: 2985, series: 'NX High Static' },
  { brandId: 'panasonic', code: 'S-100PE3R / U-100PZ3R5', kw: 10.0, phase: '1Ph', cost: 3300, series: 'NX High Static' },
  { brandId: 'panasonic', code: 'S-125PE3R / U-125PZ3R5', kw: 12.0, phase: '1Ph', cost: 3820, series: 'NX High Static' },
  { brandId: 'panasonic', code: 'S-140PE3R / U-140PZ3R5', kw: 14.0, phase: '1Ph', cost: 4400, series: 'NX High Static' },
  { brandId: 'panasonic', code: 'S-160PE3R / U-160PZH3R5', kw: 16.0, phase: '1Ph', cost: 4970, series: 'NX High Static' },
  { brandId: 'panasonic', code: 'S-180PE4R / U-180PZH3R5', kw: 18.0, phase: '1Ph', cost: 5575, series: 'NX High Static' },

  // ── Samsung ────────────────────────────────────────────────────────────────
  { brandId: 'samsung', code: 'AC052TNHDKG/SA / AC052TXAPKG/SA', kw: 5.0,  phase: '1Ph', cost: 1620, series: 'Ducted' },
  { brandId: 'samsung', code: 'AC071TNHDKG/SA / AC071TXAPKG/SA', kw: 7.0,  phase: '1Ph', cost: 2015, series: 'Ducted' },
  { brandId: 'samsung', code: 'AC090TNHDKG/SA / AC090TXAPKG/SA', kw: 9.0,  phase: '1Ph', cost: 2100, series: 'Ducted' },
  { brandId: 'samsung', code: 'AC100TNHPKG/SA / AC100TXAPKG/SA', kw: 10.0, phase: '1Ph', cost: 2380, series: 'Ducted' },
  { brandId: 'samsung', code: 'AC120TNHPKG/SA / AC120TXAPKG/SA', kw: 12.0, phase: '1Ph', cost: 2695, series: 'Ducted' },
  { brandId: 'samsung', code: 'AC140TNHPKG/SA / AC140TXAPKG/SA', kw: 14.0, phase: '1Ph', cost: 2995, series: 'Ducted' },
  { brandId: 'samsung', code: 'AC160TNHPKG/SA / AC160TXAPKG/SA', kw: 16.0, phase: '1Ph', cost: 3450, series: 'Ducted' },

  // ── Braemar ────────────────────────────────────────────────────────────────
  { brandId: 'braemar', code: 'MMABRAKCHV070D1B', kw: 7.0,  phase: '1Ph', cost: 1850, series: 'Ducted' },
  { brandId: 'braemar', code: 'MMABRAKCHV100D1B', kw: 10.0, phase: '1Ph', cost: 2430, series: 'Ducted' },
  { brandId: 'braemar', code: 'MMABRAKCHV125D1B', kw: 12.5, phase: '1Ph', cost: 2875, series: 'Ducted' },
  { brandId: 'braemar', code: 'MMABRAKCHV140D1B', kw: 14.0, phase: '1Ph', cost: 3160, series: 'Ducted' },
  { brandId: 'braemar', code: 'MMABRAKCHV160D1B', kw: 16.0, phase: '1Ph', cost: 3480, series: 'Ducted' }
];

/**
 * Zone controllers and controls, with what they cost NAC. The Siemens kits and
 * the AirTouch 5 lines are repriced from MMEM quotation 447-321514-000.
 */
export const MMEM_ZONE_CONTROLS = [
  { id: 'at5_daikin',   code: 'MMAAT5DK',     name: 'AirTouch 5 — Daikin kit',              cost: 1100.00, maxZones: 16, brandLock: 'daikin' },
  { id: 'at5_sensor',   code: 'MMAAT5S',      name: 'AirTouch 5 temperature sensor',        cost: 92.00,   perZoneAccessory: true },
  { id: 'dk_z4_230',    code: 'BRC230Z4B9',   name: 'Daikin 4-zone controller (230–240V)',  cost: 475.00,  maxZones: 4,  brandLock: 'daikin' },
  { id: 'dk_z8_230',    code: 'BRC230Z8B9',   name: 'Daikin 8-zone controller (230–240V)',  cost: 629.00,  maxZones: 8,  brandLock: 'daikin' },
  { id: 'dk_z4_24',     code: 'BRC24Z4B9',    name: 'Daikin 4-zone controller (24V)',       cost: 365.00,  maxZones: 4,  brandLock: 'daikin' },
  { id: 'dk_z8_24',     code: 'BRC24Z8B9',    name: 'Daikin 8-zone controller (24V)',       cost: 445.00,  maxZones: 8,  brandLock: 'daikin' },
  { id: 'dk_z4_24_mm',  code: 'MMABRC24Z4B9', name: 'Daikin 4-zone controller (24V, MMEM)', cost: 360.00,  maxZones: 4,  brandLock: 'daikin' },
  { id: 'dk_z8_24_mm',  code: 'MMABRC24Z8B9', name: 'Daikin 8-zone controller (24V, MMEM)', cost: 420.00,  maxZones: 8,  brandLock: 'daikin' },
  { id: 'dk_airhub',    code: 'BRCMTZCB9',    name: 'Daikin AirHub Touch (main)',           cost: 698.00,  maxZones: 8,  brandLock: 'daikin' },
  { id: 'dk_airhub_z4', code: 'BRC24TZ4B9',   name: 'Daikin AirHub 4-zone box (24V)',       cost: 440.00,  maxZones: 4,  brandLock: 'daikin' },
  { id: 'dk_airhub_z8', code: 'BRC24TZ8B9',   name: 'Daikin AirHub 8-zone box (24V)',       cost: 620.00,  maxZones: 8,  brandLock: 'daikin' },
  { id: 'me_z4_24',     code: 'PAC-ZC40L-E',  name: 'Mitsubishi 4-zone controller (24V)',   cost: 427.70,  maxZones: 4,  brandLock: 'me' },
  { id: 'me_z4_240',    code: 'PAC-ZC40H-E',  name: 'Mitsubishi 4-zone controller (240V)',  cost: 395.00,  maxZones: 4,  brandLock: 'me' },
  { id: 'me_z8_24',     code: 'PAC-ZC80L-E',  name: 'Mitsubishi 8-zone controller (24V)',   cost: 573.30,  maxZones: 8,  brandLock: 'me' },
  { id: 'me_z8_240',    code: 'PAC-ZC80H-E',  name: 'Mitsubishi 8-zone controller (240V)',  cost: 585.00,  maxZones: 8,  brandLock: 'me' },
  { id: 'fj_zone',      code: 'UTY-CDRXZC',   name: 'Fujitsu 24V zone control interface',   cost: 480.00,  maxZones: 8,  brandLock: 'fujitsu' },
  { id: 'fj_anywair',   code: 'UTY-ANY2',     name: 'Fujitsu ducted anywAiR controller',    cost: 1327.50, maxZones: 8,  brandLock: 'fujitsu' },
  { id: 'siemens_z4',   code: 'MMASEM4ZTPKIT', name: 'Siemens Home zone control — 4 zone',  cost: 250.00,  maxZones: 4 },
  { id: 'siemens_z6',   code: 'MMASEM6ZTPKIT', name: 'Siemens Home zone control — 6 zone',  cost: 295.00,  maxZones: 6 },
  { id: 'siemens_z8',   code: 'MMASEM8ZTPKIT', name: 'Siemens Home zone control — 8 zone',  cost: 320.00,  maxZones: 8 }
];

/**
 * Paircoil, sold in 20 m rolls. The per-metre rate is what the BOM uses.
 * Repriced from MMEM quotation 447-321514-000 (10/09/2026), which supersedes
 * the January 2026 trade list for these lines.
 */
export const MMEM_COPPER = [
  { code: 'AIRBTT1438', size: '1/4 – 3/8', rollM: 20, rollCost: 199.00 },
  { code: 'AIRBTT1412', size: '1/4 – 1/2', rollM: 20, rollCost: 232.00 },
  { code: 'AIRBTT1458', size: '1/4 – 5/8', rollM: 20, rollCost: 291.00 },
  { code: 'AIRBTT3858', size: '3/8 – 5/8', rollM: 20, rollCost: 342.00 },
  { code: 'MMABTT3834', size: '3/8 – 3/4', rollM: 20, rollCost: 400.00 }
];

/** Residential ducted normally runs 3/8 – 5/8, so that is the default rate. */
export const DEFAULT_PAIRCOIL_CODE = 'AIRBTT3858';

export function paircoilRatePerM(code = DEFAULT_PAIRCOIL_CODE) {
  const c = MMEM_COPPER.find(x => x.code === code) || MMEM_COPPER[MMEM_COPPER.length - 1];
  return Math.round((c.rollCost / c.rollM) * 100) / 100;
}


// ── Accessories ─────────────────────────────────────────────────────────────
//
// Source: MMEM Electrical Maroochydore quotation 447-321514-000, 10/09/2026,
// valid to 09/11/2026, NAC account 201169 (salesperson peterl). Ex GST.
// These supersede the accessory rates carried in the January 2026 trade list.
//
// `cost` is the quoted unit price. Where an item is sold as a length or roll,
// `packM` records what one unit contains so the BOM can buy whole units instead
// of pretending duct is cut to the metre.

export const MMEM_ACCESSORIES_META = {
  source: 'MMEM Electrical Maroochydore',
  quoteNo: '447-321514-000',
  date: '2026-09-10',
  validTo: '2026-11-09',
  account: '201169',
  salesperson: 'peterl',
  basis: 'ex GST',
  note: 'Quoted accessory pricing. Re-quote after 09/11/2026.'
};

export const MMEM_ACCESSORIES = [
  // Plenums and return air
  { code: 'MMAP3SSP3',         group: 'plenum',     desc: 'Supply air plenum 3X',                     cost: 139.00, outlets: 3 },
  { code: 'MMAP3SSP2',         group: 'plenum',     desc: 'Supply air plenum 2X',                     cost: 110.00, outlets: 2 },
  { code: 'MMAP3SRP',          group: 'plenum',     desc: 'P3 special return plenum',                 cost: 105.00 },
  { code: 'MMARAG800600',      group: 'return',     desc: 'Return air grille and filter 800 x 600',   cost: 81.30, includesFilter: true },
  { code: 'MMARAB8006002X400', group: 'return',     desc: 'Return air box 800 x 600 — 2 x 400',       cost: 85.00 },

  // Flexible duct — R1.0, sold in 6 m lengths
  { code: 'MMA4006',           group: 'flex',       desc: 'Flex duct 400 mm x 6 m R1.0',              cost: 50.00, diameterMm: 400, packM: 6 },
  { code: 'MMA3506',           group: 'flex',       desc: 'Flex duct 350 mm x 6 m R1.0',              cost: 45.00, diameterMm: 350, packM: 6 },
  { code: 'MMA3006',           group: 'flex',       desc: 'Flex duct 300 mm x 6 m R1.0',              cost: 38.00, diameterMm: 300, packM: 6 },
  { code: 'MMA2506',           group: 'flex',       desc: 'Flex duct 250 mm x 6 m R1.0',              cost: 32.00, diameterMm: 250, packM: 6 },
  { code: 'MMA2006',           group: 'flex',       desc: 'Flex duct 200 mm x 6 m R1.0',              cost: 30.00, diameterMm: 200, packM: 6 },

  // Outlets
  { code: 'MMARD300',          group: 'diffuser',   desc: 'Round insulated diffuser 300 mm',          cost: 25.00, diameterMm: 300 },
  { code: 'MMARD250',          group: 'diffuser',   desc: 'Round insulated diffuser 250 mm',          cost: 23.50, diameterMm: 250 },

  // Butterfly take-offs. The letter/number is MMEM's own size code; it is NOT
  // resolved to a duct diameter here because the quote does not state one.
  { code: 'MMADB8',            group: 'takeoff',    desc: 'DB8 double butterfly take-off',            cost: 75.00, sizeCode: 'DB8', double: true },
  { code: 'MMADB6',            group: 'takeoff',    desc: 'DB6 double butterfly take-off',            cost: 55.00, sizeCode: 'DB6', double: true },
  { code: 'MMAB11',            group: 'takeoff',    desc: 'B11 butterfly take-off',                   cost: 65.00, sizeCode: 'B11' },
  { code: 'MMAB9',             group: 'takeoff',    desc: 'B9 butterfly take-off',                    cost: 50.00, sizeCode: 'B9' },
  { code: 'MMAB8',             group: 'takeoff',    desc: 'B8 butterfly take-off',                    cost: 40.00, sizeCode: 'B8' },

  // Y-pieces. Same caveat — MMEM's size code is carried verbatim.
  { code: 'MMADY18',           group: 'y_piece',    desc: 'DY18 Y-piece (Y6)',                        cost: 55.00, sizeCode: 'Y6' },
  { code: 'MMADY16',           group: 'y_piece',    desc: 'DY16 Y-piece (Y5)',                        cost: 50.00, sizeCode: 'Y5' },
  { code: 'MMADY14',           group: 'y_piece',    desc: 'DY14 Y-piece (Y4)',                        cost: 40.00, sizeCode: 'Y4' },
  { code: 'MMADY12',           group: 'y_piece',    desc: 'DY12 Y-piece (Y3)',                        cost: 35.00, sizeCode: 'Y3' },

  // Zone motors — 24 V, by damper diameter
  { code: 'MMADZ400',          group: 'zone_motor', desc: 'Zone motor 400 mm 24 V',                   cost: 65.00, diameterMm: 400 },
  { code: 'MMADZ350',          group: 'zone_motor', desc: 'Zone motor 350 mm 24 V',                   cost: 60.00, diameterMm: 350 },
  { code: 'MMADZ300',          group: 'zone_motor', desc: 'Zone motor 300 mm 24 V',                   cost: 55.00, diameterMm: 300 },
  { code: 'MMADZ250',          group: 'zone_motor', desc: 'Zone motor 250 mm 24 V',                   cost: 51.00, diameterMm: 250 },
  { code: 'MMADZ200',          group: 'zone_motor', desc: 'Zone motor 200 mm 24 V',                   cost: 45.00, diameterMm: 200 },

  // Zone wiring — 15 m per lead
  { code: 'MMADZ15',           group: 'zone_cable', desc: 'Zone Innocab 15 m cable (black)',          cost: 15.80, packM: 15 },
  { code: 'MMADZST15',         group: 'zone_cable', desc: 'Zone Innocab 15 m straight-through (blue)', cost: 15.80, packM: 15 },

  // Condensate drain
  { code: 'MMAPP20',           group: 'drain',      desc: '20 mm rigid drain pressure pipe 3.9 m',    cost: 7.50, packM: 3.9 },
  { code: 'MMAPPELB9020',      group: 'drain',      desc: '20 mm 90° elbow',                          cost: 0.78 },
  { code: 'MMAPI1',            group: 'drain',      desc: 'Pipe insulation 1" (25 x 10)',             cost: 5.50 },

  // Consumables
  { code: 'MMABTN',            group: 'consumable', desc: 'Nitto black tape 48 mm x 30 m',            cost: 3.95 }
];

const ACCESSORY_BY_CODE = new Map(MMEM_ACCESSORIES.map(a => [a.code, a]));

/** One accessory line, or null. Codes are matched exactly as MMEM print them. */
export function findAccessory(code) {
  return ACCESSORY_BY_CODE.get(code) || null;
}

/** Every accessory in a group, e.g. 'flex' or 'zone_motor'. */
export function accessoriesInGroup(group) {
  return MMEM_ACCESSORIES.filter(a => a.group === group);
}

/**
 * Accessories in a group keyed by nominal diameter — the shape the material
 * catalogue wants for anything sized by duct diameter.
 */
export function accessoriesByDiameter(group) {
  const out = {};
  for (const a of accessoriesInGroup(group)) {
    if (a.diameterMm) out[a.diameterMm] = a;
  }
  return out;
}

/** Cost per metre of an item sold by the length or roll. */
export function ratePerM(code) {
  const a = findAccessory(code);
  if (!a || !a.packM) return null;
  return Math.round((a.cost / a.packM) * 100) / 100;
}

// ── Matching ────────────────────────────────────────────────────────────────

/** Strip a code to comparable characters. */
export function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The indoor half of a "INDOOR / OUTDOOR" pair. */
export function indoorCode(code) {
  return String(code || '').split(/\s+\/\s+/)[0].trim();
}

/**
 * Does a catalogue model name refer to the same unit as an MMEM line?
 * Catalogue names may carry a trailing " — Slimline" style description, and
 * MMEM codes may carry regional suffixes (".TH", "/SA"), so the comparison is
 * a prefix match in whichever direction is longer.
 */
export function codesMatch(catalogueName, mmemCode) {
  const a = normaliseCode(String(catalogueName).split('—')[0]);
  const b = normaliseCode(indoorCode(mmemCode));
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** Find the MMEM line for a catalogue model, matching code then kW and phase. */
export function findSupplierLine(brandId, modelName, kw, phase) {
  const onBrand = MMEM_DUCTED.filter(m => m.brandId === brandId);
  const byCode = onBrand.filter(m => codesMatch(modelName, m.code));
  if (byCode.length === 1) return byCode[0];
  if (byCode.length > 1) {
    // Several regional variants share a code — separate them on phase, then kW.
    const byPhase = byCode.filter(m => !phase || m.phase === phase);
    const pool = byPhase.length ? byPhase : byCode;
    return pool.reduce((best, m) =>
      Math.abs(m.kw - kw) < Math.abs(best.kw - kw) ? m : best);
  }
  return null;
}
