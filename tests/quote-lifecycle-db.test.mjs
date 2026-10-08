// ─────────────────────────────────────────────────────────────────────────────
// SAVE → ISSUE → OPEN → CHOOSE → ACCEPT, AGAINST A REAL DATABASE
//
// Every other suite in this repository stubs the REST call. That is how the
// quote workflow shipped with a column name that does not exist: saveDesign
// writes nac_designs.design, and all three quote endpoints asked for a column
// called `data`. Against PostgREST that is a 400 every time, so no quote could
// ever have been issued from the live site — and no test noticed, because no
// test ever asked a database.
//
// This suite runs the real endpoint modules, unmodified, against PostgreSQL
// carrying designer/schema.sql and designer/quote-presentation-schema.sql. The
// only thing standing in is the HTTP layer between them (tests/helpers/pg-rest)
// and Supabase's auth endpoint, which is not a database.
//
// It also proves the thing the review was really about: once a quote is
// issued, editing the design does not change it.
//
// Needs PostgreSQL. Skipped with a clear reason when there is not one, rather
// than passing quietly.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { startRest, reset, sql, row } from './helpers/pg-rest.mjs';
import { buildDemoDesign, nacLogo, DEMO_IMAGES, DEMO_INSTALLATIONS }
  from './fixtures/demo-presentation.mjs';
import { NAC_TRUST } from '../designer/engines/presentation-content.mjs';

const HAVE_PG = existsSync('/usr/lib/postgresql/16/bin/psql');
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** NAC's real Google reviews, read from the file rather than retyped here. */
const GOOGLE_REVIEWS = JSON.parse(
  readFileSync(ROOT + '/designer/content/google-reviews.json', 'utf8')).reviews;

// ── The fixture ──────────────────────────────────────────────────────────────

const DESIGN_ID = 'D-LIFECYCLE-1';
const CUSTOMER = {
  name: 'Sarah Whitlock', email: 'sarah.whitlock@bigpond.com', phone: '0412 665 108',
  address: '12 Boronia Street, Buderim QLD 4556'
};
const SETTINGS = { commercial: { terms: {
  depositPercent: 50, balanceDueEvent: 'completion', validityDays: 30,
  paymentMethods: ['Direct deposit', 'EFT'], termsVersion: 'NAC T&C v1.0 (23 September 2026)',
  confirmed: true, confirmedBy: 'nick@nacelectrical.com.au',
  confirmedAt: '2026-09-23T00:00:00Z'
} } };
const CONTENT = {
  trust: { ...NAC_TRUST, points: ['Every system individually designed for the home'] },
  standardInclusions: { commissioning: true, wasteRemoval: true, wifi: false },
  // ── THE REVIEWS SECTION HAS TO BE IN THE PROOF ─────────────────────────
  //
  // The gap audit row read "Genuine customer reviews — MISSING ENTIRELY", and
  // a lifecycle proof that renders a customer page with no reviews on it does
  // not show whether that is fixed. These are NAC's own, word for word from
  // designer/content/google-reviews.json — the three that do not name Nick,
  // which is the set he asked to be quotable.
  //
  // THE RATING HERE IS TEST DATA. Google's notification emails do not carry
  // the star rating (the stars are an image with no alt text), so the shipped
  // file holds `rating: null` and every one of them is refused by
  // reviewPublishable(). A fixture has to supply one for the section to render
  // at all; it is marked as a fixture value here and it is NOT written back
  // into the library. The real figures come from NAC's Business Profile.
  reviews: GOOGLE_REVIEWS.slice(0, 3).map(r => ({
    ...r, rating: 5, approved: true, _ratingIsFixtureData: true
  })),
  // ── PICTURES ───────────────────────────────────────────────────────────
  //
  // Nick: "and pictures". A proof that renders a customer proposal with no
  // cover image and no gallery does not show whether those work.
  //
  // THE LOGO IS GENUINE — nac-logo.jpg out of the repository root, the same
  // file the live pages use.
  //
  // THE PHOTOGRAPHS ARE NOT. They are the generated fixture images from
  // tests/fixtures/demo-presentation.mjs, and they are here to exercise the
  // gallery, the cover, the focal points and the responsive sizes. NAC's real
  // installation photographs are an outstanding input, listed in the asset
  // request. Nothing in this fixture is written to the live content library,
  // and `approved` on a real review or photograph stays NAC's decision.
  logo: nacLogo(),
  heroImage: (() => {
    const h = DEMO_IMAGES.find(i => i.id === 'hero');
    const big = h.derivatives[h.derivatives.length - 1];
    return { src: big.ref, alt: h.alt, width: big.width, height: big.height,
             srcset: h.derivatives.map(d => ({ ref: d.ref, width: d.width })) };
  })(),
  installations: DEMO_INSTALLATIONS, images: DEMO_IMAGES,
  upgrades: [
    { id: 'at5', title: 'AirTouch 5 smart control', priceIncGst: 1350,
      requires: ['has_zoning'], enabled: true, sortOrder: 1 },
    { id: 'sensor', title: 'Room temperature sensors', unitPriceIncGst: 110,
      unitLabel: 'each', maxQuantity: 6, requires: ['has_zoning'], enabled: true, sortOrder: 2 }
  ]
};

