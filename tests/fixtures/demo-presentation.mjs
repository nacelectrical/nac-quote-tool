// ─────────────────────────────────────────────────────────────────────────────
// A DEMONSTRATION QUOTE, BUILT FROM SAFE TEST DATA
//
// Every name, suburb, review and photograph in here is invented for testing and
// is labelled as such. Nothing in this file may be copied into the production
// content library: the reviews are not real reviews, and a fabricated review in
// front of a customer is the exact failure the content rules exist to prevent.
//
// Nick: "Create one realistic demonstration quote using safe test data." and
// "Do not publish a real customer quote, import real reviews or use customer
// installation photos until I have reviewed the finished presentation."
// ─────────────────────────────────────────────────────────────────────────────

import * as zlibSync from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PERMISSION, CONSENT } from '../../designer/engines/presentation-content.mjs';

/**
 * A gradient PNG stand-in, so the fixture needs no binary assets on disk.
 *
 * PNG rather than an SVG data URI on purpose: the customer page's URL allowlist
 * refuses `data:image/svg+xml` because an SVG can carry script, and a fixture
 * that only renders because it dodges that rule is not testing the real thing.
 */
export function demoImage(label, w, h, from = [22, 32, 74], to = [59, 76, 143]) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;                                   // filter byte: none
    for (let x = 0; x < w; x++) {
      const t = (x / Math.max(1, w - 1) + y / Math.max(1, h - 1)) / 2;
      raw[o++] = Math.round(from[0] + (to[0] - from[0]) * t);
      raw[o++] = Math.round(from[1] + (to[1] - from[1]) * t);
      raw[o++] = Math.round(from[2] + (to[2] - from[2]) * t);
      raw[o++] = 255;
    }
  }
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cs = Buffer.alloc(4); cs.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cs]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

/** A different pair of blues per image, so a gallery is not four identical boxes. */
function tint(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) % 360;
  const a = [18 + (h % 26), 34 + (h % 40), 72 + (h % 60)];
  return [a, [a[0] + 46, a[1] + 52, a[2] + 70]];
}

function img(id, label, w, h, alt) {
  return {
    id, alt,
    approved: true, exifStripped: true, gpsRemoved: true,
    focalPoint: { x: 0.5, y: 0.45 },
    original: { ref: 'private/' + id + '.jpg', width: w * 3, height: h * 3, bytes: 2400000 },
    derivatives: [
      { ref: demoImage(label, Math.round(w / 2), Math.round(h / 2), tint(id)[0], tint(id)[1]),
        width: Math.round(w / 2), height: Math.round(h / 2), format: 'png', bytes: 900 },
      { ref: demoImage(label, w, h, tint(id)[0], tint(id)[1]),
        width: w, height: h, format: 'png', bytes: 1200 }
    ]
  };
}

/** The real NAC logo from the repository root, as a data URI. */
export function nacLogo() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const bytes = readFileSync(join(here, '..', '..', 'nac-logo.jpg'));
    return 'data:image/jpeg;base64,' + bytes.toString('base64');
  } catch { return null; }
}

export const DEMO_IMAGES = [
  img('hero', 'Installation', 1600, 700, 'A NAC ducted system installed in a Sunshine Coast home'),
  img('inst-1', 'Peregian', 800, 600, 'Ducted outlets in an open-plan living area'),
  img('inst-2', 'Coolum', 800, 600, 'Outdoor condensing unit on a levelled base'),
  img('inst-3', 'Buderim', 800, 600, 'Zone controller mounted in a hallway'),
  img('inst-4', 'Noosaville', 800, 600, 'Return air grille in a ceiling')
];

