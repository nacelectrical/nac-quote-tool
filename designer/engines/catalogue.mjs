// NAC AI HVAC DESIGNER — PART 13: equipment catalogue.
//
// The catalogue here is the SAME ducted range the existing NAC quote tool
// carries (nac-quote-tool-v2.jsx BRANDS / admin.html brands). It is not a
// second product database: prices come from the existing `nac_brands_v4`
// settings record, and the designer writes nothing back to it.
//
// Manufacturer engineering data (rated airflow, available external static
// pressure, physical dimensions, electrical, refrigerant) is NOT invented here.
// Where NAC has not entered it, the model reports SPECIFICATION DATA REQUIRED
// and the engines refuse to rely on it.

import { MMEM_DUCTED, MMEM_ZONE_CONTROLS, MMEM_META, findSupplierLine, indoorCode } from './supplier-pricing.mjs';
import { findUnitSpec, UNIT_SPEC_META } from './unit-specs.mjs';

export const SPEC_REQUIRED = 'SPECIFICATION DATA REQUIRED';

/** The ducted range, mirroring the existing tool's BRANDS constant. */
export const DUCTED_CATALOGUE = [
  { id: 'daikin', name: 'Daikin', url: 'https://www.daikin.com.au/products/residential/ducted-system-air-conditioning', models: [
    { id: 'd1',  name: 'FDYQN50LCV1',  kw: 5.0,  phase: '1Ph' },
    { id: 'd2',  name: 'FDYQN71LCV1',  kw: 7.1,  phase: '1Ph' },
    { id: 'd3',  name: 'FDYQN85LCV1',  kw: 8.5,  phase: '1Ph' },
    { id: 'd4',  name: 'FDYQN100LCV1', kw: 10.0, phase: '1Ph' },
    { id: 'd5',  name: 'FDYQN125LCV1', kw: 12.5, phase: '1Ph' },
    { id: 'd6',  name: 'FDYQN140LCV1', kw: 14.0, phase: '1Ph' },
    { id: 'd7',  name: 'FDYQN155LCV1', kw: 15.5, phase: '1Ph' },
    { id: 'd8',  name: 'FDYA180AV1',   kw: 18.0, phase: '3Ph' },
    { id: 'd9',  name: 'FDYA200AV1',   kw: 20.0, phase: '3Ph' },
    { id: 'd10', name: 'FDYQN71LBV1',  kw: 7.1,  phase: '1Ph' },
    { id: 'd11', name: 'FDYQN100LBV1', kw: 10.0, phase: '1Ph' },
    { id: 'd12', name: 'FDYQN125LBV1', kw: 12.5, phase: '1Ph' },
    { id: 'd13', name: 'FDYQN140LBV1', kw: 14.0, phase: '1Ph' },
    { id: 'd14', name: 'FDYQN155LBV1', kw: 15.5, phase: '1Ph' },
    { id: 'd15', name: 'FDYQN180LBV1', kw: 18.0, phase: '1Ph' }
  ]},
  { id: 'fujitsu', name: 'Fujitsu', url: 'https://www.fujitsugeneral.com.au/residential-products/whole-home-solutions', models: [
    { id: 'f1',  name: 'ARTG22LDTA', kw: 6.0,  phase: '1Ph' },
    { id: 'f2',  name: 'ARTG30LDTA', kw: 8.0,  phase: '1Ph' },
    { id: 'f3',  name: 'ARTG36LDTA', kw: 10.0, phase: '1Ph' },
    { id: 'f4',  name: 'ARTG45LDTA', kw: 11.5, phase: '1Ph' },
    { id: 'f5',  name: 'ARTG54LDTA', kw: 14.0, phase: '1Ph' },
    { id: 'f6',  name: 'ARTG60LDTA', kw: 16.0, phase: '1Ph' },
    { id: 'f7',  name: 'ARTG90LDTA', kw: 22.0, phase: '3Ph' },
    { id: 'f8',  name: 'ARTH36KHTA', kw: 10.0, phase: '1Ph' },
    { id: 'f9',  name: 'ARTH45KHTA', kw: 11.5, phase: '1Ph' },
    { id: 'f10', name: 'ARTH54KHTA', kw: 14.0, phase: '1Ph' },
    { id: 'f11', name: 'ARTH60KHTB', kw: 16.0, phase: '1Ph' },
    { id: 'f12', name: 'ARTH72KHTA', kw: 18.0, phase: '1Ph' },
    { id: 'f13', name: 'ARTG90LHTC', kw: 18.0, phase: '3Ph' }
  ]},
  { id: 'me', name: 'Mitsubishi Electric', url: 'https://www.mitsubishielectric.com.au/products/air-conditioning/residential/ducted/', models: [
    { id: 'me1',  name: 'PEAD-M50JAA — Low Profile',  kw: 5.0,  phase: '1Ph' },
    { id: 'me2',  name: 'PEAD-M71JAA — Low Profile',  kw: 7.1,  phase: '1Ph' },
    { id: 'me3',  name: 'PEAD-M100JAA — Low Profile', kw: 10.0, phase: '1Ph' },
    { id: 'me4',  name: 'PEAD-M125JAA — Low Profile', kw: 12.5, phase: '1Ph' },
    { id: 'me5',  name: 'PEAD-M140JAA — Low Profile', kw: 14.0, phase: '1Ph' },
    { id: 'me6',  name: 'PEA-M100GAA', kw: 10.0, phase: '1Ph' },
    { id: 'me7',  name: 'PEA-M125GAA', kw: 12.5, phase: '1Ph' },
    { id: 'me8',  name: 'PEA-M140GAA', kw: 14.0, phase: '1Ph' },
    { id: 'me9',  name: 'PEA-M160GAA', kw: 16.0, phase: '1/3Ph' },
    { id: 'me10', name: 'PEA-M100HAA', kw: 10.0, phase: '1Ph' },
    { id: 'me11', name: 'PEA-M125HAA', kw: 12.5, phase: '1Ph' },
    { id: 'me12', name: 'PEA-M140HAA', kw: 14.0, phase: '1Ph' },
    { id: 'me13', name: 'PEA-M180LAA', kw: 18.0, phase: '3Ph' },
    { id: 'me14', name: 'PEA-M200LAA', kw: 20.0, phase: '3Ph' }
  ]},
  // Mitsubishi Heavy and Midea were removed at NAC's instruction: NAC do not
  // sell them. MMEM had quoted no price for a single model of either, so all
  // 16 were unquotable anyway — a brand that cannot be costed has no business
  // being selectable. Nick will add the brands he does want when he has trade
  // prices for them. To bring one back, restore its block here and add its
  // lines to MMEM_DUCTED in supplier-pricing.mjs.
  { id: 'samsung', name: 'Samsung', url: 'https://www.samsung.com/au/air-conditioners/ducted-air-conditioners/', models: [
    { id: 's1', name: 'AC052TNHDKG — Duct S2',  kw: 5.2,  phase: '1Ph' },
    { id: 's2', name: 'AC071TNHDKG — Duct S2',  kw: 7.1,  phase: '1Ph' },
    { id: 's3', name: 'AC090TNHDKG — Duct S2',  kw: 8.5,  phase: '1Ph' },
    { id: 's4', name: 'AC120TNHDKG — Duct S2',  kw: 12.0, phase: '1Ph' },
    { id: 's5', name: 'AC140TNHDKG — Duct S2',  kw: 14.0, phase: '1Ph' },
    { id: 's6', name: 'AC100TNHPKG — Duct S2+', kw: 10.0, phase: '1Ph' },
    { id: 's7', name: 'AC120TNHPKG — Duct S2+', kw: 12.5, phase: '1Ph' },
    { id: 's8', name: 'AC140TNHPKG — Duct S2+', kw: 14.0, phase: '1Ph' },
    { id: 's9', name: 'AC160TNHPKG — Duct S2+', kw: 16.0, phase: '1Ph' }
  ]},
  // Braemar ducted, the whole range NAC can quote. Seeley International sell it
  // as three families and the sizes below are the sizes that exist — 7 kW is
  // the smallest ducted unit Braemar make, and three phase starts at 20 kW.
  //   KDHV  R32 inverter, single phase, indoor KDHV…D1S / outdoor KCHV…D1B.
  //         This is the family MMEM stock (see MMEM_DUCTED), so these are the
  //         only Braemar models that come out of the box with a cost on file.
  //   SDHV  R410A inverter, indoor SDHV…D1S / outdoor SCHV…D1S (D3S on three
  //         phase). Still supported and still installed, so still quotable.
  //   KGHV  Dominator Series 2 — one size, and it is rated on HEATING (20 kW),
  //         which is why the model number says 200 and the cooling figure is
  //         12.2 kW. `kw` here stays cooling, as it is for every other model.
  // The kW figures are Braemar's published rated cooling capacities. They are
  // model identity, not engineering data: no airflow, static pressure or
  // electrical figure is asserted for Braemar anywhere, so the engines still
  // report SPECIFICATION DATA REQUIRED until NAC load the data sheets.
  { id: 'braemar', name: 'Braemar', url: 'https://www.braemar.com.au/products/cooling/ducted-reverse-cycle-air-conditioning', models: [
    { id: 'br1',  name: 'KDHV070D1S — Ducted Inverter R32', kw: 7.1,  phase: '1Ph' },
    { id: 'br2',  name: 'KDHV100D1S — Ducted Inverter R32', kw: 10.0, phase: '1Ph' },
    { id: 'br3',  name: 'KDHV125D1S — Ducted Inverter R32', kw: 12.4, phase: '1Ph' },
    { id: 'br4',  name: 'KDHV140D1S — Ducted Inverter R32', kw: 13.5, phase: '1Ph' },
    { id: 'br5',  name: 'KDHV160D1S — Ducted Inverter R32', kw: 16.3, phase: '1Ph' },
    { id: 'br9',  name: 'SDHV07D1S — Ducted Inverter',      kw: 7.0,  phase: '1Ph' },
    { id: 'br10', name: 'SDHV10D1S — Ducted Inverter',      kw: 10.0, phase: '1Ph' },
    { id: 'br11', name: 'SDHV12D1S — Ducted Inverter',      kw: 12.0, phase: '1Ph' },
    { id: 'br12', name: 'SDHV14D1S — Ducted Inverter',      kw: 14.0, phase: '1Ph' },
    { id: 'br13', name: 'SDHV16D1S — Ducted Inverter',      kw: 16.0, phase: '1Ph' },
    { id: 'br6',  name: 'SDHV20D3S — Ducted Inverter 3Ph',  kw: 20.0, phase: '3Ph' },
    { id: 'br14', name: 'SDHV24D3S — Ducted Inverter 3Ph',  kw: 24.0, phase: '3Ph' },
    { id: 'br7',  name: 'KGHV200A1S — Dominator Series 2',  kw: 12.2, phase: '1Ph' }
  ]},
  // Gree and Panasonic are on NAC's MMEM account but were never in the quote
  // tool's list. Their models come in from the supplier price list below.
  { id: 'gree', name: 'Gree', url: 'https://www.gree.com.au/ducted', models: [] },
  { id: 'panasonic', name: 'Panasonic', url: 'https://www.panasonic.com/au/consumer/air-conditioners.html', models: [] }
];