/** A request/response pair shaped like the platform's. */
function call(handler, { method = 'GET', query = {}, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, payload: null,
      setHeader() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.payload = o; resolve({ status: this.statusCode, body: o }); return this; },
      send(o) { return this.json(o); },
      end(o) { return this.json(o ?? null); }
    };
    Promise.resolve(handler({ method, query, body, headers }, res)).catch((e) => {
      resolve({ status: 500, body: { error: 'threw', message: String(e && e.message) } });
    });
  });
}

const STAFF = { Authorization: 'Bearer test-staff-token' };

async function setup() {
  reset();
  process.env.SUPABASE_KEY = 'test-service-key';

  // Supabase's AUTH endpoint is not the database. It is the one thing stood in
  // for here, and only so the issue endpoint sees a signed-in estimator.
  globalThis.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'u1', email: 'nick@nacelectrical.com.au' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const built = await buildDemoDesign();
  // This fixture's main C feeds five outlets, and with the four fittings NAC
  // have specified a ø400 main reaches three — so the quote gate refuses it,
  // correctly. That refusal is tested properly in tests/fitting-assembly and
  // is not what this suite is about, which is the database, the frozen offer
  // and the acceptance record. The design stands in for one whose mains have
  // been split to suit the parts list; faking it here hides nothing, because
  // the real check fails loudly in its own file.
  const BUILDABLE = { ok: true, rows: [], unbuildable: [], partsCost: null,
                      summary: 'Stood in for by the lifecycle fixture.' };
  const design = { ...built.out, fittingAssembly: BUILDABLE,
                   id: DESIGN_ID, designId: DESIGN_ID, customer: CUSTOMER };

  // ── SAVE, the way designer/engines/store.mjs saveDesign saves ────────────
  // Same table, same columns, same JSON-string payload.
  const payload = { ...design, updatedAt: '2026-09-24T01:00:00Z' };
  sql("insert into public.nac_designs (id, customer_name, customer_address, status, design, updated_at) "
    + "values ('" + DESIGN_ID + "', 'Sarah Whitlock', '12 Boronia Street, Buderim QLD 4556', "
    + "'draft', $nacjson$" + JSON.stringify(payload).replace(/\$nacjson\$/g, '') + "$nacjson$, "
    + "'2026-09-24T01:00:00Z')");

  sql("insert into public.nac_presentation_content (key, data, updated_at) values "
    + "('library', $nacjson$" + JSON.stringify(CONTENT) + "$nacjson$::jsonb, '2026-09-24T01:00:00Z')");
  sql("insert into public.nac_settings (key, value, updated_at) values "
    + "('nac_hvac_settings_v1', $nacjson$" + JSON.stringify(SETTINGS) + "$nacjson$, "
    + "'2026-09-24T01:00:00Z')");

  const unit = design.selectedUnit || {};
  const sell = Number(design.commercials?.sellPriceIncGst) || 0;
  const systemOptions = [
    { id: 'sys-a', brand: unit.brandName || 'Daikin', model: unit.model || 'FDYAN160AV1',
      brandId: unit.brandId || 'daikin', capacityKw: unit.capacityKw || 16,
      phase: unit.phase || '1Ph', priceIncGst: sell, recommended: true },
    { id: 'sys-b', brand: 'Braemar', brandId: 'braemar', model: 'KDHV160D1S',
      capacityKw: 16.3, phase: '1Ph', priceIncGst: Math.round((sell - 1474) * 100) / 100,
      warrantyYears: 7 }
  ];
  return { design, systemOptions, sell };
}

// ── The contract between the client and the column ───────────────────────────

