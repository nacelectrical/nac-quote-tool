// NAC AI HVAC DESIGNER — PART 13: equipment selection.
//
// Selection is deterministic and ranked. It never states a capability the
// manufacturer data does not support: where a spec is missing the candidate is
// still offered, but flagged SPECIFICATION DATA REQUIRED and excluded from any
// airflow / static-pressure check that would need it.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { allModels, SPEC_REQUIRED } from './catalogue.mjs';

/**
 * Rank candidate indoor/outdoor systems against the calculated design load.
 *
 * @param {Array}  catalogue     from buildCatalogue()
 * @param {Object} systemLoadRec from loads.systemLoad()
 * @param {Object} opts { settings, brandPreference, phase, requirePrice,
 *                        designAirflowLs, requiredStaticPa }
 */
export function selectEquipment(catalogue, systemLoadRec, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const E = settings.equipment;
  const designKw = Number(systemLoadRec.designKw);

  const candidates = allModels(catalogue)
    .filter(m => !opts.phase || m.phase.includes(opts.phase))
    .filter(m => !opts.requirePrice || m.hasPrice)
    .filter(m => !opts.requireCost || m.supplierCost !== null)
    .map(m => {
      const ratio = m.kw / designKw;
      const notes = [];
      const warnings = [];

      if (ratio < E.undersizeWarnRatio) warnings.push({ code: 'SYSTEM_UNDERSIZED', severity: 'WARNING',
        message: m.kw + ' kW is below the ' + round(designKw, 2) + ' kW design load.' });
      if (ratio > E.oversizeWarnRatio) warnings.push({ code: 'SYSTEM_SIGNIFICANTLY_OVERSIZED', severity: 'CHECK',
        message: m.kw + ' kW is ' + round((ratio - 1) * 100, 0) + '% above the design load — expect short cycling and poor humidity control.' });

      // Airflow compatibility, only when the manufacturer figure is on file.
      let airflowCheck = null;
      if (opts.designAirflowLs) {
        if (m.specs?.ratedAirflowLs) {
          const rated = Number(m.specs.ratedAirflowLs);
          const pct = opts.designAirflowLs / rated;
          airflowCheck = { ratedLs: rated, designLs: round(opts.designAirflowLs, 0), ratio: round(pct, 3) };
          if (pct > 1.0) warnings.push({ code: 'AIRFLOW_ABOVE_UNIT_RATING', severity: 'WARNING',
            message: 'Design airflow ' + round(opts.designAirflowLs, 0) + ' L/s exceeds the rated ' + rated + ' L/s.' });
          if (pct < 0.6) warnings.push({ code: 'AIRFLOW_BELOW_UNIT_RANGE', severity: 'CHECK',
            message: 'Design airflow is only ' + round(pct * 100, 0) + '% of the rated airflow.' });
        } else {
          warnings.push({ code: 'MISSING_MANUFACTURER_DATA', severity: 'CHECK',
            message: SPEC_REQUIRED + ' — rated airflow not on file, airflow compatibility not checked.' });
        }
      }

      // Static pressure headroom, only when ESP is on file.
      let staticCheck = null;
      if (opts.requiredStaticPa) {
        if (m.specs?.availableStaticPa) {
          const esp = Number(m.specs.availableStaticPa);
          staticCheck = { availablePa: esp, requiredPa: round(opts.requiredStaticPa, 0),
                          marginPa: round(esp - opts.requiredStaticPa, 0) };
          if (opts.requiredStaticPa > esp) warnings.push({ code: 'ESTIMATED_PRESSURE_EXCEEDS_UNIT_CAPABILITY', severity: 'CRITICAL',
            message: 'Estimated ' + round(opts.requiredStaticPa, 0) + ' Pa exceeds the ' + esp + ' Pa available external static.' });
          else if ((esp - opts.requiredStaticPa) / esp < settings.pressure.lowMarginFraction) {
            warnings.push({ code: 'STATIC_PRESSURE_MARGIN_LOW', severity: 'WARNING',
              message: 'Only ' + round(esp - opts.requiredStaticPa, 0) + ' Pa of static margin remains.' });
          }
        } else {
          warnings.push({ code: 'MISSING_MANUFACTURER_DATA', severity: 'CHECK',
            message: SPEC_REQUIRED + ' — available external static pressure not on file.' });
        }
      }

      if (m.specStatus !== 'complete') notes.push(m.specNotice);
      if (m.supplierCost === null) {
        notes.push('No supplier cost on file — this model cannot be costed until one is entered in ' +
          'HVAC Design Settings → Equipment specs.');
        warnings.push({ code: 'MISSING_SUPPLIER_COST', severity: 'WARNING',
          message: m.brandName + ' ' + m.name + ' has no supplier cost on file.' });
      }
      if (!m.hasPrice) notes.push('No NAC price configured for this model — set it in the existing Price Setup screen.');

      // Score: closeness to the ideal window, then commercial readiness.
      const ideal = (E.minCapacityRatio + E.maxCapacityRatio) / 2;
      let score = 100 - Math.abs(ratio - ideal) * 140;
      if (ratio < E.minCapacityRatio) score -= 45;
      if (ratio > E.maxCapacityRatio) score -= 30;
      if (opts.brandPreference && m.brandId === opts.brandPreference) score += 25;
      // A model with no cost cannot be costed or quoted, so it ranks below one
      // that can — whichever pricing basis is in use.
      if (m.supplierCost !== null) score += 22;
      if (m.hasPrice) score += 12;
      if (m.specStatus === 'complete') score += 8;
      warnings.forEach(w => { score -= w.severity === 'CRITICAL' ? 60 : w.severity === 'WARNING' ? 18 : 5; });

      return {
        brandId: m.brandId, brandName: m.brandName, modelId: m.id, model: m.name,
        capacityKw: m.kw, phase: m.phase,
        heatingKw: m.specs?.heatingKw ?? null,
        ratedAirflowLs: m.specs?.ratedAirflowLs ?? null,
        availableStaticPa: m.specs?.availableStaticPa ?? null,
        dimensionsMm: (m.specs?.indoorWidthMm && m.specs?.indoorHeightMm && m.specs?.indoorDepthMm)
          ? { w: m.specs.indoorWidthMm, h: m.specs.indoorHeightMm, d: m.specs.indoorDepthMm } : null,
        electricalSupply: m.specs?.electricalSupply ?? null,
        refrigerant: m.specs?.refrigerant ?? null,
        sellPrice: m.sellPrice, supplierCost: m.supplierCost, hasPrice: m.hasPrice,
        supplierCode: m.supplierCode ?? null, supplierSource: m.supplierSource ?? null,
        series: m.series ?? null,
        specStatus: m.specStatus, specNotice: m.specNotice,
        capacityRatio: round(ratio, 3),
        inWindow: ratio >= E.minCapacityRatio && ratio <= E.maxCapacityRatio,
        airflowCheck, staticCheck,
        warnings, notes,
        score: round(score, 1)
      };
    });

  candidates.sort((a, b) => b.score - a.score);

  const systemWarnings = [];
  if (designKw > E.maxSingleUnitKw) {
    systemWarnings.push({ code: 'CUSTOM_OR_DUAL_SYSTEM', severity: 'WARNING',
      message: 'Design load ' + round(designKw, 2) + ' kW exceeds ' + E.maxSingleUnitKw +
        ' kW — a dual-system or custom design is required. Confirm with the supplier.' });
  }
  if (!candidates.some(c => c.inWindow)) {
    systemWarnings.push({ code: 'NO_UNIT_IN_CAPACITY_WINDOW', severity: 'WARNING',
      message: 'No catalogued model falls between ' + E.minCapacityRatio + '× and ' + E.maxCapacityRatio +
        '× the design load.' });
  }

  return {
    designKw: round(designKw, 2),
    window: { minKw: round(designKw * E.minCapacityRatio, 2), maxKw: round(designKw * E.maxCapacityRatio, 2) },
    recommended: candidates.filter(c => c.inWindow).slice(0, 5),
    allCandidates: candidates,
    systemWarnings
  };
}

