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
  { id: 'mh', name: 'Mitsubishi Heavy', url: 'https://www.mhiaa.com.au/products/residential/ducted-air-conditioners', models: [
    { id: 'mh1',  name: 'FDU71AVNXWVH — Slimline',      kw: 7.1,  phase: '1Ph' },
    { id: 'mh2',  name: 'FDU100AVNXWVH — Slimline',     kw: 10.0, phase: '1Ph' },
    { id: 'mh3',  name: 'FDU125AVNXWVH — Slimline',     kw: 12.5, phase: '1Ph' },
    { id: 'mh4',  name: 'FDU140AVNXWVH — Slimline',     kw: 14.0, phase: '1Ph' },
    { id: 'mh5',  name: 'FDUA100AVNAWVH — High Static', kw: 10.0, phase: '1Ph' },
    { id: 'mh6',  name: 'FDUA125AVNXWVH — High Static', kw: 12.5, phase: '1Ph' },
    { id: 'mh7',  name: 'FDUA140AVNXWVH — High Static', kw: 14.0, phase: '1Ph' },
    { id: 'mh8',  name: 'FDUA160AVNXWVH — High Static', kw: 16.0, phase: '1Ph' },
    { id: 'mh9',  name: 'FDUA160AVSAWVH — High Static 3Ph', kw: 16.0, phase: '3Ph' },
    { id: 'mh10', name: 'FDUA200AVSAWVH — High Static 3Ph', kw: 20.0, phase: '3Ph' }
  ]},
  { id: 'midea', name: 'Midea', url: 'https://midea.polyaire.com.au/ducted-air-conditioning/', models: [
    { id: 'mi1', name: 'DUCMI70IB / UCMI70OB',    kw: 7.1,  phase: '1Ph' },
    { id: 'mi2', name: 'DUCMI90IB / UCMI90OB',    kw: 10.5, phase: '1Ph' },
    { id: 'mi3', name: 'DUCMI105IHB / UCMI105OB', kw: 10.0, phase: '1Ph' },
    { id: 'mi4', name: 'DUCMI125IHB / UCMI125OB', kw: 12.0, phase: '1Ph' },
    { id: 'mi5', name: 'DUCMI140IHB / UCMI140OB', kw: 14.0, phase: '1Ph' },
    { id: 'mi6', name: 'DUCMI170IHB / UCMI170OB', kw: 17.0, phase: '1Ph' }
  ]},
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
  { id: 'braemar', name: 'Braemar', url: 'https://www.braemar.com.au/products/cooling/ducted-reverse-cycle-air-conditioning', models: [
    { id: 'br1', name: 'KDHA070 — Ducted RC',     kw: 7.0,  phase: '1Ph' },
    { id: 'br2', name: 'KDHA100 — Ducted RC',     kw: 10.0, phase: '1Ph' },
    { id: 'br3', name: 'KDHA120 — Ducted RC',     kw: 12.0, phase: '1Ph' },
    { id: 'br4', name: 'KDHA140 — Ducted RC',     kw: 14.0, phase: '1Ph' },
    { id: 'br5', name: 'KDHA160 — Ducted RC',     kw: 16.0, phase: '1Ph' },
    { id: 'br6', name: 'SDHV200 — Ducted RC 3Ph', kw: 20.0, phase: '3Ph' },
    { id: 'br7', name: 'Dominator S2 KGHV120',    kw: 12.2, phase: '1Ph' },
    { id: 'br8', name: 'Dominator S2 KGHV160',    kw: 16.0, phase: '1Ph' }
  ]}
];

/** Zone controllers NAC supplies — mirrors the existing CONTROLLERS constant. */
export const ZONE_CONTROLLERS = [
  { id: 'std', name: 'Brand Standard Controller', maxZones: 8,  brandLock: null,
    note: 'Manufacturer’s own zone controller supplied with the system.' },
  { id: 'at5', name: 'Airtouch 5',                maxZones: 16, brandLock: null,
    note: 'Polyaire Airtouch 5 — supports individual temperature sensors per zone.' },
  { id: 'daikin_zone', name: 'Daikin Zone Controller', maxZones: 8, brandLock: 'daikin',
    note: 'Daikin-branded zoning, Daikin systems only.' }
];

/**
 * Fields that must come from the manufacturer. Anything not present in NAC's
 * spec store is reported as SPECIFICATION DATA REQUIRED — never guessed.
 */
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
export function buildCatalogue({ savedBrands = null, specStore = null, base = DUCTED_CATALOGUE } = {}) {
  return base.map(brand => {
    const saved = (savedBrands || []).find(b => b.id === brand.id || b.name === brand.name);
    return {
      ...brand,
      models: brand.models.map(model => {
        const savedModel = saved?.models?.find(m => m.id === model.id || m.name === model.name);
        const sellPrice = savedModel && savedModel.price !== '' && savedModel.price !== undefined && savedModel.price !== null
          ? Number(savedModel.price) : null;
        const specKey = brand.id + ':' + model.id;
        const specs = (specStore && (specStore[specKey] || specStore[model.name])) || {};
        const missing = REQUIRED_SPEC_FIELDS.filter(f => specs[f] === undefined || specs[f] === null || specs[f] === '');
        return {
          ...model,
          brandId: brand.id,
          brandName: brand.name,
          specKey,
          // Commercial — straight from the existing NAC price record.
          sellPrice,                                    // installed price inc GST, as NAC already stores it
          supplierCost: savedModel?.cost !== undefined && savedModel?.cost !== '' && savedModel?.cost !== null
            ? Number(savedModel.cost) : null,
          hasPrice: sellPrice !== null && isFinite(sellPrice) && sellPrice > 0,
          // Engineering — only what NAC has actually entered.
          specs,
          missingSpecs: missing,
          specStatus: missing.length === 0 ? 'complete'
            : missing.length === REQUIRED_SPEC_FIELDS.length ? 'none' : 'partial',
          specNotice: missing.length ? SPEC_REQUIRED + ': ' + missing.join(', ') : null
        };
      })
    };
  });
}

export function allModels(catalogue) {
  return catalogue.flatMap(b => b.models);
}

export function findModel(catalogue, brandId, modelId) {
  const b = catalogue.find(x => x.id === brandId);
  return b ? b.models.find(m => m.id === modelId) || null : null;
}