test('saveDesign and the endpoints name the same column', { skip: !HAVE_PG && 'needs PostgreSQL' },
  () => {
    const store = readFileSync(ROOT + '/designer/engines/store.mjs', 'utf8');
    assert.match(store, /design:\s*json/, 'saveDesign no longer writes the `design` column');
    assert.match(store, /nac_designs\?id=eq\.'\s*\+\s*encodeURIComponent\(id\)\s*\+\s*'&select=design/,
      'loadDesign no longer reads the `design` column');

    for (const f of ['quote-issue.js', 'quote-view.js', 'quote-respond.js']) {
      const src = readFileSync(ROOT + '/server/' + f, 'utf8');
      assert.ok(!/nac_designs\?[^']*select=data/.test(src),
        f + ' still asks nac_designs for a `data` column, which does not exist');
    }
  });

test('the database really would reject the old column', { skip: !HAVE_PG && 'needs PostgreSQL' },
  async () => {
    // The proof that this is not a hypothetical: the schema has no `data`.
    await setup();
    assert.throws(() => sql('select data from public.nac_designs limit 1'),
      /column "data" does not exist/,
      'the test database is not carrying the real schema');
    // And the column the code now uses is there, and is text.
    const col = row("select data_type from information_schema.columns "
      + "where table_name='nac_designs' and column_name='design'");
    assert.equal(col.data_type, 'text');
  });

// ── The whole path ───────────────────────────────────────────────────────────

test('save → issue → open → choose → accept, against PostgreSQL',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { systemOptions, sell } = await setup();

    const issueHandler = (await import('../server/quote-issue.js')).default
      || require('../server/quote-issue.js');
    const viewHandler = (await import('../server/quote-view.js')).default;
    const respondHandler = (await import('../server/quote-respond.js')).default;

    // ── ISSUE ────────────────────────────────────────────────────────────
    const issued = await call(issueHandler, {
      method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER,
              job: { siteAddress: CUSTOMER.address },
              proposalNumber: 'NAC-TEST-0001', quoteRevision: 1, validDays: 30,
              systemOptions, chosenSystemId: 'sys-a' }
    });
    assert.equal(issued.status, 200, 'issue failed: ' + JSON.stringify(issued.body));
    const token = issued.body.token;
    assert.ok(token && token.length >= 32, 'no usable token');

    // It is really in the database, and it really carries a frozen offer.
    const stored = row("select token, status, quote_rev, data from public.nac_quote_issues "
      + "where token = '" + token + "'");
    assert.equal(stored.status, 'issued');
    assert.equal(stored.data.offer.schema, 'nac.offer.v1');
    assert.deepEqual(stored.data.offer.systemIds.sort(), ['sys-a', 'sys-b']);
    assert.equal(stored.data.offer.source.designId, DESIGN_ID);

    // ── OPEN ─────────────────────────────────────────────────────────────
    const opened = await call(viewHandler, { method: 'GET', query: { token } });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.state, 'ok');
    const p = opened.body.presentation;
    assert.equal(p.systemChoice.chosenId, 'sys-a');
    assert.equal(p.investment.totalIncGst, sell, 'the opened price is not the issued price');
    assert.equal(p.investment.optionsTotal, null, 'nothing was chosen yet');
    assert.equal(p.hero.customerName, 'Sarah Whitlock');

    // The view was recorded.
    const afterView = row("select data from public.nac_quote_issues where token = '" + token + "'");
    assert.equal(afterView.data.viewCount, 1);
    assert.ok(afterView.data.firstViewedAt);

    // ── CHOOSE: the other system, plus a flat upgrade and four sensors ───
    const chose = await call(respondHandler, {
      method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-b',
              selectedOptionIds: ['at5', { id: 'sensor', quantity: 4 }] }
    });
    assert.equal(chose.status, 200, JSON.stringify(chose.body));
    const expectedB = Math.round((sell - 1474 + 1350 + 4 * 110) * 100) / 100;
    assert.equal(chose.body.totalIncGst, expectedB);
    assert.equal(chose.body.chosenSystemId, 'sys-b');
    assert.equal(chose.body.deposit.percent, 50);
    assert.equal(chose.body.deposit.amount, Math.round(expectedB * 50) / 100);

    // Re-opening shows exactly that.
    const reopened = await call(viewHandler, { method: 'GET', query: { token } });
    assert.equal(reopened.body.presentation.investment.totalIncGst, expectedB);
    assert.equal(reopened.body.presentation.systemChoice.chosenId, 'sys-b');
    const sensorLine = reopened.body.presentation.investment.selectedOptions
      .find(o => o.id === 'sensor');
    assert.equal(sensorLine.quantity, 4);
    assert.equal(sensorLine.priceIncGst, 440);

    // A quantity past the maximum is the maximum, decided by the server.
    const greedy = await call(respondHandler, {
      method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-b',
              selectedOptionIds: [{ id: 'sensor', quantity: 99 }] }
    });
    assert.equal(greedy.body.totalIncGst,
      Math.round((sell - 1474 + 6 * 110) * 100) / 100, 'the clamp did not hold');

    // Put the real selection back.
    await call(respondHandler, {
      method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-b',
              selectedOptionIds: ['at5', { id: 'sensor', quantity: 4 }] }
    });

    // ── ACCEPT ───────────────────────────────────────────────────────────
    const accepted = await call(respondHandler, {
      method: 'POST',
      body: { token, action: 'accept', customerName: 'Sarah Whitlock',
              acknowledgedTerms: true }
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.status, 'accepted');
    assert.equal(accepted.body.acceptedTotal, expectedB,
      'the accepted total is not the total the customer was shown');

    // ── THE RECORD ───────────────────────────────────────────────────────
    const rec = row("select status, responded_at, data from public.nac_quote_issues "
      + "where token = '" + token + "'");
    assert.equal(rec.status, 'accepted');
    assert.ok(rec.responded_at, 'responded_at was not written to its own column');
    const acc = rec.data.acceptance;
    assert.equal(acc.customerName, 'Sarah Whitlock');
    assert.equal(acc.acknowledgedTerms, true);
    assert.equal(acc.totalIncGst, expectedB);
    assert.equal(acc.chosenSystemId, 'sys-b');
    assert.equal(acc.quoteRevision, 1);
    assert.equal(acc.offerFrozenAt, rec.data.offer.frozenAt);
    assert.deepEqual(acc.selectedOptionIds.sort(), ['at5', 'sensor']);
    assert.equal(acc.selectedOptions.find(o => o.id === 'sensor').quantity, 4);
    assert.ok(rec.data.audit.some(a => a.event === 'accepted'));

    // An accepted quote cannot be re-answered, or quietly re-priced.
    const again = await call(respondHandler, {
      method: 'POST', body: { token, action: 'options', selectedOptionIds: [] } });
    assert.equal(again.status, 409);
    assert.equal(again.body.needsNewRevision, true);

    // And the page says so. The frozen document was built before anyone had
    // answered it, so its own acceptance block would offer the button forever;
    // the issue's state is applied over the top.
    const afterAccept = await call(viewHandler, { method: 'GET', query: { token } });
    assert.equal(afterAccept.status, 200);
    const acceptance = afterAccept.body.presentation.acceptance;
    assert.equal(acceptance.accepted, true);
    assert.equal(acceptance.canAccept, false, 'an accepted proposal still offered Accept');
    assert.equal(acceptance.acceptedBy, 'Sarah Whitlock');
    assert.equal(acceptance.acceptedTotalIncGst, expectedB);
  });

