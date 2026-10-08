// ─────────────────────────────────────────────────────────────────────────────
// THE WHOLE WORKFLOW, RENDERED
//
//   node tools/lifecycle-proof.mjs [outDir]
//
// Runs save → issue → open → choose → accept → new revision through the REAL
// endpoint modules against PostgreSQL carrying NAC's real schema, and writes
// out the customer page that came back at each step, plus a transcript.
//
// It is not a test — the assertions live in tests/quote-lifecycle-db.test.mjs.
// This exists so the pages can be LOOKED AT, which is the acceptance criterion
// Nick set: "The customer-facing result is the acceptance criterion."
//
// Everything here is a clearly labelled TEST job and TEST offer. It never
// touches a live database, never sends anything, and never issues Kauri.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { startRest, reset, sql, row } from '../tests/helpers/pg-rest.mjs';
import { buildDemoDesign, nacLogo, DEMO_IMAGES, DEMO_INSTALLATIONS }
  from '../tests/fixtures/demo-presentation.mjs';
import { NAC_TRUST } from '../designer/engines/presentation-content.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';

const OUT = process.argv[2] || '/tmp/nac-lifecycle';
if (!existsSync('/usr/lib/postgresql/16/bin/psql')) {
  console.error('PostgreSQL is not installed — this proof needs a real database.');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const GOOGLE = JSON.parse(
  (await import('node:fs')).readFileSync(ROOT + '/designer/content/google-reviews.json', 'utf8')
).reviews;

const DESIGN_ID = 'D-TEST-LIFECYCLE';
const CUSTOMER = { name: 'Sarah Whitlock', email: 'sarah.whitlock@bigpond.com',
  phone: '0412 665 108', address: '12 Boronia Street, Buderim QLD 4556' };

const log = [];
const say = (s) => { log.push(s); console.log(s); };

function call(handler, { method = 'GET', query = {}, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200,
      setHeader() { return this; }, status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); return this; },
      send(o) { return this.json(o); }, end(o) { return this.json(o ?? null); } };
    Promise.resolve(handler({ method, query, body, headers }, res))
      .catch(e => resolve({ status: 500, body: { error: String(e && e.message) } }));
  });
}

const stop = await startRest();
reset();
process.env.SUPABASE_KEY = 'test-service-key';
globalThis.fetch = async (url) => String(url).includes('/auth/v1/user')
  ? { ok: true, json: async () => ({ id: 'u1', email: 'nick@nacelectrical.com.au' }) }
  : { ok: false, status: 404, json: async () => ({}) };

const built = await buildDemoDesign();
const design = { ...built.out, id: DESIGN_ID, designId: DESIGN_ID, customer: CUSTOMER,
  fittingAssembly: { ok: true, rows: [], unbuildable: [], partsCost: null,
                     summary: 'Stood in for by the lifecycle fixture.' } };

const hero = DEMO_IMAGES.find(i => i.id === 'hero');
const heroBig = hero.derivatives[hero.derivatives.length - 1];
const CONTENT = {
  trust: { ...NAC_TRUST, points: ['Every system individually designed for the home'] },
  standardInclusions: { commissioning: true, wasteRemoval: true, wifi: false },
  logo: nacLogo(),
  heroImage: { src: heroBig.ref, alt: hero.alt, width: heroBig.width, height: heroBig.height,
               srcset: hero.derivatives.map(d => ({ ref: d.ref, width: d.width })) },
  // NAC's own words. The RATING is fixture data — Google's notifications do
  // not carry it, so the shipped file holds null and nothing publishes until
  // NAC enters the real figures.
  reviews: GOOGLE.slice(0, 3).map(r => ({ ...r, rating: 5, approved: true })),
  installations: DEMO_INSTALLATIONS, images: DEMO_IMAGES,
  upgrades: [
    { id: 'at5', title: 'AirTouch 5 smart control', priceIncGst: 1350,
      description: 'Colour touchscreen, phone app control, and each zone to its own temperature.',
      requires: ['has_zoning'], enabled: true, sortOrder: 1 },
    { id: 'sensor', title: 'Room temperature sensors', unitPriceIncGst: 110, unitLabel: 'each',
      description: 'A sensor in the rooms you choose, so the system holds that room to its setpoint.',
      maxQuantity: 6, defaultQuantity: 0, requires: ['has_zoning'], enabled: true, sortOrder: 2 }
  ]
};
const SETTINGS = { commercial: { terms: {
  depositPercent: 50, balanceDueEvent: 'completion', validityDays: 30,
  paymentMethods: ['Direct deposit', 'EFT'], termsVersion: 'NAC T&C v1.0 (23 September 2026)',
  confirmed: true, confirmedBy: 'nick@nacelectrical.com.au',
  confirmedAt: '2026-09-23T00:00:00Z' } } };

sql("insert into public.nac_designs (id, customer_name, customer_address, status, design, updated_at) "
  + "values ('" + DESIGN_ID + "', 'Sarah Whitlock', '12 Boronia Street, Buderim QLD 4556', 'draft', "
  + "$nacjson$" + JSON.stringify(design).replace(/\$nacjson\$/g, '') + "$nacjson$, now())");