/**
 * Zone controllers NAC can actually buy, with what they cost, from the MMEM
 * price list. The two generic entries the existing quote tool used are kept at
 * the top so a quote raised the old way still resolves.
 */
export const ZONE_CONTROLLERS = [
  // Supplied WITH the system, so it adds nothing to the job cost. That is not
  // a price anyone invented — it is the manufacturer's own controller in the
  // box, and carrying it as "no price on file" made it read as a hole in the
  // costing and blocked quotes that used it.
  { id: 'std', name: 'Brand Standard Controller', maxZones: 8, brandLock: null, cost: 0,
    includedInSystem: true,
    note: 'Manufacturer’s own zone controller, supplied with the system — no separate charge.' },

  // The generic 'Airtouch 5' row carried no price and shadowed the real thing.
  // NAC buy the AirTouch as a KIT (MMEM MMAAT5DK, $1100 ex GST) and the
  // controller is part of that price, so the kit below is the only AirTouch
  // entry there should be. Removing the duplicate also means no zone
  // controller in the catalogue is left without a cost.

  ...MMEM_ZONE_CONTROLS
    .filter(c => !c.perZoneAccessory)
    .map(c => ({
      id: c.id, name: c.name, maxZones: c.maxZones, brandLock: c.brandLock || null,
      cost: c.cost, supplierCode: c.code,
      note: 'MMEM ' + c.code + ' — $' + c.cost.toFixed(2) + ' ex GST (' + MMEM_META.edition + ').'
    }))
];