// ── The point of the whole exercise ──────────────────────────────────────────

test('editing the design after issue does not change the issued quote',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { design, systemOptions, sell } = await setup();

    const issueHandler = (await import('../server/quote-issue.js')).default;
    const viewHandler = (await import('../server/quote-view.js')).default;
    const respondHandler = (await import('../server/quote-respond.js')).default;

    const issued = await call(issueHandler, {
      method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: { siteAddress: CUSTOMER.address },
              proposalNumber: 'NAC-TEST-0002', quoteRevision: 1, validDays: 30,
              systemOptions, chosenSystemId: 'sys-a' }
    });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const token = issued.body.token;

    const before = await call(viewHandler, { method: 'GET', query: { token } });
    const wasTotal = before.body.presentation.investment.totalIncGst;
    const wasRooms = before.body.presentation.coverage.rooms.length;
    const wasSystem = before.body.presentation.system.indoorModel;
    assert.equal(wasTotal, sell);

    // ── NOW EDIT THE DESIGN, HARD ────────────────────────────────────────
    // A different price, a room removed, a different unit. Everything a
    // re-quote would change.
    const edited = JSON.parse(JSON.stringify(design));
    edited.commercials = { ...(edited.commercials || {}),
      sellPriceIncGst: sell + 5000, sellPriceExGst: (sell + 5000) / 1.1 };
    edited.rooms = (edited.rooms || []).slice(0, Math.max(1, (edited.rooms || []).length - 2));
    if (edited.selectedUnit) edited.selectedUnit = { ...edited.selectedUnit, model: 'CHANGED-MODEL' };
    edited.updatedAt = '2026-10-01T00:00:00Z';
    sql("update public.nac_designs set design = $nacjson$"
      + JSON.stringify(edited).replace(/\$nacjson\$/g, '') + "$nacjson$, "
      + "updated_at = '2026-10-01T00:00:00Z' where id = '" + DESIGN_ID + "'");

    // And change the content library and the commercial terms too.
    sql("update public.nac_presentation_content set data = jsonb_set(data, '{trust,businessName}', "
      + "'\"SOMETHING ELSE ENTIRELY\"') where key = 'library'");
    sql("update public.nac_settings set value = $nacjson$"
      + JSON.stringify({ commercial: { terms: { ...SETTINGS.commercial.terms, depositPercent: 90 } } })
      + "$nacjson$ where key = 'nac_hvac_settings_v1'");

    // The design really did change underneath it.
    const check = row("select design from public.nac_designs where id = '" + DESIGN_ID + "'");
    assert.equal(JSON.parse(check.design).commercials.sellPriceIncGst, sell + 5000);

    // ── THE CUSTOMER'S PAGE IS UNMOVED ───────────────────────────────────
    const after = await call(viewHandler, { method: 'GET', query: { token } });
    assert.equal(after.status, 200, JSON.stringify(after.body));
    assert.equal(after.body.presentation.investment.totalIncGst, wasTotal,
      'the price on an issued quote moved when the design was edited');
    assert.equal(after.body.presentation.coverage.rooms.length, wasRooms,
      'rooms were removed from a quote that had already gone out');
    assert.equal(after.body.presentation.system.indoorModel, wasSystem,
      'the customer was shown a different unit than the one they were quoted');
    assert.equal(after.body.presentation.brand.name, 'NAC Electrical Air & Refrigeration',
      'the content library reached an issued quote');
    assert.equal(after.body.presentation.investment.deposit.percent, 50,
      'a settings change moved the deposit on an issued quote');

    // ── AND SO IS THE PRICE THEY ACCEPT ──────────────────────────────────
    const accepted = await call(respondHandler, {
      method: 'POST',
      body: { token, action: 'accept', customerName: 'Sarah Whitlock', acknowledgedTerms: true }
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.acceptedTotal, wasTotal,
      'NAC would have been held to a price the customer never saw');

    const rec = row("select data from public.nac_quote_issues where token = '" + token + "'");
    assert.equal(rec.data.acceptance.totalIncGst, wasTotal);
    assert.equal(rec.data.offer.source.designUpdatedAt, '2026-09-24T01:00:00+00:00',
      'the offer should still name the design revision it was built from');
  });

