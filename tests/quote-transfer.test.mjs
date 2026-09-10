// NAC AI HVAC DESIGNER — moving a finished design onto the customer's quote.
//
// The risk here is duplication and loss: pressing the button twice must not
// create two quotes or two sets of line items, and pushing a design onto a
// quote that came from the intake form must not wipe what the customer sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

function stubDb() {
  const rows = new Map();
  const calls = [];
  globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {}
  };
  globalThis.location = globalThis.location || { origin: 'https://nac-quote-tool.vercel.app' };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET' });
    if (u.includes('nac_quotes')) {
      if ((opts.method || 'GET') === 'POST') {
        const b = JSON.parse(opts.body);
        rows.set(b.id, b);                       // merge-duplicates: same id replaces
        return { ok: true, status: 201, json: async () => [], text: async () => '' };
      }
      const m = /id=eq\.([^&]+)/.exec(u);
      const row = m ? rows.get(decodeURIComponent(m[1])) : null;
      return { ok: true, status: 200, json: async () => (row ? [row] : []), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };
  return { rows, calls };
}

const design = (over = {}) => ({
  id: 'NACD-TEST-1', customer: { name: 'Test Customer', address: '1 Test St' },
  job: { description: 'Ducted AC Supply & Install' },
  status: 'draft',
  quoteLineItems: [
    { name: 'Daikin FDYA140AV19 14kW', desc: '14kW ducted reverse cycle', price: 17016.54 }
  ],
  systemLoad: { designKw: 14, totalConditionedAreaSqM: 107 },
  commercials: { sellPriceIncGst: 17016.54, totalJobCost: 9469.58, grossProfit: 6000 },
  bom: { lineCount: 25, totalCost: 9469.58 },
  rooms: [], revisions: [],
  ...over
});

test('a design becomes one quote carrying its line items', async () => {
  const { rows } = stubDb();
  const Store = await import('../designer/engines/store.mjs?t=' + Math.random());
  const r = await Store.pushDesignToQuote(design());
  assert.ok(r.quoteId, 'a quote id must come back');
  assert.equal(rows.size, 1);
  const row = rows.get(r.quoteId);
  assert.equal(row.client, 'Test Customer');
  const items = JSON.parse(row.line_items);
  assert.equal(items.length, 1);
  assert.equal(items[0].price, 17016.54);
  assert.match(r.signUrl, /sign\.html\?q=/);
});

test('pressing it twice does NOT create a second quote or double the items', async () => {
  const { rows } = stubDb();
  const Store = await import('../designer/engines/store.mjs?t=' + Math.random());
  const d = design();
  const first = await Store.pushDesignToQuote(d);
  d.quoteId = first.quoteId;                    // what the app records on success
  const second = await Store.pushDesignToQuote(d);
  assert.equal(second.quoteId, first.quoteId, 'the same quote, not a new one');
  assert.equal(rows.size, 1, 'one row, not two');
  assert.equal(JSON.parse(rows.get(first.quoteId).line_items).length, 1, 'items replaced, not appended');
});

test('re-pushing replaces the design block but keeps what the customer sent', async () => {
  const { rows } = stubDb();
  const Store = await import('../designer/engines/store.mjs?t=' + Math.random());
  // A quote that already exists from the intake form, with the customer's own
  // details and photo links in the notes.
  const CUSTOMER_NOTES = 'INTAKE DRAFT | 0400000000 | 1 Test St\n\nPHOTOS:\nhttps://example/photo1.jpg';
  rows.set('NAC-EXISTING-1', { id: 'NAC-EXISTING-1', notes: CUSTOMER_NOTES, line_items: '[]' });

  const d = design({ quoteId: 'NAC-EXISTING-1' });
  await Store.pushDesignToQuote(d, { quoteId: 'NAC-EXISTING-1' });
  let row = rows.get('NAC-EXISTING-1');
  assert.match(row.notes, /INTAKE DRAFT/, 'the customer intake must survive');
  assert.match(row.notes, /PHOTOS/);
  assert.match(row.notes, /NAC AI HVAC DESIGNER/, 'and the design block is added');

  // Push again — the design block must be replaced, not stacked up. The
  // separator marker is what delimits it, so that is what gets counted.
  const MARK = '--- NAC AI HVAC DESIGNER ---';
  assert.equal(row.notes.split(MARK).length - 1, 1);
  await Store.pushDesignToQuote(d, { quoteId: 'NAC-EXISTING-1' });
  row = rows.get('NAC-EXISTING-1');
  assert.equal(row.notes.split(MARK).length - 1, 1, 'one design block, not two');
  assert.match(row.notes, /INTAKE DRAFT/, 'and the intake still survives the second push');
});

test('a rejected write throws instead of reporting a quote that does not exist', async () => {
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {} };
  globalThis.location = globalThis.location || { origin: 'https://x' };
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '' });
  const Store = await import('../designer/engines/store.mjs?t=' + Math.random());
  await assert.rejects(() => Store.pushDesignToQuote(design()), /HTTP 403/);
});

test('the quote carries the design summary, not just a price', async () => {
  const { rows } = stubDb();
  const Store = await import('../designer/engines/store.mjs?t=' + Math.random());
  const r = await Store.pushDesignToQuote(design());
  const notes = rows.get(r.quoteId).notes;
  // Whoever picks this quote up needs to see what was designed.
  assert.match(notes, /14/, 'the capacity');
  assert.match(notes, /107|m²|m2/, 'the area it was sized on');
});
