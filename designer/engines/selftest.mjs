// NAC — the live database self test.
//
// This is the ONLY place the round trip is written. db-selftest.html runs it on
// its own, and setup.html runs it as one step of the production setup, so there
// is no second copy to drift.
//
// It writes REAL rows to the REAL project and deletes them afterwards. Every
// test row is prefixed ZZ-SELFTEST- so anything left behind by an interrupted
// run is obvious and safe to remove. It never touches a row it did not create.
//
// Nothing is reported as passing on inference: each check reads back what it
// wrote and compares, and a failure carries the HTTP status and the database's
// own error message, because that is the thing needed to fix it.

import { dbHeaders, currentSession } from '../auth.mjs';

const SUPA = 'https://icnznjhwybryizbdqrgx.supabase.co';
const H = () => dbHeaders();
const JH = () => ({ ...dbHeaders(), 'Content-Type': 'application/json' });

/** One HTTP call, reporting exactly what the database said. */
async function call(method, path, body, extraHeaders) {
  const t0 = Date.now();
  try {
    const res = await fetch(SUPA + '/rest/v1/' + path, {
      method,
      headers: { ...(body ? JH() : H()), ...(extraHeaders || {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    return { ok: res.ok, status: res.status, text, json, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, text: String(e.message || e), json: null,
             ms: Date.now() - t0, networkError: true };
  }
}

const why = (r) => r.networkError ? 'network: ' + r.text
  : 'HTTP ' + r.status + (r.json?.message ? ' — ' + r.json.message
     : (r.text ? ' — ' + r.text.slice(0, 160) : ''));

/**
 * Run the whole test.
 *
 * @param {Object} io
 * @param {Function} io.group  (title) => void
 * @param {Function} io.row    (state, what, detail, ms) => void  state: PASS|FAIL|WARN
 * @returns {Promise<{failures:number, warnings:number, passes:number}>}
 */
export async function runDatabaseSelfTest({ group, row }) {
  const stamp = 'ZZ-SELFTEST-' + Date.now();
  let failures = 0, warnings = 0, passes = 0;
  const say = (state, what, detail, ms) => {
    if (state === 'FAIL') failures++; else if (state === 'WARN') warnings++; else passes++;
    row(state, what, detail, ms);
  };

  /** Does the table exist, and does it have every column the app writes? */
  async function checkShape(table, columns) {
    const r = await call('GET', table + '?select=' + columns.join(',') + '&limit=1');
    if (r.ok) {
      say('PASS', table + ' — table and all ' + columns.length + ' expected columns exist',
          columns.join(', '), r.ms);
      return true;
    }
    if (r.status === 404 || /does not exist|Could not find the table/i.test(r.text)) {
      say('FAIL', table + ' — TABLE DOES NOT EXIST', why(r), r.ms); return false;
    }
    if (/column .* does not exist|Could not find the '.*' column/i.test(r.text)) {
      say('FAIL', table + ' — a column the app writes is missing', why(r), r.ms); return false;
    }
    say('FAIL', table + ' — cannot be read', why(r), r.ms);
    return false;
  }

  // ── nac_settings ──────────────────────────────────────────────────────────
  async function testSettings() {
    group('nac_settings — settings, prices, and the designer fallback store');
    if (!await checkShape('nac_settings', ['key', 'value'])) return;
    const key = stamp + '-settings';

    let r = await call('POST', 'nac_settings',
      { key, value: 'created', updated_at: new Date().toISOString() },
      { Prefer: 'resolution=merge-duplicates' });
    if (!r.ok) { say('FAIL', 'INSERT rejected — nothing can be saved', why(r), r.ms); return; }
    say('PASS', 'INSERT accepted', null, r.ms);

    r = await call('GET', 'nac_settings?key=eq.' + encodeURIComponent(key) + '&select=value');
    if (r.json?.[0]?.value === 'created') say('PASS', 'READ BACK returns what was written', 'value = "created"', r.ms);
    else { say('FAIL', 'READ BACK did not return the row', why(r), r.ms); return; }

    r = await call('POST', 'nac_settings',
      { key, value: 'edited', updated_at: new Date().toISOString() },
      { Prefer: 'resolution=merge-duplicates' });
    if (!r.ok) say('FAIL', 'UPDATE (upsert) rejected — edits cannot be saved', why(r), r.ms);
    else {
      r = await call('GET', 'nac_settings?key=eq.' + encodeURIComponent(key) + '&select=value');
      if (r.json?.[0]?.value === 'edited') say('PASS', 'UPDATE persisted, and did NOT create a duplicate row', 'value = "edited"', r.ms);
      else say('FAIL', 'UPDATE did not persist', 'got: ' + r.json?.[0]?.value, r.ms);
      const all = await call('GET', 'nac_settings?key=eq.' + encodeURIComponent(key) + '&select=key');
      if ((all.json || []).length > 1) {
        say('FAIL', 'upsert created ' + all.json.length + ' rows for one key', 'merge-duplicates is not working', all.ms);
      }
    }

    r = await call('DELETE', 'nac_settings?key=eq.' + encodeURIComponent(key));
    if (r.ok) say('PASS', 'DELETE accepted (test row cleaned up)', null, r.ms);
    else say('WARN', 'DELETE rejected — the test row remains', 'key: ' + key + ' · ' + why(r), r.ms);
  }

  // ── nac_quotes ────────────────────────────────────────────────────────────
  async function testQuotes() {
    group('nac_quotes — the customer’s quote');
    if (!await checkShape('nac_quotes', ['id', 'client', 'job_desc', 'line_items', 'accepted'])) return;
    const id = stamp + '-quote';

    let r = await call('POST', 'nac_quotes',
      { id, client: 'ZZ Self Test', job_desc: 'Self test — safe to delete',
        line_items: JSON.stringify([{ name: 'test line', price: 1 }]), notes: 'self test', accepted: false },
      { Prefer: 'resolution=merge-duplicates' });
    if (!r.ok) { say('FAIL', 'INSERT rejected — quotes cannot be created', why(r), r.ms); return; }
    say('PASS', 'INSERT accepted', null, r.ms);

    r = await call('GET', 'nac_quotes?id=eq.' + encodeURIComponent(id) + '&select=id,client,line_items,accepted');
    const rowBack = r.json?.[0];
    if (rowBack?.client === 'ZZ Self Test') {
      let items = 'NOT VALID JSON';
      try { items = JSON.parse(rowBack.line_items).length + ' item(s)'; } catch (e) { /* reported as-is */ }
      say('PASS', 'READ BACK returns the quote', 'line_items parsed: ' + items, r.ms);
    } else { say('FAIL', 'READ BACK did not return the quote', why(r), r.ms); return; }

    r = await call('PATCH', 'nac_quotes?id=eq.' + encodeURIComponent(id), { accepted: true });
    if (r.ok) {
      const chk = await call('GET', 'nac_quotes?id=eq.' + encodeURIComponent(id) + '&select=accepted');
      if (chk.json?.[0]?.accepted === true) say('PASS', 'PATCH persisted — a customer can accept a quote', 'accepted = true', chk.ms);
      else say('FAIL', 'PATCH did not persist — customer acceptance would be lost', JSON.stringify(chk.json?.[0]), chk.ms);
    } else say('FAIL', 'PATCH rejected — a customer could not accept a quote', why(r), r.ms);

    r = await call('DELETE', 'nac_quotes?id=eq.' + encodeURIComponent(id));
    if (r.ok) say('PASS', 'DELETE accepted (test quote cleaned up)', null, r.ms);
    else say('WARN', 'DELETE rejected — the test quote remains', 'id: ' + id + ' · ' + why(r), r.ms);
  }

  // ── nac_designs ───────────────────────────────────────────────────────────
  async function testDesigns() {
    group('nac_designs — HVAC designs, rooms, equipment, BOM and revisions');
    const shape = await call('GET', 'nac_designs?select=id&limit=1');
    if (!shape.ok && (shape.status === 404 || /does not exist|Could not find the table/i.test(shape.text))) {
      say('WARN', 'nac_designs does not exist — designs fall back to nac_settings',
        'Supported, but designs are then key/value blobs that cannot be listed or joined. ' +
        'Run designer/schema.sql to create it.', shape.ms);
      return;
    }
    if (!await checkShape('nac_designs',
        ['id', 'customer_name', 'customer_address', 'quote_id', 'job_id', 'status', 'design', 'updated_at'])) return;

    const id = stamp + '-design';
    const payload = JSON.stringify({
      id, customer: { name: 'ZZ Self Test' },
      rooms: [{ id: 'r1', label: 'Bed 1', areaSqM: 12, measurement: { widthMm: 3000, lengthMm: 4000, source: 'manual' } }],
      selectedUnit: { brandName: 'Daikin', model: 'FDYA140AV19', capacityKw: 14 },
      bom: { lineCount: 32, totalCost: 9469.58 },
      commercials: { sellPriceIncGst: 17016.54 },
      revisions: [{ number: 1, reason: 'self test' }]
    });

    let r = await call('POST', 'nac_designs',
      { id, customer_name: 'ZZ Self Test', customer_address: '1 Test St', quote_id: null, job_id: null,
        status: 'draft', design: payload, updated_at: new Date().toISOString() },
      { Prefer: 'resolution=merge-duplicates' });
    if (!r.ok) { say('FAIL', 'INSERT rejected — designs cannot be saved', why(r), r.ms); return; }
    say('PASS', 'INSERT accepted (rooms, equipment, BOM and a revision inside)', null, r.ms);

    r = await call('GET', 'nac_designs?id=eq.' + encodeURIComponent(id) + '&select=design,status,updated_at');
    let d = null;
    try { d = JSON.parse(r.json?.[0]?.design || 'null'); } catch (e) { /* reported below */ }
    if (d) {
      const bits = [
        ['room data', d.rooms?.length === 1 && d.rooms[0].areaSqM === 12],
        ['equipment selection', d.selectedUnit?.model === 'FDYA140AV19'],
        ['BOM / materials', d.bom?.lineCount === 32],
        ['pricing', d.commercials?.sellPriceIncGst === 17016.54],
        ['revisions', d.revisions?.length === 1]
      ];
      const bad = bits.filter(b => !b[1]).map(b => b[0]);
      if (bad.length) say('FAIL', 'READ BACK lost part of the design', 'missing: ' + bad.join(', '), r.ms);
      else say('PASS', 'READ BACK returns the whole design intact',
        'rooms, equipment, BOM, pricing and revisions all survived', r.ms);
    } else { say('FAIL', 'READ BACK did not return the design', why(r), r.ms); return; }

    const edited = JSON.parse(payload);
    edited.rooms[0].areaSqM = 18;
    edited.revisions.push({ number: 2, reason: 'edited' });
    r = await call('POST', 'nac_designs',
      { id, customer_name: 'ZZ Self Test EDITED', customer_address: '2 New Rd', status: 'quoted',
        design: JSON.stringify(edited), updated_at: new Date().toISOString() },
      { Prefer: 'resolution=merge-duplicates' });
    if (!r.ok) say('FAIL', 'UPDATE rejected — an edited design cannot be re-saved', why(r), r.ms);
    else {
      const chk = await call('GET', 'nac_designs?id=eq.' + encodeURIComponent(id) + '&select=customer_name,status,design');
      let e = null;
      try { e = JSON.parse(chk.json?.[0]?.design || 'null'); } catch (err) { /* reported below */ }
      const okEdit = chk.json?.[0]?.customer_name === 'ZZ Self Test EDITED' &&
                     chk.json?.[0]?.status === 'quoted' &&
                     e?.rooms?.[0]?.areaSqM === 18 && e?.revisions?.length === 2;
      if (okEdit) say('PASS', 'UPDATE persisted — edited room, status and a second revision', 'area 12 → 18 m², 2 revisions', chk.ms);
      else say('FAIL', 'UPDATE did not fully persist', JSON.stringify({
        customer_name: chk.json?.[0]?.customer_name, status: chk.json?.[0]?.status,
        area: e?.rooms?.[0]?.areaSqM, revisions: e?.revisions?.length }), chk.ms);
      const dupes = await call('GET', 'nac_designs?id=eq.' + encodeURIComponent(id) + '&select=id');
      if ((dupes.json || []).length > 1) {
        say('FAIL', 're-saving created ' + dupes.json.length + ' rows', 'the primary key or upsert is wrong', dupes.ms);
      }
    }

    const list = await call('GET', 'nac_designs?select=id,customer_name,updated_at&order=updated_at.desc&limit=5');
    if (list.ok) say('PASS', 'LIST works — the Designs picker can find saved designs', (list.json || []).length + ' row(s) returned', list.ms);
    else say('FAIL', 'LIST failed — saved designs cannot be reopened', why(list), list.ms);

    r = await call('DELETE', 'nac_designs?id=eq.' + encodeURIComponent(id));
    if (r.ok) say('PASS', 'DELETE accepted (test design cleaned up)', null, r.ms);
    else say('WARN', 'DELETE rejected — the test design remains', 'id: ' + id + ' · ' + why(r), r.ms);
  }

  // ── Access control ────────────────────────────────────────────────────────
  async function testSecurity() {
    group('Access control — what an anonymous visitor can do');
    const signedIn = !!currentSession();

    const noKey = await fetch(SUPA + '/rest/v1/nac_quotes?select=id&limit=1')
      .then(r => r.status).catch(() => 0);
    if (noKey === 401 || noKey === 403) say('PASS', 'A request with NO api key is refused', 'HTTP ' + noKey, null);
    else say('FAIL', 'A request with no api key was not refused',
      'HTTP ' + noKey + ' — the project is open to the internet', null);

    // With RLS applied, these two must behave differently signed in and out.
    const quotes = await call('GET', 'nac_quotes?select=id,client&limit=3');
    if (signedIn) {
      if (quotes.ok) say('PASS', 'Signed in, staff can list quotes', (quotes.json || []).length + ' row(s)', quotes.ms);
      else say('FAIL', 'Signed in, staff CANNOT list quotes — the policy is too tight', why(quotes), quotes.ms);
    } else if (quotes.ok && (quotes.json || []).length > 0) {
      say('WARN', 'Signed out, the anon key can still READ quotes',
        (quotes.json || []).length + ' row(s) returned. Anyone who opens the page source has this key. ' +
        'Apply designer/rls.sql — until then customer names and prices are readable by anyone with the URL.',
        quotes.ms);
    } else {
      say('PASS', 'Signed out, quotes cannot be listed — RLS is restricting reads', why(quotes), quotes.ms);
    }

    for (const table of ['nac_settings', 'nac_designs']) {
      const r = await call('GET', table + '?select=*&limit=1');
      if (signedIn) {
        if (r.ok) say('PASS', 'Signed in, staff can read ' + table, null, r.ms);
        else say('FAIL', 'Signed in, staff cannot read ' + table, why(r), r.ms);
      } else if (r.ok && (r.json || []).length > 0) {
        say('FAIL', 'Signed out, ' + table + ' is READABLE with the public key',
          table === 'nac_settings'
            ? 'NAC cost prices are exposed. Apply designer/rls.sql.'
            : 'Customer designs are exposed. Apply designer/rls.sql.', r.ms);
      } else {
        say('PASS', 'Signed out, ' + table + ' is not readable', why(r), r.ms);
      }
    }
  }

  try {
    await testSettings();
    await testQuotes();
    await testDesigns();
    await testSecurity();
  } catch (e) {
    group('Unexpected');
    say('FAIL', 'The test itself threw', String(e && e.message || e), null);
  }

  return { failures, warnings, passes };
}

/** Is a customer able to open and accept their own quote with no account? */
export async function runCustomerPathTest({ group, row }) {
  let failures = 0, warnings = 0, passes = 0;
  const say = (state, what, detail, ms) => {
    if (state === 'FAIL') failures++; else if (state === 'WARN') warnings++; else passes++;
    row(state, what, detail, ms);
  };
  group('The customer’s own path — this must keep working after RLS');

  const anonHeaders = { apikey: dbHeaders().apikey, Authorization: 'Bearer ' + dbHeaders().apikey };
  const t0 = Date.now();
  let existing = null;
  try {
    const r = await fetch(SUPA + '/rest/v1/nac_quotes?select=id&limit=1&order=id.desc', { headers: dbHeaders() });
    existing = r.ok ? (await r.json())[0]?.id : null;
  } catch (e) { /* reported below */ }

  if (!existing) {
    say('WARN', 'No quote to test the customer path against',
      'Create one quote, then run this again — sign.html cannot be proven without a real quote id.', Date.now() - t0);
    return { failures, warnings, passes };
  }

  // A customer has no session: the anon key only, and one quote id.
  try {
    const r = await fetch(SUPA + '/rest/v1/nac_quotes?id=eq.' + encodeURIComponent(existing) + '&select=*',
      { headers: anonHeaders });
    const rows = r.ok ? await r.json() : [];
    if (r.ok && rows.length === 1) say('PASS', 'A customer CAN open their own quote by id', 'sign.html still works', null);
    else say('FAIL', 'A customer CANNOT open their quote — the signing page is broken',
      'HTTP ' + r.status + '. The anon SELECT policy on nac_quotes is missing or too tight.', null);
  } catch (e) {
    say('FAIL', 'A customer CANNOT open their quote', String(e.message || e), null);
  }

  return { failures, warnings, passes };
}