test('a quote issued before offers were frozen is refused, not rebuilt',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    // The honest answer for a legacy row: it cannot be shown, because showing
    // it would mean rebuilding it from today's numbers under that day's date.
    const stop = await startRest();
    t.after(() => stop());
    await setup();
    const viewHandler = (await import('../server/quote-view.js')).default;

    const legacy = { schema: 'nac.quote.issue.v1', token: 'L'.repeat(43),
      designId: DESIGN_ID, quoteRevision: 1, status: 'issued',
      issuedAt: '2026-09-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
      viewCount: 0, selectedOptionIds: [], audit: [] };
    sql("insert into public.nac_quote_issues (token, design_id, quote_rev, status, issued_at, "
      + "expires_at, data, updated_at) values ('" + legacy.token + "', '" + DESIGN_ID
      + "', 1, 'issued', '2026-09-01', '2099-01-01', $nacjson$" + JSON.stringify(legacy)
      + "$nacjson$::jsonb, now())");

    const opened = await call(viewHandler, { method: 'GET', query: { token: legacy.token } });
    assert.equal(opened.status, 409);
    assert.equal(opened.body.state, 'no_issued_copy');
    assert.match(opened.body.message, /new revision/i);
  });

// ─────────────────────────────────────────────────────────────────────────────
// REVISIONS, TAMPERING AND DOUBLE-ANSWERS
//
// supersede() has been in presentation-share.mjs since revisions were designed
// and NOTHING CALLED IT. `supersedes` was written onto the new issue and the
// old link went on serving its own offer as current — two live links to the
// same job at two different prices, either of which could be accepted.
//
// These run the real endpoints against PostgreSQL, because a revision chain
// that only holds in a unit test is a revision chain that does not hold.
// ─────────────────────────────────────────────────────────────────────────────

