// THE MOTORISED ZONE DAMPER, AS ONE COMPONENT.
//
// A zone damper is a motorised sleeve fitted INTO a supply duct. Its diameter
// is therefore not a choice — it is the diameter of the duct it is fitted in,
// and the moment those two disagree the drawing shows a fitting that will not
// go in the hole. Nick: "The motorised zone-damper diameter and connected
// supply-duct diameter must have one source of truth ... never leave a Ø250
// damper installed in a Ø300 duct."
//
// So the duct owns the size and the damper follows it. The installer edits the
// DUCT; the damper, its symbol, its schedule row, its SKU, its price, its
// velocity and the job total all move together. An installer who insists on a
// different damper size gets a blocking mismatch rather than a silent one.
//
// There is no manual balancing damper anywhere in this module, and there is no
// damper on a return duct. A damper on the return does not balance a room, it
// starves the fan coil.

import { resolveCost, PRICE_SOURCE } from './materials.mjs';
import { isReturnSection } from './bto.mjs';

/** The sizes NAC can fit a motor to. ø200 stays stocked for jobs that use it. */
export const DAMPER_DIAMETERS_MM = Object.freeze([200, 250, 300, 350, 400]);

/** One actuator family today; the field exists so the BOM can split on it. */
export const DEFAULT_ACTUATOR = '24 V';

const round = (n, dp = 2) => (n === null || n === undefined || !isFinite(n)) ? null
  : Math.round(n * 10 ** dp) / 10 ** dp;

/** m/s through a round duct, from L/s and mm. */
export function ductVelocityMs(airflowLs, diameterMm) {
  if (!airflowLs || !diameterMm) return null;
  const areaM2 = Math.PI * (diameterMm / 2000) ** 2;
  return round((airflowLs / 1000) / areaM2, 2);
}