sql("insert into public.nac_presentation_content (key, data, updated_at) values ('library', "
  + "$nacjson$" + JSON.stringify(CONTENT) + "$nacjson$::jsonb, now())");
sql("insert into public.nac_settings (key, value, updated_at) values ('nac_hvac_settings_v1', "
  + "$nacjson$" + JSON.stringify(SETTINGS) + "$nacjson$, now())");

const unit = design.selectedUnit || {};
const sell = Number(design.commercials?.sellPriceIncGst) || 0;
const systemOptions = [
  { id: 'sys-a', brand: unit.brandName || 'Daikin', brandId: unit.brandId || 'daikin',
    model: unit.model, capacityKw: unit.capacityKw, phase: unit.phase,
    priceIncGst: sell, recommended: true },
  { id: 'sys-b', brand: 'Braemar', brandId: 'braemar', model: 'KDHV160D1S', capacityKw: 16.3,
    phase: '1Ph', priceIncGst: Math.round((sell - 1474) * 100) / 100, warrantyYears: 7 }
];

const issueH = (await import('../server/quote-issue.js')).default;
const viewH = (await import('../server/quote-view.js')).default;
const respondH = (await import('../server/quote-respond.js')).default;
const STAFF = { Authorization: 'Bearer test-staff-token' };

const page = (name, body) => {
  writeFileSync(OUT + '/' + name + '.html', renderPresentationHtml(body.presentation, {}));
  return OUT + '/' + name + '.html';
};

say('NAC AI HVAC DESIGNER — lifecycle proof against PostgreSQL');
say('TEST JOB AND TEST OFFER. Nothing here is sent and nothing touches live data.');
say('');

// 1 ── ISSUE
const issued = await call(issueH, { method: 'POST', headers: STAFF,
  body: { designId: DESIGN_ID, customer: CUSTOMER, job: { siteAddress: CUSTOMER.address },
          proposalNumber: 'NAC-TEST-0001', quoteRevision: 1, validDays: 30,
          systemOptions, chosenSystemId: 'sys-a', baseUrl: 'http://127.0.0.1:8899' } });
if (issued.status !== 200) { say('ISSUE FAILED: ' + JSON.stringify(issued.body)); await stop(); process.exit(1); }
const t1 = issued.body.token;
say('1. ISSUED      revision 1, GST ' + (issued.body.gstRate * 100) + '%, total $'
  + issued.body.totalIncGst.toFixed(2));
say('   customer URL ' + issued.body.url);

// 2 ── OPEN
const opened = await call(viewH, { method: 'GET', query: { token: t1 } });
say('2. OPENED      ' + opened.body.presentation.reviews.length + ' reviews, '
  + (opened.body.presentation.installations || []).length + ' past installs, '
  + 'logo ' + (opened.body.presentation.brand?.logo ? 'present' : 'MISSING')
  + ', total $' + opened.body.presentation.investment.totalIncGst.toFixed(2));
say('   ' + page('1-issued', opened.body));

// 3 ── CHOOSE
const chose = await call(respondH, { method: 'POST',
  body: { token: t1, action: 'options', chosenSystemId: 'sys-b',
          selectedOptionIds: ['at5', { id: 'sensor', quantity: 4 }],
          quoteRevision: opened.body.offer.quoteRevision,
          offerFrozenAt: opened.body.offer.frozenAt } });
const chosen = await call(viewH, { method: 'GET', query: { token: t1 } });
say('3. CHOSE       Braemar + AirTouch + 4 sensors → $' + chose.body.totalIncGst.toFixed(2)
  + '  (deposit $' + chose.body.deposit.amount.toFixed(2) + ')');
say('   ' + page('2-options-chosen', chosen.body));

// 4 ── EDIT THE DESIGN AND THE LIBRARY AFTER ISSUE
const before = chosen.body.presentation.investment.totalIncGst;
const stored = row("select design from public.nac_designs where id = '" + DESIGN_ID + "'");
const edited = JSON.parse(stored.design);
edited.commercials = { ...(edited.commercials || {}),
  sellPriceIncGst: Number(edited.commercials.sellPriceIncGst) + 5000 };
edited.rooms = (edited.rooms || []).slice(0, -2);
writeFileSync(OUT + '/edited-design.json', JSON.stringify({ note: 'written back to the database' }));
sql("update public.nac_designs set design = $nacjson$" + JSON.stringify(edited).replace(/\$nacjson\$/g, '')
  + "$nacjson$, updated_at = now() where id = '" + DESIGN_ID + "'");
sql("update public.nac_presentation_content set data = jsonb_set(data, '{reviews}', '[]'::jsonb), "
  + "updated_at = now() where key = 'library'");
const after = await call(viewH, { method: 'GET', query: { token: t1 } });
say('4. EDITED      design price +$5,000, two rooms deleted, every review removed from the library');
say('   reopened    total $' + after.body.presentation.investment.totalIncGst.toFixed(2)
  + ' (was $' + before.toFixed(2) + ')  ·  '
  + after.body.presentation.reviews.length + ' reviews still on the page'
  + (after.body.presentation.investment.totalIncGst === before ? '  → UNCHANGED' : '  → CHANGED!'));