test('a new revision closes the old link and keeps its record',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const { systemOptions } = await setup();
    const issueHandler = (await import('../server/quote-issue.js')).default;
    const viewHandler = (await import('../server/quote-view.js')).default;
    const respondHandler = (await import('../server/quote-respond.js')).default;

    const issue = (rev, supersedes) => call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: { siteAddress: CUSTOMER.address },
              proposalNumber: 'NAC-TEST-REV', quoteRevision: rev, validDays: 30,
              systemOptions, chosenSystemId: 'sys-a', supersedes: supersedes || null } });

    const v1 = await issue(1, null);
    assert.equal(v1.status, 200, JSON.stringify(v1.body));
    const t1 = v1.body.token;

    // The customer opens r1 and picks an upgrade, so there is state to preserve.
    await call(viewHandler, { method: 'GET', query: { token: t1 } });
    await call(respondHandler, { method: 'POST',
      body: { token: t1, action: 'options', selectedOptionIds: ['at5'] } });

    // ── REVISION 2 ───────────────────────────────────────────────────────
    const v2 = await issue(2, t1);
    assert.equal(v2.status, 200, JSON.stringify(v2.body));
    const t2 = v2.body.token;
    assert.notEqual(t2, t1, 'a new revision must get its own link');
    assert.equal(v2.body.superseded.token, t1);
    assert.equal(v2.body.superseded.ok, true);
    assert.equal(v2.body.superseded.status, 'superseded');

    // The OLD row really changed in the database — column and record together.
    const old = row("select status, data from public.nac_quote_issues where token = '" + t1 + "'");
    assert.equal(old.status, 'superseded', 'the status column was not updated');
    assert.equal(old.data.status, 'superseded');
    assert.equal(old.data.supersededBy, t2);
    // And nothing about what was offered was touched.
    assert.ok(old.data.offer, 'the archived revision lost its offer');
    assert.deepEqual(old.data.selectedOptionIds, ['at5'],
      'the archived revision lost the customer\'s selection');
    assert.ok(old.data.audit.some(a => a.event === 'superseded'));

    // The new one points back.
    const fresh = row("select data from public.nac_quote_issues where token = '" + t2 + "'");
    assert.equal(fresh.data.supersedes, t1);
    assert.equal(fresh.data.quoteRevision, 2);

    // ── THE OLD LINK ─────────────────────────────────────────────────────
    // Not an error. The customer followed a link they were legitimately sent,
    // and is pointed at the current one.
    const openedOld = await call(viewHandler, { method: 'GET', query: { token: t1 } });
    assert.equal(openedOld.status, 200);
    assert.equal(openedOld.body.state, 'superseded');
    assert.equal(openedOld.body.redirectToken, t2);

    // And it cannot be answered.
    const answerOld = await call(respondHandler, { method: 'POST',
      body: { token: t1, action: 'accept', customerName: 'Sarah Whitlock',
              acknowledgedTerms: true } });
    assert.equal(answerOld.status, 409);
    assert.equal(answerOld.body.state, 'superseded');

    // The current one works.
    const openedNew = await call(viewHandler, { method: 'GET', query: { token: t2 } });
    assert.equal(openedNew.status, 200);
    assert.equal(openedNew.body.state, 'ok');
    assert.equal(openedNew.body.offer.quoteRevision, 2);
  });

test('an accepted revision is never relabelled by a later one',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const { systemOptions } = await setup();
    const issueHandler = (await import('../server/quote-issue.js')).default;
    const viewHandler = (await import('../server/quote-view.js')).default;
    const respondHandler = (await import('../server/quote-respond.js')).default;

    const v1 = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {}, proposalNumber: 'NAC-TEST-ACC',
              quoteRevision: 1, validDays: 30, systemOptions, chosenSystemId: 'sys-a' } });
    const t1 = v1.body.token;
    await call(viewHandler, { method: 'GET', query: { token: t1 } });
    const accepted = await call(respondHandler, { method: 'POST',
      body: { token: t1, action: 'accept', customerName: 'Sarah Whitlock',
              acknowledgedTerms: true } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const acceptedTotal = accepted.body.acceptedTotal;

    // NAC issues a corrected revision afterwards.
    const v2 = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {}, proposalNumber: 'NAC-TEST-ACC',
              quoteRevision: 2, validDays: 30, systemOptions, chosenSystemId: 'sys-b',
              supersedes: t1 } });
    assert.equal(v2.status, 200);
    assert.equal(v2.body.superseded.status, 'accepted',
      'an accepted quote was relabelled as superseded');
    assert.match(v2.body.superseded.note, /already been accepted/i);

    // The signed record is exactly as it was signed.
    const signed = row("select status, data from public.nac_quote_issues where token = '" + t1 + "'");
    assert.equal(signed.status, 'accepted');
    assert.equal(signed.data.acceptance.totalIncGst, acceptedTotal);
    assert.equal(signed.data.acceptance.customerName, 'Sarah Whitlock');
    assert.equal(signed.data.supersededBy, v2.body.token);
  });

