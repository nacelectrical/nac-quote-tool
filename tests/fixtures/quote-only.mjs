// ─────────────────────────────────────────────────────────────────────────────
// A QUOTE WITH NO DUCT DESIGN BEHIND IT
//
// This is the kind of job NAC quotes most of: the estimator walked the house,
// knows what goes in, and prices it. There is no drawing, no bill of
// materials, no load calculation — and there does not need to be for an offer
// to be sound.
//
// The customer here is INVENTED, and deliberately so: a fixture must never
// carry a real person's details. It is a test quote and it is labelled as one
// everywhere a human can read it.
// ─────────────────────────────────────────────────────────────────────────────

import { createQuoteDraft } from '../../designer/engines/quote-draft.mjs';
import { NAC_TRUST, seedTermsAndConditions } from '../../designer/engines/presentation-content.mjs';

/** The upgrade library, as the content store holds it. */
export const UPGRADES = [
  // `imageId` mirrors designer/content/nac-upgrades.json: the pairing Nick
  // asked for by name, stated rather than left to the title matcher.
  { id: 'at5', title: 'AirTouch 5 smart control', priceIncGst: 1350,
    imageId: 'airtouch-console-4-zone',
    description: 'Colour touchscreen, phone app control, each zone to its own temperature.',
    requires: ['has_zoning', 'daikin_system'], enabled: true, sortOrder: 1 },
  { id: 'sensor', title: 'Room temperature sensors', unitPriceIncGst: 110,
    imageId: 'airtouch-room-sensor',
    unitLabel: 'each', maxQuantity: 8, defaultQuantity: 0,
    description: 'A sensor in the rooms you choose, so the system holds that room to its '
      + 'setpoint rather than the hallway’s.',
    requires: ['has_zoning', 'daikin_system'], enabled: true, sortOrder: 2 }
];

export function quoteOnlyDraft(over = {}) {
  return createQuoteDraft({
    id: 'Q-TEST-0001',
    proposalNumber: 'NAC-TEST-0001',
    customer: {
      name: 'Test Quote — do not send',
      email: 'quotes@nacelectrical.com.au',
      phone: '0455 123 456',
      address: '12 Boronia Street, Buderim QLD 4556'
    },
    systems: [
      { id: 'sys-a', brand: 'Daikin', brandId: 'daikin', model: 'FDYAN160AV1',
        outdoorModel: 'RZA160C2V1', capacityKw: 16, phase: '1Ph',
        priceIncGst: 16027, recommended: true },
      { id: 'sys-b', brand: 'Braemar', brandId: 'braemar', model: 'KDHV160D1S',
        capacityKw: 16.3, phase: '1Ph', priceIncGst: 14553, warrantyYears: 7 }
    ],
    // ── THE ZONE CONTROL IS THE HOUSE RULE'S, AND THE AIRTOUCH IS THE
    //    UPGRADE FROM IT ──────────────────────────────────────────────────
    //
    // This fixture named the AirTouch 5 as the quote's zone control AND
    // offered "AirTouch 5 smart control" as a $1,350 upgrade beside it — the
    // same controller, included and charged. duplicateCharges() flags exactly
    // that, and it was sitting in the demonstration quote.
    //
    // Nick, "siemens is used if not airtouch, this is on pricelist also": the
    // base is a Siemens kit sized to the zone count, which is what
    // selectZoneController() returns for six zones, and the AirTouch is what
    // a customer upgrades TO. So the proposal now shows both — the Siemens in
    // the price, the AirTouch as the option.
    controller: {
      id: 'siemens_z6',
      name: 'Siemens Home zone control — 6 zone',
      zoneCount: 6,
      includedInPrice: true
    },
    scope: {
      outletCount: 10, returnCount: 2, zoneCount: 6,
      summary: 'Ducted reverse-cycle throughout the single storey, six zones.',
      // ── THE ZONES, CHOSEN ─────────────────────────────────────────────
      //
      // Nick, 5 November 2026: "Want to be able to choose the zones." A zone
      // is a thing the estimator makes and names, in their own order, and the
      // rooms point at one. The count follows this list, so the two can no
      // longer contradict each other on the customer's page.
      zonesChosen: true,
      zones: ['Living', 'Master', 'Bed 2', 'Bed 3', 'Bed 4', 'Study'],
      conditionedRooms: [
        { label: 'Living / Dining', zone: 'Living', outlets: 3 },
        { label: 'Kitchen', zone: 'Living', outlets: 1 },
        { label: 'Master', zone: 'Master', outlets: 2 },
        { label: 'Bedroom 2', zone: 'Bed 2', outlets: 1 },
        { label: 'Bedroom 3', zone: 'Bed 3', outlets: 1 },
        { label: 'Bedroom 4', zone: 'Bed 4', outlets: 1 },
        { label: 'Study', zone: 'Study', outlets: 1 }
      ]
    },
    inclusions: [
      'Supply and install of the system above',
      'All ductwork, outlets and return air grilles',
      'Electrical connection to an existing suitable circuit',
      'Commissioning, balancing and handover',
      'Removal of all installation waste'
    ],
    exclusions: [
      'Switchboard or circuit upgrades, if the existing board cannot carry the system',
      'Patching or painting beyond the installation openings',
      'Asbestos handling of any kind'
    ],
    selectedUpgradeIds: ['at5', 'sensor'],
    sensorCount: 4,
    upgradeQuantities: { sensor: 4 },
    intro: 'Thank you for having us out. This proposal covers a ducted reverse-cycle '
         + 'system sized for the rooms you want conditioned, zoned so you only pay to '
         + 'cool the parts of the house you are using.',
    ...over
  });
}

/** The content library, with nothing in it NAC has not approved. */
export function quoteOnlyContent(over = {}) {
  return {
    trust: { ...NAC_TRUST },
    termsAndConditions: seedTermsAndConditions(null),
    reviews: [], installations: [], images: [],
    standardInclusions: { commissioning: true, wasteRemoval: true, wifi: false },
    upgrades: UPGRADES,
    ...over
  };
}

/** NAC's confirmed commercial terms. */
export const SETTINGS = {
  commercial: { terms: {
    depositPercent: 50, balanceDueEvent: 'completion', validityDays: 30,
    paymentMethods: ['Direct deposit', 'EFT'],
    termsVersion: 'NAC T&C v1.0 (23 September 2026)', confirmed: true,
    confirmedBy: 'nick@nacelectrical.com.au', confirmedAt: '2026-09-23T00:00:00Z'
  } }
};
