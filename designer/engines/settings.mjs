// NAC AI HVAC DESIGNER — HVAC DESIGN SETTINGS (PART 12)
// Every engineering assumption the deterministic engines use lives here.
// Nothing in the engines may hard-code a design constant that belongs in this file.

export const DEFAULT_SETTINGS = {
  version: 1,

  // ── Load calculation ────────────────────────────────────────────────────────
  load: {
    // NAC's existing, proven rule: 145 W/m² ALL-IN on conditioned floor area.
    // This is the whole load, not just the building fabric, and it is what
    // legacySizing() and the existing intake flow use. Left exactly as it is.
    baseWattsPerM2: 145,

    // The detailed engine splits that all-in figure into its parts, so the
    // fabric base below is deliberately LOWER than 145 - glazing, occupancy and
    // appliances are added on top of it. The defaults are calibrated so a
    // typical Australian project lands within a few percent of the 145 rule,
    // and `varianceVsLegacyPct` on the system result reports the difference
    // every time so the two figures can always be compared.
    fabricWattsPerM2: 95,
    // Per-room-type FABRIC overrides (W/m²). Missing = use fabricWattsPerM2.
    roomTypeWattsPerM2: {
      kitchen: 108,
      living: 98,
      dining: 98,
      media: 98,
      bedroom: 88,
      study: 92,
      hallway: 72
    },
    // Heating load is derived from the cooling load by this factor unless the
    // estimator overrides it.
    heatingFactor: 0.95,
    // Reference ceiling height. Rooms above this are scaled by volume ratio,
    // damped by ceilingHeightDamping (1.0 = full volume scaling, 0 = ignore).
    referenceCeilingHeightMm: 2400,
    defaultCeilingHeightMm: 2550,
    ceilingHeightDamping: 0.7,
    ceilingHeightFactorMax: 1.35,

    // Climate zone multipliers (AS/NZS climate zones, NAC operating region first).
    climateFactors: {
      'qld-seq': 1.00,       // South East Queensland — NAC's default
      'qld-tropical': 1.12,
      'qld-inland': 1.08,
      'nsw-coastal': 0.96,
      'vic-tas': 0.92,
      'sa-wa-inland': 1.06,
      'nt': 1.15
    },
    defaultClimate: 'qld-seq',

    // Ceiling/roof insulation.
    insulationFactors: {
      unknown: 1.06,
      none: 1.18,
      basic: 1.06,       // R2.0-ish batts, no sarking
      standard: 1.00,    // current NCC-compliant new build
      high: 0.92         // R5+ / insulated + sarked + sealed
    },
    defaultInsulation: 'standard',

    // Wall construction.
    wallFactors: {
      unknown: 1.03,
      brick_veneer: 1.00,
      double_brick: 0.97,
      lightweight: 1.06,
      hebel: 0.98
    },
    defaultWall: 'brick_veneer',

    // Glazing type — applied to the glazing area component, not the whole room.
    glazingFactors: {
      unknown: 1.10,
      single_clear: 1.20,
      single_tinted: 1.08,
      double: 0.85,
      lowe_double: 0.75
    },
    defaultGlazing: 'single_clear',
    // Additional watts per m² of glass, before glazing/orientation factors.
    glazingWattsPerM2: 190,
    // If glazing area is unknown, assume this fraction of floor area is glass.
    assumedGlazingRatio: 0.14,

    // Solar orientation multipliers applied to the glazing component.
    orientationFactors: { N: 1.05, NE: 1.10, E: 1.15, SE: 1.00, S: 0.85, SW: 1.20, W: 1.30, NW: 1.25, unknown: 1.10 },
    shadingFactors: { none: 1.00, eaves: 0.88, external_blinds: 0.75, heavy: 0.65, unknown: 0.95 },

    // External wall exposure: added per external wall beyond the first.
    externalWallUplift: 0.03,
    // Watts per occupant (sensible + latent, residential seated).
    wattsPerOccupant: 120,
    // Default occupancy by room type.
    defaultOccupancy: { bedroom: 1, living: 3, dining: 2, kitchen: 1, media: 2, study: 1, other: 1 },
    // Appliance/equipment allowance, watts.
    applianceWatts: { kitchen: 800, media: 250, study: 200, other: 0 },

    // Open-plan areas share load — combined open-plan zones get this diversity.
    openPlanDiversity: 0.95,
    // Whole-of-system diversity: not every room peaks at once.
    systemDiversity: 0.92,
    // Safety margin applied to the final system load.
    safetyMargin: 1.05
  },

  // ── Measurement confidence (PART 8) ─────────────────────────────────────────
  confidence: {
    highMin: 90,
    mediumMin: 75,
    // Rooms below this may not enter sizing without explicit estimator override.
    approvalThreshold: 75,
    // Base confidence contributed by each measurement source (PART 30 priority).
    sourceScores: {
      verified_architectural: 98,
      dimension_chain: 92,
      chain_plus_wall_geometry: 88,
      calibrated_geometry: 78,
      manual: 100,
      estimated: 55
    }
  },

  // ── Equipment selection (PART 13) ───────────────────────────────────────────
  equipment: {
    // Acceptable capacity window around the design load.
    minCapacityRatio: 0.95,
    maxCapacityRatio: 1.25,
    oversizeWarnRatio: 1.30,
    undersizeWarnRatio: 0.95,
    // Above this kW a single residential ducted unit is unlikely — flag dual.
    maxSingleUnitKw: 20,
    // NAC's house-standard zone controller. Left blank, the designer picks the
    // cheapest costed controller that fits the zone count and the system brand.
    defaultControllerId: ''
  },

  // ── Airflow (PART 14) ───────────────────────────────────────────────────────
  airflow: {
    // Litres per second per kW of cooling capacity — industry practical range
    // for Australian residential ducted (approx 50 L/s per kW).
    litresPerSecPerKw: 50,
    minRoomAirflowLs: 25,
    // Warn if a room's airflow is outside these multiples of its load share.
    balanceTolerance: 0.15
  },

  // ── Outlets (PART 15) ───────────────────────────────────────────────────────
  outlets: {
    // Practical capacity per outlet before noise becomes an issue.
    types: {
      round_diffuser:  { label: 'Round ceiling diffuser', minLs: 25, nominalLs: 90,  maxLs: 130, throwM: 4.0, faceVelocityMs: 2.5 },
      four_way:        { label: '4-way ceiling diffuser', minLs: 40, nominalLs: 130, maxLs: 190, throwM: 5.5, faceVelocityMs: 2.8 },
      linear_bar:      { label: 'Linear bar grille',      minLs: 30, nominalLs: 110, maxLs: 160, throwM: 5.0, faceVelocityMs: 2.6 },
      slot:            { label: 'Slot diffuser',          minLs: 25, nominalLs: 80,  maxLs: 120, throwM: 4.5, faceVelocityMs: 2.4 },
      sidewall:        { label: 'Sidewall grille',        minLs: 30, nominalLs: 100, maxLs: 150, throwM: 6.0, faceVelocityMs: 2.5 }
    },
    defaultType: 'round_diffuser',
    // Rooms with a long dimension over this get a second outlet for throw.
    splitIfLongestDimM: 5.5,
    maxOutletsPerRoom: 4
  },

  // ── Duct sizing (PART 16) ───────────────────────────────────────────────────
  duct: {
    availableDiametersMm: [100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500],
    // Preferred / maximum velocities in m/s by duct role.
    velocity: {
      main:   { preferredMin: 4.0, preferred: 6.0, max: 8.0 },
      branch: { preferredMin: 3.0, preferred: 4.5, max: 6.0 },
      final:  { preferredMin: 2.5, preferred: 3.5, max: 5.0 },
      return: { preferredMin: 2.5, preferred: 4.0, max: 5.0 }
    },
    // Flexible duct roughness allowance — flex is much rougher than rigid.
    flexRoughnessFactor: 1.6,
    // Warn when a single branch run exceeds this.
    longRunWarnM: 12,
    // Allowance added to measured plan route length for rise/drop and slack.
    routeSlackFactor: 1.12,
    // When no route is drawn, estimate length from plan distance x this.
    straightLineFactor: 1.35
  },

  // ── Return air (PART 19) ────────────────────────────────────────────────────
  returnAir: {
    // Return handles the full supply airflow.
    designFraction: 1.0,
    maxGrilleFaceVelocityMs: 2.0,
    maxFilterFaceVelocityMs: 1.5,
    // Free area of a typical return grille core.
    grilleFreeAreaRatio: 0.72,
    standardGrilleSizesMm: [
      [400, 400], [500, 400], [600, 400], [600, 500],
      [700, 500], [800, 500], [900, 600], [1000, 600], [1200, 600]
    ],
    maxSingleReturnLs: 700
  },

  // ── Zoning (PART 20) ────────────────────────────────────────────────────────
  zoning: {
    // Minimum fraction of system airflow that must stay open at all times.
    minOpenAirflowFraction: 0.40,
    // Recommend a constant zone when the smallest workable combination falls
    // below this fraction.
    constantZoneThreshold: 0.45,
    maxZones: 10,
    // A zone smaller than this share of the system is a candidate for merging.
    smallZoneFraction: 0.06
  },

  // ── Static pressure (PART 21) ───────────────────────────────────────────────
  pressure: {
    // Fitting loss coefficients expressed as equivalent straight metres.
    equivalentLengthM: {
      supply_plenum: 4.0,
      return_plenum: 3.0,
      y_piece: 3.0,
      reducer: 1.5,
      bend_90: 2.5,
      bend_45: 1.2,
      damper_open: 1.0,
      takeoff: 2.0,
      joiner: 0.5
    },
    // Component fixed losses in Pa.
    componentPa: {
      diffuser: 15,
      linear_grille: 20,
      return_grille: 12,
      filter_clean: 25,
      filter_dirty_allowance: 25,
      zone_damper: 10
    },
    // Warn when remaining margin drops below this fraction of unit ESP.
    lowMarginFraction: 0.15,
    // Air density kg/m³ at design conditions.
    airDensity: 1.2
  },

  // ── Commercial (PART 24) — reuses NAC's existing quote maths ────────────────
  commercial: {
    gstRate: 0.10,

    // How NAC charges for the install.
    //   'flat'   — one fee per job regardless of size. This is how NAC prices:
    //              everything bought for the job, plus a fixed fee on top.
    //   'hourly' — hours built from the design at labourRatePerHour, for jobs
    //              that need to be costed that way.
    labourMode: 'flat',

    // The flat fee. It is NOT a cost — it is what NAC makes on the job, and it
    // covers labour, overhead and profit together.
    jobFee: 6000,
    // Whether that fee is the ex-GST margin (GST is then added on top for the
    // customer) or already includes GST.
    jobFeeExGst: true,

    // How the customer's sell price is arrived at.
    //   'materials_plus_fee' — total job cost + jobFee
    //   'catalogue_price'    — the installed price stored per model in the
    //                          existing Price Setup screen
    pricingBasis: 'materials_plus_fee',

    // Hourly rates, used only when labourMode is 'hourly'.
    labourRatePerHour: 95,
    labourHoursPerOutlet: 1.25,
    labourHoursPerZone: 0.75,
    labourHoursIndoorUnit: 6,
    labourHoursOutdoorUnit: 4,
    labourHoursPerDuctMetre: 0.12,
    labourHoursReturn: 2,
    labourHoursCommissioning: 2
  },

  // ── Plan interpretation ─────────────────────────────────────────────────────
  plan: {
    // Values (mm) outside this range are never treated as a room dimension.
    minRoomDimensionMm: 1500,
    maxRoomDimensionMm: 15000,
    // Typical Australian residential wall thicknesses (mm) for classification.
    wallThicknessesMm: [70, 90, 110, 140, 190, 220, 230, 250, 270, 290],
    wallThicknessToleranceMm: 12,
    // A chain must close to within this to be considered self-consistent.
    chainClosureToleranceMm: 60,
    // Chain member values must be at least this to count as a real segment.
    minChainSegmentMm: 40,
    defaultUnit: 'mm'
  }
};

/** Deep-merge stored overrides over the defaults. Arrays are replaced whole. */
export function mergeSettings(base, override) {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base !== 'object' || typeof override !== 'object') return override;
  const out = { ...base };
  for (const k of Object.keys(override)) {
    out[k] = k in base ? mergeSettings(base[k], override[k]) : override[k];
  }
  return out;
}

export function settingsWith(override) {
  return mergeSettings(DEFAULT_SETTINGS, override || {});
}

/** Human confidence band for a numeric score, using configured thresholds. */
export function confidenceBand(score, settings = DEFAULT_SETTINGS) {
  const c = settings.confidence;
  if (score >= c.highMin) return 'HIGH';
  if (score >= c.mediumMin) return 'MEDIUM';
  return 'LOW';
}