export const DEMO_INSTALLATIONS = [
  { id: 'i1', coverImageId: 'inst-1', imageIds: ['inst-2'], suburb: 'Peregian Springs',
    brand: 'Daikin', systemType: 'ducted', capacityKw: 16, zoneCount: 6,
    description: 'Six-zone ducted system through a single-storey four-bedroom home.',
    completedDate: '2026-06-18', consentStatus: CONSENT.SUBURB_ONLY, approved: true,
    featured: true, tags: ['ducted', 'daikin'] },
  { id: 'i2', coverImageId: 'inst-2', imageIds: [], suburb: 'Coolum Beach',
    brand: 'Daikin', systemType: 'ducted', capacityKw: 14, zoneCount: 5,
    description: 'Replacement of an end-of-life system with minimal ceiling disturbance.',
    completedDate: '2026-04-02', consentStatus: CONSENT.SUBURB_ONLY, approved: true,
    featured: false, tags: ['ducted', 'daikin'] },
  { id: 'i3', coverImageId: 'inst-3', imageIds: [], suburb: 'Buderim',
    brand: 'Fujitsu', systemType: 'ducted', capacityKw: 18, zoneCount: 7,
    description: 'Two-storey home with separate upstairs and downstairs zoning.',
    completedDate: '2025-11-20', consentStatus: CONSENT.SUBURB_ONLY, approved: true,
    featured: false, tags: ['ducted', 'fujitsu'] },
  { id: 'i4', coverImageId: 'inst-4', imageIds: [], suburb: 'Noosaville',
    brand: 'Daikin', systemType: 'ducted', capacityKw: 12.5, zoneCount: 4,
    description: 'New build, ducted system installed at lock-up stage.',
    completedDate: '2026-02-11', consentStatus: CONSENT.SUBURB_ONLY, approved: true,
    featured: false, tags: ['ducted', 'daikin', 'new build'] },
  // Deliberately unapproved — the tests assert this never reaches a customer.
  { id: 'i-unapproved', coverImageId: 'inst-1', imageIds: [], suburb: 'Maroochydore',
    brand: 'Daikin', systemType: 'ducted', capacityKw: 16, zoneCount: 6,
    description: 'TEST RECORD — NOT APPROVED FOR MARKETING.',
    completedDate: '2026-07-01', consentStatus: CONSENT.SUBURB_ONLY, approved: false,
    featured: true, tags: ['ducted', 'daikin'] }
];

export const DEMO_REVIEWS = [
  { id: 'r1', text: 'The team turned up when they said they would, the install was tidy and they '
      + 'walked us through the controller before they left. House has never been more comfortable.',
    displayName: 'Sample Reviewer One', surnameApproved: false, suburb: 'Peregian Springs',
    rating: 5, source: 'google', sourceUrl: 'https://example.invalid/review/1',
    reviewDate: '2026-06-25', approved: true, permissionStatus: PERMISSION.PUBLIC_SOURCE,
    tags: ['ducted', 'daikin'], featured: true },
  { id: 'r2', text: 'Quoted properly, explained the zoning so we actually understood it, and the '
      + 'price did not move between the quote and the invoice.',
    displayName: 'Sample Reviewer Two', surnameApproved: false, suburb: 'Coolum Beach',
    rating: 5, source: 'google', sourceUrl: 'https://example.invalid/review/2',
    reviewDate: '2026-05-02', approved: true, permissionStatus: PERMISSION.PUBLIC_SOURCE,
    tags: ['ducted'], featured: false },
  { id: 'r3', text: 'Second system we have had NAC install. Same crew, same standard of work.',
    displayName: 'Sample Reviewer Three', surnameApproved: false, suburb: 'Buderim',
    rating: 5, source: 'facebook', sourceUrl: '', reviewDate: '2026-03-14',
    approved: true, permissionStatus: PERMISSION.WRITTEN, tags: ['ducted'], featured: false },
  { id: 'r4', text: 'Good communication from the first site visit through to commissioning.',
    displayName: 'Sample Reviewer Four', surnameApproved: false, suburb: 'Noosaville',
    rating: 4, source: 'google', sourceUrl: 'https://example.invalid/review/4',
    reviewDate: '2026-01-30', approved: true, permissionStatus: PERMISSION.PUBLIC_SOURCE,
    tags: ['ducted'], featured: false },
  // Deliberately unapproved, and with no permission — tests assert both bars.
  { id: 'r-unapproved', text: 'TEST RECORD — NOT APPROVED, MUST NEVER BE PUBLISHED.',
    displayName: 'Sample Reviewer Five', surnameApproved: false, suburb: 'Maroochydore',
    rating: 5, source: 'email', sourceUrl: '', reviewDate: '2026-07-01',
    approved: false, permissionStatus: PERMISSION.NONE, tags: ['ducted'], featured: true }
];