/** Per-zone accessories, e.g. an Airtouch sensor in each zone. */
export const ZONE_ACCESSORIES = MMEM_ZONE_CONTROLS.filter(c => c.perZoneAccessory);

/**
 * Fields that must come from the manufacturer. Anything not present in NAC's
 * spec store is reported as SPECIFICATION DATA REQUIRED — never guessed.
 */
/** Commercial fields held alongside the specs — not manufacturer data. */
export const COMMERCIAL_SPEC_FIELDS = ['supplierCost'];

/**
 * Fill in the specs the manufacturer publishes, where NAC has not typed them.
 *
 * Order of authority: a value NAC entered by hand always wins — they may be
 * looking at the data sheet in front of them. Below that come the transcribed
 * manufacturer tech sheets. Anything neither source carries stays missing and
 * is reported as SPECIFICATION DATA REQUIRED; nothing is estimated.
 */
function withManufacturerSpecs(brandId, modelName, entered) {
  const sheet = findUnitSpec(brandId, modelName);
  if (!sheet) return { specs: entered, specSource: entered && Object.keys(entered).length ? 'nac_entered' : null, sheet: null };

  const fromSheet = {};
  if (sheet.ratedAirflowLs !== null) fromSheet.ratedAirflowLs = sheet.ratedAirflowLs;
  if (sheet.availableStaticPa !== null) fromSheet.availableStaticPa = sheet.availableStaticPa;
  if (sheet.phase) fromSheet.electricalSupply = sheet.phase;
  if (sheet.refrigerant) fromSheet.refrigerant = sheet.refrigerant;

  const merged = { ...fromSheet };
  // Anything NAC actually entered overrides the sheet.
  for (const [k, v] of Object.entries(entered || {})) {
    if (v !== undefined && v !== null && v !== '') merged[k] = v;
  }
  const usedSheet = Object.keys(fromSheet).some(k => merged[k] === fromSheet[k] &&
    (entered?.[k] === undefined || entered?.[k] === null || entered?.[k] === ''));
  return {
    specs: merged,
    specSource: usedSheet ? UNIT_SPEC_META.source : (Object.keys(entered || {}).length ? 'nac_entered' : null),
    sheet
  };
}