test('a stale page cannot answer a replaced offer, or a total it is not showing',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const { systemOptions, sell } = await setup();
    const issueHandler = (await import('../server/quote-issue.js')).default;
    const viewHandler = (await import('../server/quote-view.js')).default;
    const respondHandler = (await import('../server/quote-respond.js')).default;

    const v1 = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {}, proposalNumber: 'NAC-TEST-TAMPER',
              quoteRevision: 3, validDays: 30, systemOptions, chosenSystemId: 'sys-a' } });
    const token = v1.body.token;
    const opened = await call(viewHandler, { method: 'GET', query: { token } });
    const stamp = opened.body.offer;
    assert.equal(stamp.quoteRevision, 3);
    assert.ok(stamp.frozenAt, 'the page is not told which copy it is showing');

    // A page that thinks it is on an older revision is told to reload.
    const wrongRev = await call(respondHandler, { method: 'POST',
      body: { token, action: 'accept', customerName: 'Sarah Whitlock', acknowledgedTerms: true,
              quoteRevision: 2 } });
    assert.equal(wrongRev.status, 409);
    assert.equal(wrongRev.body.state, 'revision_mismatch');
    assert.equal(wrongRev.body.quoteRevision, 3);

    // A page built from a different frozen copy, likewise.
    const wrongCopy = await call(respondHandler, { method: 'POST',
      body: { token, action: 'accept', customerName: 'Sarah Whitlock', acknowledgedTerms: true,
              offerFrozenAt: '2020-01-01T00:00:00.000Z' } });
    assert.equal(wrongCopy.status, 409);
    assert.equal(wrongCopy.body.state, 'offer_mismatch');

    // A page showing a total that is not the server's total does not get to
    // record an acceptance against either figure.
    const wrongTotal = await call(respondHandler, { method: 'POST',
      body: { token, action: 'accept', customerName: 'Sarah Whitlock', acknowledgedTerms: true,
              expectedTotalIncGst: 1 } });
    assert.equal(wrongTotal.status, 409);
    assert.equal(wrongTotal.body.state, 'total_mismatch');
    assert.equal(wrongTotal.body.totalIncGst, sell);

    // Nothing above was recorded.
    const untouched = row("select status, data from public.nac_quote_issues where token = '"
      + token + "'");
    assert.notEqual(untouched.status, 'accepted');
    assert.equal(untouched.data.acceptance, null);

    // The honest page — right revision, right copy, right total — is accepted.
    const good = await call(respondHandler, { method: 'POST',
      body: { token, action: 'accept', customerName: 'Sarah Whitlock', acknowledgedTerms: true,
              quoteRevision: stamp.quoteRevision, offerFrozenAt: stamp.frozenAt,
              expectedTotalIncGst: sell } });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal(good.body.acceptedTotal, sell);
  });

test('pressing accept twice is one acceptance; a different answer is refused',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const { systemOptions, sell } = await setup();
    const issueHandler = (await import('../server/quote-issue.js')).default;
    const viewHandler = (await import('../server/quote-view.js')).default;
    const respondHandler = (await import('../server/quote-respond.js')).default;

    const v = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {}, proposalNumber: 'NAC-TEST-TWICE',
              quoteRevision: 1, validDays: 30, systemOptions, chosenSystemId: 'sys-a' } });
    const token = v.body.token;
    await call(viewHandler, { method: 'GET', query: { token } });

    const body = { token, action: 'accept', customerName: 'Sarah Whitlock',
                   acknowledgedTerms: true };
    const first = await call(respondHandler, { method: 'POST', body });
    assert.equal(first.status, 200);
    assert.equal(first.body.acceptedTotal, sell);
    const acceptedAt = row("select data from public.nac_quote_issues where token = '" + token
      + "'").data.acceptance.acceptedAt;

    // The reply was lost and the customer pressed it again. That is one
    // acceptance, not two, and not an error either.
    const again = await call(respondHandler, { method: 'POST', body });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.repeat, true);
    assert.equal(again.body.acceptedTotal, sell);

    // And the record did not move.
    const after = row("select data from public.nac_quote_issues where token = '" + token + "'");
    assert.equal(after.data.acceptance.acceptedAt, acceptedAt,
      'a replay rewrote the acceptance timestamp');

    // A DIFFERENT answer to a signed contract is refused.
    const other = await call(respondHandler, { method: 'POST',
      body: { ...body, customerName: 'Someone Else' } });
    assert.equal(other.status, 409);
    assert.equal(other.body.state, 'already_answered');
    assert.equal(other.body.needsNewRevision, true);

    // Changing the system after acceptance is refused too, and says why.
    const switched = await call(respondHandler, { method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-b' } });
    assert.equal(switched.status, 409);
    assert.equal(switched.body.state, 'requires_new_revision');

    const final = row("select status, data from public.nac_quote_issues where token = '"
      + token + "'");
    assert.equal(final.data.acceptance.customerName, 'Sarah Whitlock');
    assert.equal(final.data.chosenSystemId, 'sys-a');
  });