export const DEMO_TRUST = {
  businessName: 'NAC Electrical Air & Refrigeration',
  abn: '97 636 392 982',
  electricalLicence: 'TEST-ELEC-0000',
  arcAuthorisation: 'TEST-ARC-0000',
  serviceArea: 'Sunshine Coast and surrounding South East Queensland',
  workmanshipWarranty: '5 year NAC workmanship warranty on the installation',
  manufacturerWarranty: '5 year manufacturer parts and labour warranty',
  insuranceStatement: 'Fully insured, including public liability',
  memberships: [],
  phone: '07 0000 0000',
  email: 'quotes@example.invalid',
  website: 'nacelectrical.com.au',
  points: [
    'Licensed electrical contractor and ARC-authorised refrigeration technicians',
    'Local residential ducted air conditioning specialists',
    'Quality equipment from established manufacturers',
    'Every system individually designed for the home, not sized off a rule of thumb',
    // "Installed by our own crew — we do not subcontract the install" was here.
    // Nick had it removed: it is a claim about how NAC staffs a job, and it is
    // not one the software can know or keep true. A trust point NAC cannot
    // guarantee on every job is a promise waiting to be broken.
    'Commissioned, balanced and demonstrated to you on handover'
    // "Ongoing support and servicing after the job is finished" is also gone:
    // a servicing commitment belongs in the trust settings, where Nick states
    // the terms, not in a bullet that implies one without saying what it is.
  ]
};

export const DEMO_UPGRADES = [
  { id: 'u-wifi', title: 'Wi-Fi control adaptor', priceIncGst: 495,
    description: 'Control the system from your phone, at home or away.',
    requires: ['has_controller'], sortOrder: 1 },
  { id: 'u-outlet', title: 'Additional supply outlet', priceIncGst: 385,
    description: 'One extra ceiling outlet, positioned during detailed design.',
    requires: ['has_outlets'], sortOrder: 2 },
  { id: 'u-zone', title: 'Additional zone', priceIncGst: 780,
    description: 'An extra independently controlled zone, including motorised damper.',
    requires: ['has_zoning', 'zone_headroom'], sortOrder: 3 },
  { id: 'u-warranty', title: 'Extended workmanship coverage (7 years)', priceIncGst: 640,
    description: 'Extends the NAC workmanship warranty from 5 years to 7.',
    requires: [], sortOrder: 4 },
  // Requires something this design does not have — tests assert it is never
  // offered to the customer, not merely disabled.
  { id: 'u-3phase', title: 'Three-phase equipment alternative', priceIncGst: 1450,
    description: 'TEST RECORD — requires a three-phase supply.',
    requires: ['three_phase'], sortOrder: 5 }
];

export const DEMO_CONTENT = {
  // ── THIS IS DEMONSTRATION DATA ────────────────────────────────────────────
  //
  // It exists so the presentation can be designed, reviewed and tested against
  // something that reads like a real quote — which is exactly what makes it
  // dangerous. The flag travels into every presentation built from it, renders
  // as a watermark on every surface, and makes `buildPresentation` REFUSE to
  // issue, accept or send. A demonstration may be looked at; it may never be a
  // quote. Nick: "quote-proposal.pdf is DEMONSTRATION DATA ONLY and must never
  // be publishable."
  demonstration: true,

  // NAC's own logo, so the visual acceptance is judged against the real mark
  // rather than a grey box. It is NAC's asset, not customer data.
  logo: nacLogo(),
  trust: DEMO_TRUST,
  reviews: DEMO_REVIEWS,
  installations: DEMO_INSTALLATIONS,
  images: DEMO_IMAGES,
  upgrades: DEMO_UPGRADES,
  standardInclusions: { commissioning: true, wasteRemoval: true, wifi: false },
  paymentTerms: {
    depositPercent: 20,
    stages: [
      { label: 'Deposit on acceptance', detail: '20% to confirm your installation booking' },
      { label: 'Balance on completion', detail: 'Due once the system is commissioned and handed over' }
    ],
    validity: 'This proposal is valid for 30 days from the date prepared.',
    depositInstructions: 'Deposit details will be emailed to you once you accept.'
  },
  aftercare: {
    commissioning: 'Airflow balanced, refrigerant charge verified and the controller demonstrated '
      + 'to you before we leave.',
    filterCare: 'Return air filters should be washed every three months — we will show you how.',
    servicing: 'A service every two years keeps the manufacturer warranty intact and the running '
      + 'costs down.',
    support: 'Call the office on the number below. Warranty work is handled by us, not a call centre.'
  },
  termsAndConditions:
    'TEST TERMS — FOR DEMONSTRATION ONLY.\n\n'
  + 'This proposal is based on the information available at the time of preparation. Final outlet, '
  + 'return-air and indoor-unit positions are confirmed during detailed design and roof-space '
  + 'assessment.\n\n'
  + 'Prices include GST and are valid for the period shown. Work that cannot be foreseen from the '
  + 'plans — asbestos, restricted roof access, switchboard upgrades — is quoted separately before '
  + 'it is carried out.'
};