/**
 * Pick a zone controller that is compatible with the chosen system.
 *
 * Ranked so the estimator gets something that can actually be costed: a
 * controller with a supplier cost beats one without, then the cheapest that
 * fits, then the one with the least surplus zone capacity.
 */
export function selectZoneController(controllers, { brandId, zoneCount, preferId } = {}) {
  const compatible = (controllers || []).filter(c =>
    (!c.brandLock || c.brandLock === brandId) && (!zoneCount || (c.maxZones ?? 99) >= zoneCount));

  const ranked = [...compatible].sort((a, b) => {
    const aCost = a.cost !== null && a.cost !== undefined;
    const bCost = b.cost !== null && b.cost !== undefined;
    if (aCost !== bCost) return aCost ? -1 : 1;              // costed first
    if (aCost && a.cost !== b.cost) return a.cost - b.cost;  // then cheapest
    return (a.maxZones ?? 99) - (b.maxZones ?? 99);          // then tightest fit
  });

  const preferred = ranked.find(c => c.id === preferId);
  return {
    compatible: ranked,
    recommended: preferred || ranked[0] || null,
    incompatible: (controllers || []).filter(c => !compatible.includes(c)).map(c => ({
      ...c,
      reason: c.brandLock && c.brandLock !== brandId
        ? 'Locked to ' + c.brandLock + ' systems.'
        : 'Supports at most ' + c.maxZones + ' zones; this design has ' + zoneCount + '.'
    }))
  };
}