test('the GST on the record is the GST that was configured',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest(); t.after(() => stop());
    const { systemOptions, sell } = await setup();
    const issueHandler = (await import('../server/quote-issue.js')).default;
    const viewHandler = (await import('../server/quote-view.js')).default;

    const v = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {}, proposalNumber: 'NAC-TEST-GST',
              quoteRevision: 1, validDays: 30, systemOptions, chosenSystemId: 'sys-a' } });
    assert.equal(v.status, 200);
    // Frozen WITH the offer, so a later change to the setting cannot restate
    // an issued quote's tax.
    assert.equal(v.body.gstRate, 0.1);
    const stored = row("select data from public.nac_quote_issues where token = '"
      + v.body.token + "'");
    assert.equal(stored.data.offer.gstRate, 0.1);

    // The three figures reconcile on the customer's page, to the cent.
    const opened = await call(viewHandler, { method: 'GET', query: { token: v.body.token } });
    const inv = opened.body.presentation.investment;
    assert.equal(inv.totalIncGst, sell);
    assert.equal(Math.round((inv.subtotalExGst + inv.gst) * 100) / 100, sell,
      'ex-GST plus GST does not come to the total shown');
    assert.equal(inv.gst, Math.round((sell - sell / 1.1) * 100) / 100);
    assert.equal(opened.body.offer.gstRate, 0.1);
  });

test('the customer page carries NAC\'s reviews, word for word',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    // Nick: "i like the quote lifecycle proof, needs reviews". The gap audit
    // row was "Genuine customer reviews — MISSING ENTIRELY", and a lifecycle
    // proof whose customer page has no reviews on it cannot show that closed.
    const stop = await startRest(); t.after(() => stop());
    const { systemOptions } = await setup();
    const issueHandler = (await import('../server/quote-issue.js')).default;
    const viewHandler = (await import('../server/quote-view.js')).default;

    const v = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {}, proposalNumber: 'NAC-TEST-REVIEWS',
              quoteRevision: 1, validDays: 30, systemOptions, chosenSystemId: 'sys-a' } });
    const opened = await call(viewHandler, { method: 'GET', query: { token: v.body.token } });
    const reviews = opened.body.presentation.reviews;

    assert.equal(reviews.length, 3, 'the reviews section did not reach the customer page');
    for (let i = 0; i < 3; i++) {
      // Byte equality against designer/content/google-reviews.json. Not
      // reworded, not shortened, not ellipsised on the way through the
      // database and the frozen offer.
      assert.equal(reviews[i].text, GOOGLE_REVIEWS[i].text, reviews[i].id + ' was altered');
      assert.equal(reviews[i].name, GOOGLE_REVIEWS[i].displayName);
      assert.equal(reviews[i].source, 'google');
    }
    // Not one of them names Nick — the set he asked to be quotable.
    for (const r of reviews) assert.ok(!/\bNick\b/.test(r.text), r.id + ' names Nick');

    // And they are frozen with the offer: rewriting the library afterwards
    // does not change a quote that has gone out.
    sql("update public.nac_presentation_content set data = jsonb_set(data, '{reviews}', '[]'::jsonb) "
      + "where key = 'library'");
    const again = await call(viewHandler, { method: 'GET', query: { token: v.body.token } });
    assert.equal(again.body.presentation.reviews.length, 3,
      'deleting the library reviews changed a quote that was already issued');
  });

test('a screen holding a stale price cannot issue it',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    // buildPresentation prefers the system options in the REQUEST over the
    // saved design, so the price a customer is quoted for the designed unit
    // comes off the estimator's screen and the design is never consulted. A
    // tab left open while the job was recosted issues the old number.
    const stop = await startRest(); t.after(() => stop());
    const { systemOptions, sell } = await setup();
    const issueHandler = (await import('../server/quote-issue.js')).default;

    const stale = systemOptions.map(o => o.id === 'sys-a'
      ? { ...o, priceIncGst: sell - 2500 } : o);
    const refused = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {},
              proposalNumber: 'NAC-TEST-STALE', quoteRevision: 1, validDays: 30,
              systemOptions: stale, chosenSystemId: 'sys-a' } });

    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'price_mismatch');
    assert.equal(refused.body.screenPriceIncGst, Math.round((sell - 2500) * 100) / 100);
    assert.equal(refused.body.designPriceIncGst, sell);
    // Neither figure was chosen for the estimator, and nothing was issued.
    assert.equal(row('select count(*)::int c from public.nac_quote_issues').c, 0);

    // The ALTERNATIVE system is the estimator's to price — it is a different
    // machine, and the design has no figure to check it against.
    const otherPrice = systemOptions.map(o => o.id === 'sys-b'
      ? { ...o, priceIncGst: 12345 } : o);
    const issued = await call(issueHandler, { method: 'POST', headers: STAFF,
      body: { designId: DESIGN_ID, customer: CUSTOMER, job: {},
              proposalNumber: 'NAC-TEST-ALT', quoteRevision: 1, validDays: 30,
              systemOptions: otherPrice, chosenSystemId: 'sys-a' } });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
  });
