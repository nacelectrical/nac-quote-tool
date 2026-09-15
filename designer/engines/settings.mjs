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
    // What the selection actually AIMS for, as a multiple of the design load.
    // The window above is only the hard bounds. This used to be taken as the
    // midpoint of that window (1.10), which quietly aimed 10% high on top of
    // the safety margin already in the load — enough to push nearly every job
    // up a model size. Margin belongs in load.safetyMargin, where it is
    // visible and set once, not hidden in the ranking.
    targetCapacityRatio: 1.0,
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
    // What NAC actually fit. The 4-way, slot and sidewall outlets were in here
    // from the shipped defaults and NAC do not use them; offering them only
    // meant an outlet type that could be chosen and then had no confirmed
    // price behind it. The linear bar grille stays because it does go on
    // occasionally — it is quoted separately, which the bill of materials says.
    types: {
      round_diffuser:  { label: 'Round ceiling diffuser', minLs: 25, nominalLs: 90,  maxLs: 130, throwM: 4.0, faceVelocityMs: 2.5 },
      linear_bar:      { label: 'Linear bar grille',      minLs: 30, nominalLs: 110, maxLs: 160, throwM: 5.0, faceVelocityMs: 2.6 }
    },
    defaultType: 'round_diffuser',
    // Rooms with a long dimension over this get a second outlet for throw.
    splitIfLongestDimM: 5.5,
    maxOutletsPerRoom: 4,

    // == How many outlets a room gets =========================================
    // NAC's install practice, per room type, where it differs from "however
    // many the capacity table needs". A bedroom gets one outlet; a long living
    // area gets the air spread across the space rather than blown from one
    // corner. Editable here so NAC can change practice without code.
    //
    // `preferred`  the number NAC would normally fit
    // `maxAuto`    the most AUTO DESIGN will fit without being asked
    // `splitOverM` a room longer than this gets another outlet for throw
    // `splitOverSqM` a room bigger than this does too
    byRoomType: {
      bedroom:  { preferred: 1, maxAuto: 2, splitOverM: 6.0, splitOverSqM: 20,
                  note: 'One outlet unless the room is long enough to need two.' },
      living:   { preferred: 1, maxAuto: 4, splitOverM: 5.0, splitOverSqM: 18,
                  note: 'Living and family areas are spread across the space for throw.' },
      dining:   { preferred: 1, maxAuto: 3, splitOverM: 5.5, splitOverSqM: 20 },
      kitchen:  { preferred: 1, maxAuto: 2, splitOverM: 5.5, splitOverSqM: 20 },
      media:    { preferred: 1, maxAuto: 2, splitOverM: 6.0, splitOverSqM: 22 },
      study:    { preferred: 1, maxAuto: 1, splitOverM: 7.0, splitOverSqM: 25,
                  note: 'A study is small — one outlet.' },
      hallway:  { preferred: 1, maxAuto: 2, splitOverM: 8.0, splitOverSqM: 25 },
      other:    { preferred: 1, maxAuto: 3, splitOverM: 5.5, splitOverSqM: 20 }
    },

    // == Outlet neck sizes ====================================================
    // The neck is what the flex connects to, and it is how NAC orders a
    // diffuser: a "250 diffuser" is a 250 neck. It is NOT the branch duct size
    // and it is NOT the face size, and labelling a diffuser with a duct size is
    // how the drawing came to be covered in 150s.
    //
    // The capacities below are DERIVED from NAC's own final-duct velocity band
    // applied to the neck area (nominal = preferred velocity, max = maximum) —
    // they are not a manufacturer's figures. Replace them with the diffuser
    // supplier's published data when NAC settles on a model.
    neckSizesMm: [200, 250, 300],
    // NAC sizes a final more generously than a velocity calculation does. On
    // NAC's own Dungannon Court drawing a 65 L/s bedroom takes a 250 and the
    // 110-125 L/s living runs take a 300 — both a size up from what the
    // velocity band alone would pick. These bands reproduce that practice.
    // Airflow is per OUTLET, not per room.
    neckByAirflowLs: [
      { upToLs: 60,  neckMm: 200 },
      { upToLs: 110, neckMm: 250 },
      { upToLs: 160, neckMm: 300 }
      // Above the last band the room gets another outlet, never a bigger final.
    ],
    // Face size is a property of the diffuser model NAC chooses, not something
    // that can be calculated from airflow. Left blank until the model is known,
    // and reported as such rather than guessed.
    faceSizeByNeckMm: {},
    faceSizeNote: 'Face size comes from the selected diffuser model — confirm with the supplier.'
  },

  // ── Duct sizing (PART 16) ───────────────────────────────────────────────────
  duct: {
    // Standard Australian flex sizes. 175 and 225 are not stocked lines — MMEM
    // quote 200–400 — so the engine no longer sizes to a duct NAC cannot buy.
    //
    // NAC do not install 450 or 500. Anything that would need more than a 400
    // is run as two ducts instead, which is how it goes in on site: 450 and 500
    // flex is a fight to get through a truss roof and NAC do not carry it.
    availableDiametersMm: [100, 125, 150, 200, 250, 300, 350, 400],
    // Hard ceiling on any single duct. Raise this only if NAC start carrying
    // larger flex — the engine splits the run rather than exceed it.
    maxDiameterMm: 400,

    // == What NAC actually connects to an outlet ==============================
    // A velocity calculation will happily approve a 150 for a bedroom, and NAC
    // does not install that. Sizing to the smallest duct the physics permits is
    // how the drawing ended up covered in 150 on rooms that get a 200 on site.
    //
    // These are install rules, not physics, so they live here where NAC can
    // change them without touching the engine. They are ENFORCED in
    // selectDiameter(), so the bill of materials, the pressure calculation and
    // the drawing all carry the same size.
    finalBranch: {
      // The only sizes AUTO DESIGN may choose for a final / outlet connection.
      autoLadderMm: [200, 250, 300],
      // Never smaller than this automatically, whatever the velocity says.
      preferredMinMm: 200,
      // Never larger than this on a final. A room needing more air than one
      // 300 should carry gets ANOTHER OUTLET, not a bigger duct - 350 and 400
      // are trunk and major-branch sizes, not outlet connections.
      maxMm: 300,
      // Available to the estimator by hand for a special case. Never chosen
      // automatically.
      manualOnlyMm: [100, 125, 150]
    },
    // The smallest duct AUTO DESIGN will put on a room branch. A branch may
    // still go up to maxDiameterMm - it is a major branch, not an outlet.
    branchMinMm: 200,
    // == Take-offs ============================================================
    // How far apart two rooms can be along a trunk arm and still share ONE
    // take-off. Bigger means fewer, larger BTOs feeding a group of rooms — the
    // three minor bedrooms off one branch — which is how a house actually goes
    // in. Smaller means a take-off per room, which is the "central explosion"
    // of branches that made the drawing unreadable.
    // A fraction of the house's longest side, so it scales with the plan.
    junctionClusterFraction: 0.12,
    // A take-off serving this many rooms or more gets a MAJOR BRANCH run out to
    // the group before it splits, rather than every room being pulled all the
    // way back to the trunk.
    majorBranchMinRooms: 2,

    // The smallest duct AUTO DESIGN will choose for ANY run, trunk included.
    // NAC does not install 100, 125 or 150 flex, so the auto design never picks
    // one - not on a final, not on a branch, and not on the short tail of a
    // trunk arm that happens to be carrying one bedroom's worth of air.
    // They stay in availableDiametersMm so the estimator can still set one by
    // hand for a special case.
    autoMinDiameterMm: 200,
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
    maxSingleReturnLs: 700,
    // NAC's return standard: one 400 mm duct, or two ducts at 350 or 400.
    // Nothing larger — 450 and 500 flex is not installed.
    returnDuctSizesMm: [350, 400],
    maxReturnDucts: 2
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