/** `zone_damper_250_24v` — the exact thing being bought. */
export function damperSkuKey(diameterMm, actuator = DEFAULT_ACTUATOR) {
  return 'zone_damper_' + (diameterMm || 0) + '_' +
         String(actuator).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Enrich the router's placements into full components.
 *
 * `placements` are where the router decided a zone needs a motor. Everything
 * else — size, airflow, velocity, part number, price — is read from the duct
 * the damper sits in, so there is exactly one place the size can come from.
 */
/**
 * WHAT THE INSTALLER CHANGED ABOUT THE MOTORS, APPLIED TO THE ROUTER'S PLACES.
 *
 * The router decides where a zone needs a motor. On site the installer may move
 * one, delete one the job does not need, reassign which zone it drives, or add
 * one to a duct the router left alone. Those are recorded as overrides against
 * the damper's id and folded in HERE — before the component is built — so the
 * size, the SKU, the schedule row, the BOM line and the price still come from
 * the duct the damper ends up in, and nothing is sized twice.
 *
 * There is deliberately no "set damper diameter" here either. The duct owns the
 * size; change the duct.
 */
export function applyDamperPlacements(placements, overrides = {}, network = null) {
  const sections = new Map((network?.sections || []).map(s => [s.id, s]));
  const out = [];
  for (const p of (placements || [])) {
    const o = overrides[p.id] || overrides[p.sectionId] || null;
    if (o?.removed) continue;
    out.push(!o ? p : {
      ...p,
      x: o.x ?? p.x, y: o.y ?? p.y,
      moved: p.moved || (o.x !== undefined && o.x !== null),
      zone: o.zone || p.zone,
      zoneChangedOnSite: !!o.zone && o.zone !== p.zone
    });
  }
  // Motors added on site, on a supply duct the installer tapped.
  for (const [id, o] of Object.entries(overrides)) {
    if (!o?.added || o.removed) continue;
    if (out.some(p => p.id === id || p.sectionId === o.sectionId)) continue;
    const sec = o.sectionId ? sections.get(o.sectionId) : null;
    if (sec && isReturnSection(sec)) continue;     // never on the return, ever
    const mid = sec?.points?.length
      ? sec.points[Math.floor(sec.points.length / 2)] : null;
    out.push({
      id, sectionId: o.sectionId || null,
      zone: o.zone || sec?.zone || null,
      roomId: sec?.roomId ?? null,
      x: o.x ?? mid?.x ?? null, y: o.y ?? mid?.y ?? null,
      angle: o.angle ?? 0, moved: o.x !== undefined && o.x !== null,
      addedOnSite: true
    });
  }
  return out.map((p, i) => ({ ...p, motorNumber: i + 1 }));
}

export function buildZoneDampers(placements, network, { nacRates = null,
                                                        actuator = DEFAULT_ACTUATOR,
                                                        sizeOverrides = {} } = {}) {
  const sections = new Map((network?.sections || []).map(s => [s.id, s]));
  return (placements || []).map((p, i) => {
    const sec = p.sectionId ? sections.get(p.sectionId) : null;
    // A DAMPER IS NEVER ON THE RETURN. The router already filters the return
    // out; this says so again where the component is built, because a damper
    // that reached here on a return duct would be bought and installed.
    if (sec && isReturnSection(sec)) return null;

    const ductDiameterMm = sec?.diameterMm ?? p.diameterMm ?? null;
    // An installer may force a size. It is recorded, it is never silent, and
    // the mismatch is reported rather than absorbed.
    const override = sizeOverrides[p.id] ?? sizeOverrides[p.sectionId] ?? null;
    const diameterMm = override ?? ductDiameterMm;
    const mismatch = override !== null && ductDiameterMm !== null &&
                     override !== ductDiameterMm;

    const airflowLs = sec?.airflowLs ?? null;
    const rate = diameterMm ? resolveCost('zone_motor', { diameterMm, nacRates }) : null;

    return {
      id: p.id || ('damper_' + (p.sectionId || i + 1)),
      kind: 'zone_damper',
      airSide: 'supply',
      motorNumber: i + 1,
      zone: p.zone || null,
      roomId: p.roomId ?? null,
      sectionId: p.sectionId || null,
      sectionLabel: sec?.serves || sec?.label || p.sectionId || null,
      x: p.x ?? null,
      y: p.y ?? null,
      angle: p.angle ?? 0,
      moved: !!p.moved,
      addedOnSite: !!p.addedOnSite,
      zoneChangedOnSite: !!p.zoneChangedOnSite,

      // ── SIZE: THE DUCT'S, UNLESS SOMEBODY OVERRODE IT ON PURPOSE ────────
      ductDiameterMm,
      diameterMm,
      sizeLockedToDuct: override === null,
      sizeOverrideMm: override,
      sizeMismatch: mismatch,
      mismatchMessage: mismatch
        ? 'A ø' + override + ' damper is set in a ø' + ductDiameterMm + ' duct. ' +
          'Change the duct, or clear the override — a damper that does not match ' +
          'its duct cannot be installed.'
        : null,

      airflowLs: airflowLs === null ? null : round(airflowLs, 0),
      velocityMs: ductVelocityMs(airflowLs, diameterMm),
      actuator,
      skuKey: damperSkuKey(diameterMm, actuator),
      supplierCode: rate?.supplierCode || null,
      supplier: rate?.note ? 'MMEM Electrical Maroochydore' : null,
      supplierDescription: rate?.label || null,
      unitCost: rate?.cost ?? null,
      priceSource: rate?.source || null,
      effectiveDate: rate?.note ? (/(\d{4}-\d{2}-\d{2})/.exec(rate.note) || [])[1] || null : null,
      priceVerified: rate?.source === PRICE_SOURCE.SUPPLIER || rate?.source === PRICE_SOURCE.NAC,
      priceStatus: rate?.cost === null || rate?.cost === undefined ? 'PRICE REQUIRED'
        : (rate.source === PRICE_SOURCE.PLACEHOLDER ? 'PLACEHOLDER' : 'VERIFIED')
    };
  }).filter(Boolean);
}

/**
 * BOM lines, grouped by EXACT diameter and actuator.
 *
 * Nick: "Motorised zone damper Ø250 — 24 V actuator — quantity 4 must remain
 * separate from Motorised zone damper Ø300 — 24 V actuator — quantity 1. The
 * BOM must state the actual diameter. A generic damper line is not acceptable."
 */
export function damperBomLines(dampers, { nacRates = null } = {}) {
  const byKey = new Map();
  for (const d of dampers || []) {
    const key = d.skuKey;
    // THE COMPONENT OWNS THE SIZE; THE ORDER OWNS THE MONEY. The rate is
    // resolved here against the job's own material rates, so a NAC rate typed
    // into Settings reaches the order the same way it does on every other line
    // — and the size it is resolved AT still comes from the duct the damper
    // is fitted in, which is the thing that must not have two answers.
    const rate = d.diameterMm
      ? resolveCost('zone_motor', { diameterMm: d.diameterMm, nacRates })
      : { cost: null, source: null, supplierCode: null };
    const row = byKey.get(key) || {
      key: 'zone_motor',
      skuKey: key,
      diameterMm: d.diameterMm,
      actuator: d.actuator,
      label: d.diameterMm
        ? 'Motorised zone damper ø' + d.diameterMm + ' — ' + d.actuator + ' actuator'
        : 'Motorised zone damper — SIZE UNKNOWN',
      unit: 'each',
      quantity: 0,
      unitCost: rate.cost ?? null,
      priceSource: rate.source || null,
      supplierCode: rate.supplierCode || null,
      effectiveDate: d.effectiveDate,
      priceStatus: rate.cost === null || rate.cost === undefined ? 'PRICE REQUIRED'
        : (rate.source === PRICE_SOURCE.PLACEHOLDER ? 'PLACEHOLDER' : 'VERIFIED'),
      dampers: []
    };
    row.quantity += 1;
    row.dampers.push(d.id);
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .map(r => ({ ...r,
                 totalCost: r.unitCost === null || r.unitCost === undefined
                   ? null : round(r.unitCost * r.quantity, 2),
                 priced: r.unitCost !== null && r.unitCost !== undefined }))
    .sort((a, b) => (a.diameterMm || 0) - (b.diameterMm || 0));
}

/** Anything that would stop this design being installed as drawn. */
export function validateZoneDampers(dampers, { network = null } = {}) {
  const failures = [];
  const sections = new Map((network?.sections || []).map(s => [s.id, s]));
  for (const d of dampers || []) {
    if (!d.diameterMm) {
      failures.push({ damperId: d.id, code: 'DAMPER_SIZE_UNKNOWN',
        message: d.id + ' has no diameter — the duct it sits in has not been sized.' });
    }
    if (d.sizeMismatch) {
      failures.push({ damperId: d.id, code: 'DAMPER_DUCT_SIZE_MISMATCH',
        message: d.mismatchMessage });
    }
    const sec = d.sectionId ? sections.get(d.sectionId) : null;
    if (sec && isReturnSection(sec)) {
      failures.push({ damperId: d.id, code: 'DAMPER_ON_RETURN',
        message: d.id + ' is on a return duct. A zone damper on the return starves ' +
                 'the fan coil; it does not balance a room.' });
    }
  }
  return { ok: failures.length === 0, failures };
}

export default { applyDamperPlacements, buildZoneDampers, damperBomLines, validateZoneDampers,
                 damperSkuKey, ductVelocityMs, DAMPER_DIAMETERS_MM, DEFAULT_ACTUATOR };
