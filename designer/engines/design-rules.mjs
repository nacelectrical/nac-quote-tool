// THE RULES THIS JOB WAS DESIGNED TO — carried BY the design, not by the app.
//
// The minimum supply-branch diameter lived only in application settings. That
// is the right home for a DEFAULT and the wrong home for a decision: the
// Dungannon job is approved at ø250, the fixture set it by hand, and the app —
// running on its own default — sized the Foyer, Master Bedroom and three
// bedrooms at ø200 and put them on the sheet. The same design produced two
// different answers depending on where it was opened, which is the one thing a
// design record must never do.
//
// So the rules a job was designed to are STORED ON THE DESIGN. Settings seed
// them when a design is created; after that they travel with it, through
// persistence, through a revision, through the report, and on to site. An
// installer opening the job in six months gets the sizes it was approved with.
//
// Nick: "Do not remove Ø200 globally. Enforce the configured per-job minimum."
// ø200 is still a stocked size and still available to any job that sets it.

import { DEFAULT_SETTINGS } from './settings.mjs';
import NAC from './nac-standard.mjs';

/** The rules a design carries, and where each one comes from. */
export const DESIGN_RULE_KEYS = Object.freeze([
  'minimumSupplyBranchDiameterMm',
  'minimumBtoToOutletDuctLengthM'
]);

/**
 * The rules in force for a design.
 *
 * The design's own record wins. Settings fill anything it does not carry, so an
 * older design saved before this existed still opens and still sizes the way it
 * always did.
 */
export function designRulesFor(design, settings = DEFAULT_SETTINGS) {
  const stored = design?.designRules || {};
  const duct = settings?.duct || DEFAULT_SETTINGS.duct;
  const out = {
    minimumSupplyBranchDiameterMm:
      stored.minimumSupplyBranchDiameterMm ?? duct.minimumSupplyBranchDiameterMm
        ?? NAC.defaultMinSupplyBranchMm,
    minimumBtoToOutletDuctLengthM:
      stored.minimumBtoToOutletDuctLengthM ?? duct.minimumBtoToOutletDuctLengthM ?? 2.0,
    /** Where each value came from, so the sheet can say so rather than imply it. */
    source: {}
  };
  for (const k of DESIGN_RULE_KEYS) {
    out.source[k] = stored[k] !== undefined && stored[k] !== null ? 'design' : 'settings';
  }
  return out;
}

/**
 * Settings as the ENGINES should see them for this design.
 *
 * Every engine already reads `settings.duct`, so rather than thread a second
 * record through twenty call sites the design's rules are folded into the
 * settings the pipeline runs with. One source of truth, and nothing downstream
 * has to remember to ask twice.
 */
export function settingsForDesign(design, settings = DEFAULT_SETTINGS) {
  const rules = designRulesFor(design, settings);
  return {
    ...settings,
    duct: {
      ...settings.duct,
      minimumSupplyBranchDiameterMm: rules.minimumSupplyBranchDiameterMm,
      minimumBtoToOutletDuctLengthM: rules.minimumBtoToOutletDuctLengthM
    }
  };
}

/**
 * Stamp the rules onto a design that has not got them yet.
 *
 * Called once when a design is created. It never overwrites a rule the design
 * already carries: a job approved at ø250 does not change size because somebody
 * edited the application default afterwards.
 */
export function seedDesignRules(design, settings = DEFAULT_SETTINGS) {
  const rules = designRulesFor(design, settings);
  return {
    ...design,
    designRules: {
      ...(design?.designRules || {}),
      minimumSupplyBranchDiameterMm: rules.minimumSupplyBranchDiameterMm,
      minimumBtoToOutletDuctLengthM: rules.minimumBtoToOutletDuctLengthM
    }
  };
}

/** A one-line statement of the rule and where it came from, for the report. */
export function describeRule(rules, key) {
  if (key === 'minimumSupplyBranchDiameterMm') {
    return 'ø' + rules.minimumSupplyBranchDiameterMm + ' minimum supply branch' +
      (rules.source[key] === 'design' ? ' (set on this job)' : ' (application default)');
  }
  if (key === 'minimumBtoToOutletDuctLengthM') {
    return rules.minimumBtoToOutletDuctLengthM.toFixed(1) + ' m minimum BTO-to-outlet run' +
      (rules.source[key] === 'design' ? ' (set on this job)' : ' (application default)');
  }
  return '';
}

export default { designRulesFor, settingsForDesign, seedDesignRules, describeRule,
                 DESIGN_RULE_KEYS };
