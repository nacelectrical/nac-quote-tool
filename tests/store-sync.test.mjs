// NAC AI HVAC DESIGNER — a save that did not reach the database is not a save.
//
// store.mjs writes localStorage first so an iPad on a bad connection never
// loses a site visit. But a local write lives on ONE device. setSetting used to
// return true whatever the database said — and fetch RESOLVES on a 401 or a
// 500, so a rejected write was indistinguishable from an accepted one. The
// designer then reported "Design saved", cleared its dirty flag, and the work
// existed nowhere but that iPad.

import { test } from 'node:test';
import assert from 'node:assert/strict';

async function withEnv({ status = 201, throws = false }, fn) {
  const prior = { fetch: globalThis.fetch, ls: globalThis.localStorage };
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k)
  };
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    if (throws) throw new Error('network down');
    return {
      ok: status < 400,
      status,
      json: async () => (status < 400 ? [] : { message: 'denied' }),
      text: async () => ''
    };
  };
  // Fresh module each time: it caches whether nac_designs exists.
  const Store = await import('../designer/engines/store.mjs?t=' + Math.random());
  try { return await fn(Store, { mem, calls }); }
  finally { globalThis.fetch = prior.fetch; globalThis.localStorage = prior.ls; }
}

test('an accepted write reports true', async () => {
  await withEnv({ status: 201 }, async (Store) => {
    assert.equal(await Store.setSetting('k', 'v'), true);
  });
});

test('a REJECTED write reports false, not true', async () => {
  // The case that used to pass silently: fetch resolves, so nothing threw.
  for (const status of [400, 401, 403, 409, 500, 503]) {
    await withEnv({ status }, async (Store) => {
      assert.equal(await Store.setSetting('k', 'v'), false, 'HTTP ' + status);
      assert.match(Store.lastStorageError(), new RegExp(String(status)));
    });
  }
});

test('an unreachable database reports false and says so', async () => {
  await withEnv({ throws: true }, async (Store) => {
    assert.equal(await Store.setSetting('k', 'v'), false);
    assert.match(Store.lastStorageError(), /could not reach/i);
  });
});

test('the work still lands on the device even when the database refuses', async () => {
  await withEnv({ status: 500 }, async (Store, { mem }) => {
    await Store.setSetting('k', 'keep-me');
    assert.equal(mem.get('nac_k'), 'keep-me', 'a bad connection must never lose the work');
  });
});

test('a rejected READ falls back to the device instead of returning nothing', async () => {
  await withEnv({ status: 401 }, async (Store, { mem }) => {
    mem.set('nac_k', 'local-copy');
    assert.equal(await Store.getSetting('k'), 'local-copy');
  });
});

test('saveDesign reports synced=false when nothing reached the database', async () => {
  await withEnv({ status: 403 }, async (Store) => {
    const r = await Store.saveDesign({ id: 'D1', customer: { name: 'X' }, status: 'draft' });
    assert.equal(r.synced, false);
    assert.equal(r.ok, false);
    assert.equal(r.storage, 'local_only');
    assert.ok(r.error, 'the reason must be carried back to the UI');
  });
});

test('saveDesign reports synced=true when the database took it', async () => {
  await withEnv({ status: 201 }, async (Store) => {
    const r = await Store.saveDesign({ id: 'D2', customer: { name: 'Y' }, status: 'draft' });
    assert.equal(r.synced, true);
    assert.equal(r.ok, true);
  });
});