export const REQUIRED_SPEC_FIELDS = [
  'ratedAirflowLs',
  'availableStaticPa',
  'indoorWidthMm', 'indoorHeightMm', 'indoorDepthMm',
  'electricalSupply', 'runningCurrentA',
  'refrigerant',
  'heatingKw'
];

/**
 * Merge NAC's saved prices (from nac_settings `nac_brands_v4`, the exact record
 * the existing quote tool writes) and NAC's saved manufacturer specs into the
 * catalogue. Neither store is modified.
 *
 * @param {Array} savedBrands  parsed `nac_brands_v4` value, or null
 * @param {Object} specStore   parsed `nac_hvac_equipment_specs` value, or null
 *                             shape: { "<brandId>:<modelId>": { ...specs } }
 */
export function buildCatalogue({ savedBrands = null, specStore = null, base = DUCTED_CATALOGUE,
                                 supplierLines = MMEM_DUCTED } = {}) {
  const usedSupplierCodes = new Set();

  const merged = base.map(brand => {
    const saved = (savedBrands || []).find(b => b.id === brand.id || b.name === brand.name);
    return {
      ...brand,
      models: brand.models.map(model => {
        const savedModel = saved?.models?.find(m => m.id === model.id || m.name === model.name);
        const sellPrice = savedModel && savedModel.price !== '' && savedModel.price !== undefined && savedModel.price !== null
          ? Number(savedModel.price) : null;
        const specKey = brand.id + ':' + model.id;
        const entered = (specStore && (specStore[specKey] || specStore[model.name])) || {};
        // The manufacturer's own published figures stand behind whatever NAC
        // has typed, so a data sheet NAC already owns is not reported missing.
        const { specs, specSource, sheet } = withManufacturerSpecs(brand.id, model.name, entered);
        // What NAC pays, from the supplier price list, when the model is one
        // MMEM still sell.
        const supplier = findSupplierLine(brand.id, model.name, model.kw, model.phase);
        if (supplier) usedSupplierCodes.add(supplier.code);
        const missing = REQUIRED_SPEC_FIELDS.filter(f => specs[f] === undefined || specs[f] === null || specs[f] === '');
        return {
          ...model,
          brandId: brand.id,
          brandName: brand.name,
          specKey,
          // Commercial — straight from the existing NAC price record.
          sellPrice,                                    // installed price inc GST, as NAC already stores it
          // What the unit costs NAC, in order of authority: a cost typed into
          // Price Setup, then one entered in the designer, then the supplier
          // price list.
          supplierCost: savedModel?.cost !== undefined && savedModel?.cost !== '' && savedModel?.cost !== null
            ? Number(savedModel.cost)
            : (specs.supplierCost !== undefined && specs.supplierCost !== null && specs.supplierCost !== ''
                ? Number(specs.supplierCost)
                : (supplier ? supplier.cost : null)),
          supplierCode: supplier ? supplier.code : null,
          supplierSource: savedModel?.cost ? 'price_setup'
            : specs.supplierCost ? 'nac_entered'
            : supplier ? MMEM_META.source + ' ' + MMEM_META.edition : null,
          hasPrice: sellPrice !== null && isFinite(sellPrice) && sellPrice > 0,
          // Engineering — what NAC entered, backed by the manufacturer sheets.
          specs,
          specSource,
          returnSpigots: sheet?.returnSpigots || null,
          returnFlangeText: sheet?.returnFlangeText || null,
      supplyFlangeText: sheet?.supplyFlangeText || null,
          missingSpecs: missing,
          specStatus: missing.length === 0 ? 'complete'
            : missing.length === REQUIRED_SPEC_FIELDS.length ? 'none' : 'partial',
          specNotice: missing.length ? SPEC_REQUIRED + ': ' + missing.join(', ') : null
        };
      })
    };
  });

  // Anything MMEM sell that the quote tool's list never had — the current
  // Daikin range, Gree and Panasonic — is appended so it can be selected and
  // costed. These carry the supplier's own code as their name.
  for (const line of supplierLines) {
    if (usedSupplierCodes.has(line.code)) continue;
    const brand = merged.find(b => b.id === line.brandId);
    if (!brand) continue;
    const id = 'mmem_' + line.code.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
    const specKey = brand.id + ':' + id;
    const entered = (specStore && specStore[specKey]) || {};
    const { specs, specSource, sheet } = withManufacturerSpecs(line.brandId, line.code, entered);
    const missing = REQUIRED_SPEC_FIELDS.filter(f => specs[f] === undefined || specs[f] === null || specs[f] === '');
    const savedModel = (savedBrands || []).find(b => b.id === brand.id)?.models
      ?.find(m => m.id === id || m.name === line.code);
    const sellPrice = savedModel && savedModel.price !== '' && savedModel.price !== undefined && savedModel.price !== null
      ? Number(savedModel.price) : null;

    brand.models.push({
      id,
      name: line.code,
      kw: line.kw,
      phase: line.phase,
      brandId: brand.id,
      brandName: brand.name,
      series: line.series,
      specKey,
      sellPrice,
      supplierCost: specs.supplierCost !== undefined && specs.supplierCost !== null && specs.supplierCost !== ''
        ? Number(specs.supplierCost) : line.cost,
      supplierCode: line.code,
      supplierSource: MMEM_META.source + ' ' + MMEM_META.edition,
      hasPrice: sellPrice !== null && isFinite(sellPrice) && sellPrice > 0,
      specs,
      specSource,
      returnSpigots: sheet?.returnSpigots || null,
      returnFlangeText: sheet?.returnFlangeText || null,
      supplyFlangeText: sheet?.supplyFlangeText || null,
      missingSpecs: missing,
      specStatus: missing.length === 0 ? 'complete' : missing.length === REQUIRED_SPEC_FIELDS.length ? 'none' : 'partial',
      specNotice: missing.length ? SPEC_REQUIRED + ': ' + missing.join(', ') : null,
      fromSupplierList: true
    });
  }

  // Drop brands that ended up with nothing in them.
  return merged.filter(b => b.models.length > 0);
}

/** Models the quote tool lists that MMEM no longer price — worth reviewing. */
export function modelsWithoutSupplierCost(catalogue) {
  return allModels(catalogue).filter(m => m.supplierCost === null)
    .map(m => ({ brand: m.brandName, model: m.name, kw: m.kw, phase: m.phase }));
}

export function allModels(catalogue) {
  return catalogue.flatMap(b => b.models);
}

export function findModel(catalogue, brandId, modelId) {
  const b = catalogue.find(x => x.id === brandId);
  return b ? b.models.find(m => m.id === modelId) || null : null;
}
