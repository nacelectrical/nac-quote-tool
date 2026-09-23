// EVERY /api/ URL THE APP CALLS MUST ACTUALLY EXIST ON THE DEPLOYMENT.
//
// This suite exists because of a real outage. Vercel turns each file in /api
// into its own Serverless Function and the plan this project deploys on allows
// twelve. The quote and presentation work took the count from 11 to 15, so
// every build from 23 September failed and production kept serving the code
// from 15 September — the designer looked fine locally and /api/quote-issue
// answered 404 in the real world.
//
// Two things keep that from happening again:
//
//   1. The function count stays under the cap.
//   2. Every /api/ URL in the shipped HTML and JS resolves — either to a file
//      in /api, or through a rewrite in vercel.json to a dispatcher that knows
//      the name and a handler file that exists.
//
// A new endpoint is still free. It just has to go behind a dispatcher once the
// cap is close, and this suite says so rather than the deployment failing
// silently three days later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Vercel's cap on Serverless Functions in one deployment, Hobby plan. */
const FUNCTION_LIMIT = 12;

const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const apiFiles = readdirSync(join(ROOT, 'api')).filter(n => n.endsWith('.js'));

test('the /api directory stays within the Serverless Function limit', () => {
  assert.ok(apiFiles.length <= FUNCTION_LIMIT,
    'api/ holds ' + apiFiles.length + ' function files and the deployment allows ' +
    FUNCTION_LIMIT + '. Put the new endpoint behind api/quote.js or api/selftest.js ' +
    'with a rewrite in vercel.json, the way the quote endpoints are.');
});

test('every rewrite points at a dispatcher that knows the name', () => {
  const rewrites = vercelJson.rewrites || [];
  assert.ok(rewrites.length > 0, 'vercel.json has no rewrites');
  for (const r of rewrites) {
    const m = /^\/api\/([a-z0-9-]+)\?nac_fn=([a-z0-9-]+)$/.exec(r.destination);
    assert.ok(m, 'rewrite destination is not a dispatcher call: ' + r.destination);
    const [, dispatcher, name] = m;

    assert.ok(apiFiles.includes(dispatcher + '.js'),
      r.source + ' rewrites to api/' + dispatcher + '.js, which does not exist');

    const src = readFileSync(join(ROOT, 'api', dispatcher + '.js'), 'utf8');
    const route = new RegExp("['\"]?" + name + "['\"]?\\s*:\\s*\\(\\)\\s*=>\\s*import\\(['\"]\\.\\./server/([a-z0-9-]+\\.js)['\"]\\)");
    const hit = route.exec(src);
    assert.ok(hit, 'api/' + dispatcher + '.js has no route named ' + name);

    const handler = join(ROOT, 'server', hit[1]);
    assert.ok(statSync(handler).isFile(), 'missing handler file server/' + hit[1]);
  }
});

test('no rewrite shadows a real function file', () => {
  for (const r of (vercelJson.rewrites || [])) {
    const name = r.source.replace(/^\/api\//, '') + '.js';
    assert.ok(!apiFiles.includes(name),
      r.source + ' is both a rewrite and a file in api/ — the file wins and the ' +
      'rewrite is dead');
  }
});

/** Every file Vercel serves to the browser. */
function servedFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'tests' ||
        name === 'tools' || name === 'api' || name === 'server' ||
        name === 'docs' || name === 'vendor') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { servedFiles(p, out); continue; }
    if (['.html', '.js', '.mjs', '.jsx'].includes(extname(name))) out.push(p);
  }
  return out;
}

test('every /api/ URL the app calls is reachable on the deployment', () => {
  const reachable = new Set(apiFiles.map(n => n.replace(/\.js$/, '')));
  for (const r of (vercelJson.rewrites || [])) reachable.add(r.source.replace(/^\/api\//, ''));

  const called = new Map(); // endpoint -> file that calls it
  for (const file of servedFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/['"`]\/api\/([a-z0-9-]+)/gi)) {
      if (!called.has(m[1])) called.set(m[1], file.slice(ROOT.length + 1));
    }
  }

  assert.ok(called.size > 0, 'found no /api/ calls at all — the scan is broken');
  const missing = [...called].filter(([name]) => !reachable.has(name));
  assert.deepEqual(missing, [],
    'these endpoints are called but nothing answers them: ' +
    missing.map(([n, f]) => '/api/' + n + ' (' + f + ')').join(', '));
});
