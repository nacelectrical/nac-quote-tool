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
    'Installed by our own crew — we do not subcontract the install',
    'Commissioned, balanced and demonstrated to you on handover',
    'Ongoing support and servicing after the job is finished'
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
// A COMPLETE, QUOTABLE DEMONSTRATION DESIGN
//
// The shipped fixtures are deliberately blocked from quoting — they carry
// placeholder material rates and unpriced BTO configurations, which is exactly
// what the quote gate exists to catch. A demonstration of the CUSTOMER
// presentation therefore needs a design that has passed that gate.
//
// Rather than bypass the gate, this runs the real pipeline once, reads which
// rates it is actually missing, supplies a demonstration rate for each of
// those, and runs it again. So the demo quote is priced the way a real job is
// priced — through the gate, not around it — and if the gate ever starts
// blocking for a new reason, this fixture stops producing a quote too.
// ─────────────────────────────────────────────────────────────────────────────

import { buildApproved } from './approved-job.mjs';
import { runPipeline } from '../../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../../designer/engines/catalogue.mjs';
import { MATERIAL_CATALOGUE } from '../../designer/engines/materials.mjs';

/** A stable, obviously-fake rate derived from the key, so runs are repeatable. */
function demoRate(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 997;
  return Math.round((6 + (h % 34)) * 100) / 100;
}

/** A demonstration rate for every material line, so nothing is a placeholder. */
function demoMaterialRates() {
  const rates = {};
  for (const [key, def] of Object.entries(MATERIAL_CATALOGUE)) {
    if (def.byDiameter) {
      const byDia = {};
      for (const dia of Object.keys(def.byDiameter)) byDia[dia] = demoRate(key + dia);
      rates[key] = byDia;
    } else {
      rates[key] = demoRate(key);
    }
  }
  return rates;
}

export async function buildDemoDesign() {
  const first = await buildApproved();
  const catalogue = await buildCatalogue({});
  const settings = first.settings;
  const nacRates = demoMaterialRates();

  // Fabricated BTO bodies are priced per EXACT configuration and never
  // substituted, so the configurations this design actually produces have to be
  // read off a run rather than guessed. Re-running can change the set, so this
  // converges rather than assuming one pass is enough.
  const btoRates = {};
  let out = first.out;
  for (let pass = 0; pass < 4; pass++) {
    let added = false;
    for (const item of (out.bom?.items || [])) {
      if (item.key === 'bto_fitting' && item.configKey && !btoRates[item.configKey]) {
        btoRates[item.configKey] = { cost: demoRate(item.configKey) + 180, verified: true,
          quoteRef: 'DEMO-FAB-0001', effectiveDate: '2026-09-01' };
        added = true;
      }
    }
    const next = await buildApproved();
    out = runPipeline(next.design, { catalogue, settings, nacRates, btoRates });
    if (!added && (out.quoteGate?.ok ?? false)) break;
  }
  return { out, nacRates, btoRates, catalogue, settings };
}