// ─────────────────────────────────────────────────────────────────────────────
// THE DEMONSTRATION JOB
//
// This used to build a real duct design: it ran the router, the BTO placement,
// the pressure estimate and the bill of materials through runPipeline(), with
// a demonstration rate invented for every material line, looping until the
// quote gate stopped objecting. It demonstrated a pipeline that no longer
// exists.
//
// A quote is now a quote draft and nothing else, so the demonstration is one
// too — the same shape every real job has, through the same
// draftToQuoteSource() the application uses. There is no bill of materials to
// invent rates for, which also means there are no invented rates.
//
// It is still DEMONSTRATION DATA: the customer is invented, the reviews and
// the photographs are generated, and `DEMO_CONTENT.demonstration` is true, so
// buildPresentation() refuses to issue it. That refusal is the point.
// ─────────────────────────────────────────────────────────────────────────────

import { createQuoteDraft, draftToQuoteSource, draftSelectedOptions }
  from '../../designer/engines/quote-draft.mjs';

/** The draft behind the demonstration quote. */
export function demoDraft(over = {}) {
  return createQuoteDraft({
    id: 'D-DEMO-1',
    proposalNumber: 'NAC-2026-0184',
    customer: {
      name: 'Sarah Whitlock',
      email: 'sarah.whitlock@bigpond.com',
      phone: '0412 665 108',
      address: '34 Kauri Crescent, Peregian Springs QLD 4573'
    },
    systems: [
      { id: 'sys-a', brand: 'Daikin', brandId: 'daikin', model: 'FDYAN160AV1',
        outdoorModel: 'RZA160C2V1', capacityKw: 16, phase: '1Ph',
        priceIncGst: 15400, recommended: true,
        note: 'Premium inverter, quietest indoor unit' },
      { id: 'sys-b', brand: 'Braemar', brandId: 'braemar', model: 'KDHV160D1S',
        outdoorModel: 'KCHV160D1B', capacityKw: 16.3, phase: '1Ph',
        priceIncGst: 13900, warrantyYears: 7 }
    ],
    controller: { id: 'siemens_z8', name: 'Siemens Home zone control \u2014 8 zone',
                  zoneCount: 8 },
    scope: {
      outletCount: 12, returnCount: 2, zoneCount: 6,
      summary: 'Ducted reverse-cycle throughout, six zones.',
      conditionedRooms: [
        { label: 'Open plan', zone: 'Open plan', outlets: 4 },
        { label: 'Master', zone: 'Master', outlets: 2 },
        { label: 'Bedroom 2', zone: 'Bed 2', outlets: 1 },
        { label: 'Bedroom 3', zone: 'Bed 3', outlets: 1 },
        { label: 'Bedroom 4', zone: 'Bed 4', outlets: 1 },
        { label: 'Media', zone: 'Media', outlets: 3 }
      ]
    },
    inclusions: [
      'Supply and install of the system above',
      'All ductwork, supply outlets and return air grilles',
      'Electrical connection to an existing suitable circuit',
      'Commissioning, balancing and handover',
      'Removal of all installation waste'
    ],
    exclusions: [
      'Switchboard or circuit upgrades, if the existing board cannot carry the system',
      'Patching or painting beyond the installation openings',
      'Asbestos handling of any kind'
    ],
    selectedUpgradeIds: [],
    intro: 'Thank you for having us out. This proposal covers a ducted reverse-cycle '
         + 'system sized for the rooms you want conditioned.',
    ...over
  });
}

/**
 * The demonstration quote source, in the shape buildPresentation() reads.
 *
 * `out` keeps its name so the tests and the browser suites that destructure
 * it do not all have to change; it is a quote source now rather than a design.
 */
export async function buildDemoDesign(over = {}) {
  const draft = demoDraft(over);
  const upgrades = DEMO_CONTENT.upgrades || [];
  const out = draftToQuoteSource(draft, { upgrades });
  return {
    out,
    draft,
    selectedOptionIds: draftSelectedOptions(draft, { upgrades }),
    settings: DEMO_SETTINGS
  };
}

/** NAC's commercial terms, as the demonstration carries them. */
export const DEMO_SETTINGS = {
  commercial: { terms: {
    depositPercent: 50, balanceDueEvent: 'completion', validityDays: 30,
    paymentMethods: ['Direct deposit', 'EFT'],
    termsVersion: 'NAC T&C v1.0 (23 September 2026)', confirmed: true,
    confirmedBy: 'nick@nacelectrical.com.au', confirmedAt: '2026-09-23T00:00:00Z'
  } }
};
