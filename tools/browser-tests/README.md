# Browser tests

These drive the real pages in Chromium with the database stubbed by Playwright
route interception, so persistence is exercised end to end — UI → handler →
storage → reload → read back — without needing the live Supabase project.

Run a static server first, then any of the scripts:

```bash
node tools/serve.mjs &
node tools/browser-tests/persistence-settings.mjs   # settings CRUD + reloads
node tools/browser-tests/persistence-designs.mjs    # design save/load from the DB only
node tools/browser-tests/persistence-failure.mjs    # save when the DB rejects / is down
node tools/browser-tests/storage-sync-warning.mjs   # storage.set reports sync truthfully
node tools/browser-tests/financials-chain.mjs       # typed costs recompute the quote
node tools/browser-tests/ai-failure-handling.mjs    # AI down / rubbish -> no invented rooms
node tools/browser-tests/end-to-end.mjs             # the whole workflow, plan to signed quote
node tools/browser-tests/static-pressure-gate.mjs   # a missing ESP is never read as a pass
node tools/page-health.mjs                          # every page: console + network errors
```

Each exits non-zero on failure.

`persistence-designs.mjs` clears localStorage between loads on purpose: it is
the only way to prove a design came back from the DATABASE rather than the
device it was created on.

Playwright is installed globally in this container; `node_modules` is a symlink
to `/opt/node22/lib/node_modules` so the imports resolve. It is git-ignored.