say('   ' + page('3-after-design-edit', after.body));

// 5 ── ACCEPT
const accepted = await call(respondH, { method: 'POST',
  body: { token: t1, action: 'accept', customerName: 'Sarah Whitlock', acknowledgedTerms: true,
          quoteRevision: after.body.offer.quoteRevision,
          offerFrozenAt: after.body.offer.frozenAt,
          expectedTotalIncGst: after.body.presentation.investment.totalIncGst } });
const rec = row("select status, data from public.nac_quote_issues where token = '" + t1 + "'").data;
say('5. ACCEPTED    $' + rec.acceptance.totalIncGst.toFixed(2) + ' by ' + rec.acceptance.customerName
  + ' at ' + rec.acceptance.acceptedAt);
say('   system ' + rec.acceptance.chosenSystemId + ', options '
  + rec.acceptance.selectedOptions.map(o => o.id + '×' + o.quantity + ' $' + o.priceIncGst).join(', '));
say('   displayed $' + after.body.presentation.investment.totalIncGst.toFixed(2)
  + ' = recorded $' + rec.acceptance.totalIncGst.toFixed(2) + ' → '
  + (after.body.presentation.investment.totalIncGst === rec.acceptance.totalIncGst ? 'MATCH' : 'MISMATCH'));
const acceptedView = await call(viewH, { method: 'GET', query: { token: t1 } });
say('   ' + page('4-accepted', acceptedView.body));

// 6 ── REPEAT SUBMISSION
const repeat = await call(respondH, { method: 'POST',
  body: { token: t1, action: 'accept', customerName: 'Sarah Whitlock', acknowledgedTerms: true } });
say('6. RE-PRESSED  ' + repeat.status + ' ' + (repeat.body.repeat ? 'repeat:true — one acceptance, not two' : JSON.stringify(repeat.body)));

// 7 ── A STALE SCREEN CANNOT ISSUE A STALE PRICE
// The design was repriced at step 4. Issuing revision 2 from the screen that
// is still holding the old figure is refused, naming both numbers, rather than
// the application quietly deciding which one the customer gets.
const staleIssue = await call(issueH, { method: 'POST', headers: STAFF,
  body: { designId: DESIGN_ID, customer: CUSTOMER, job: {}, proposalNumber: 'NAC-TEST-0001',
          quoteRevision: 2, validDays: 30, systemOptions, chosenSystemId: 'sys-a',
          supersedes: t1 } });
say('7. STALE PRICE ' + staleIssue.status + ' ' + staleIssue.body.error + ' — screen $'
  + staleIssue.body.screenPriceIncGst.toFixed(2) + ' vs saved design $'
  + staleIssue.body.designPriceIncGst.toFixed(2));

// 8 ── NEW REVISION, PRICED FROM THE DESIGN AS IT NOW STANDS
const newSell = Number(JSON.parse(
  row("select design from public.nac_designs where id = '" + DESIGN_ID + "'").design
).commercials.sellPriceIncGst);
const freshOptions = systemOptions.map(o => o.id === 'sys-a'
  ? { ...o, priceIncGst: newSell } : o);
const v2 = await call(issueH, { method: 'POST', headers: STAFF,
  body: { designId: DESIGN_ID, customer: CUSTOMER, job: { siteAddress: CUSTOMER.address },
          proposalNumber: 'NAC-TEST-0001', quoteRevision: 2, validDays: 30,
          systemOptions: freshOptions, chosenSystemId: 'sys-a', supersedes: t1,
          baseUrl: 'http://127.0.0.1:8899' } });
say('8. REVISION 2  ' + v2.body.url);
say('   previous    ' + v2.body.superseded.status + ' — ' + v2.body.superseded.note);
const oldLink = await call(viewH, { method: 'GET', query: { token: t1 } });
// An ACCEPTED link stays open: the customer must be able to see what they
// agreed to. It is a 'superseded' redirect only when it was never answered.
say('   old link    state=' + oldLink.body.state + ' — '
  + (oldLink.body.redirectToken
      ? 'points at the current revision'
      : 'still readable, and still shows the accepted total $'
        + oldLink.body.presentation.investment.totalIncGst.toFixed(2)
        + ' with no Accept button (canAccept='
        + oldLink.body.presentation.acceptance.canAccept + ')'));
const v2view = await call(viewH, { method: 'GET', query: { token: v2.body.token } });
say('   r2 total    $' + v2view.body.presentation.investment.totalIncGst.toFixed(2)
  + '  (revision 1 was accepted at $' + rec.acceptance.totalIncGst.toFixed(2)
  + ' and has not moved — the +$5,000 reaches the NEW revision only)');
say('   ' + page('5-revision-2', v2view.body));

writeFileSync(OUT + '/transcript.txt', log.join('\n') + '\n');
say('');
say('transcript ' + OUT + '/transcript.txt');
await stop();
process.exit(0);
