// NOTHING THE BROWSER DOWNLOADS MAY CARRY A SERVICE-ROLE KEY.
//
// Nick: "Do not expose service-role keys or other private credentials to the
// browser. The Supabase anon key may exist client-side only where appropriate
// and must be protected by correct RLS policies."
//
// This is a guard, not a documentation exercise. The service role bypasses row
// level security entirely: one copy of it in a file Vercel serves and every
// customer, price and design in the database is readable by anyone who opens
// the page and looks at the source. The check reads the actual files, decodes
// any Supabase JWT it finds and looks at the `role` claim, so it catches a key
// pasted in tomorrow as well as the ones here today.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Every file the browser can download. api/ and server/ run on the server. */
function servedFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'tests' ||
        name === 'tools' || name === 'api' || name === 'server') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { servedFiles(p, out); continue; }
    if (['.html', '.js', '.mjs', '.jsx', '.json', '.css'].includes(extname(name))) out.push(p);
  }
  return out;
}

/** The `role` claim of every JWT-looking string in the text. */
function jwtRoles(text) {
  const roles = [];
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{6,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const json = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const claims = JSON.parse(json);
      if (claims && typeof claims.role === 'string') roles.push(claims.role);
    } catch (e) { /* not a JWT after all */ }
  }
  return roles;
}

test('no file the browser downloads contains a service-role key', () => {
  const offenders = [];
  for (const f of servedFiles()) {
    const roles = jwtRoles(readFileSync(f, 'utf8'));
    if (roles.includes('service_role')) offenders.push(f.slice(ROOT.length + 1));
  }
  assert.deepEqual(offenders, [],
    'service-role key found in browser-served file(s): ' + offenders.join(', '));
});

test('the only Supabase key in browser-served files is the anon key', () => {
  const found = new Set();
  for (const f of servedFiles()) for (const r of jwtRoles(readFileSync(f, 'utf8'))) found.add(r);
  for (const r of found) assert.equal(r, 'anon', 'unexpected JWT role client-side: ' + r);
});

test('no browser-served file reads the server-only SUPABASE_KEY variable', () => {
  const offenders = servedFiles()
    .filter(f => /process\.env\.SUPABASE_KEY/.test(readFileSync(f, 'utf8')))
    .map(f => f.slice(ROOT.length + 1));
  assert.deepEqual(offenders, []);
});

test('nac-quote-tool-v2.jsx declares its database client exactly once', () => {
  const src = readFileSync(join(ROOT, 'nac-quote-tool-v2.jsx'), 'utf8');
  // The stale duplicate that used to sit at line 99 redeclared _SU and replaced
  // window.storage with a copy that ignored the signed-in user's token.
  assert.equal((src.match(/^const _SU =/gm) || []).length, 1, 'duplicated _SU declaration');
  assert.equal((src.match(/^window\.storage = \{/gm) || []).length, 1,
    'window.storage is assigned more than once — the later one wins');
  assert.equal((src.match(/^import \{ useState/gm) || []).length, 1, 'duplicated import block');
  // The signed-in user's token must be preferred over the bare anon key.
  assert.match(src, /window\.nacDbHeaders/);
});

test('/api/server-key-selftest returns no part of the key, not even its length', () => {
  const src = readFileSync(join(ROOT, 'server/server-key-selftest.js'), 'utf8');
  for (const leak of [/KEY\.length/, /KEY\.slice/, /KEY\.substr/, /KEY\.charAt/,
                      /\bkey:\s*KEY\b/, /console\.log\([^)]*KEY/]) {
    assert.ok(!leak.test(src), 'server-key-selftest leaks key material: ' + leak);
  }
  // KEY may only be used as a request credential and for its role claim.
  const uses = [...src.matchAll(/\bKEY\b/g)].length;
  assert.ok(uses > 0 && uses <= 8, 'unexpected number of KEY uses: ' + uses);
});

test('no api handler puts the server key in a response body', () => {
  // server/ holds the handlers that /api/quote.js and /api/selftest.js dispatch
  // to. They run with the same credential and are held to the same rule.
  for (const dir of ['api', 'server']) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!name.endsWith('.js')) continue;
      const src = readFileSync(join(ROOT, dir, name), 'utf8');
      assert.ok(!/res\.(json|send|end)\([^)]*process\.env\.SUPABASE_KEY/.test(src),
        dir + '/' + name + ' returns SUPABASE_KEY to the browser');
      assert.ok(!/console\.(log|error|warn)\([^)]*process\.env\.SUPABASE_KEY/.test(src),
        dir + '/' + name + ' prints SUPABASE_KEY to the log');
    }
  }
});
