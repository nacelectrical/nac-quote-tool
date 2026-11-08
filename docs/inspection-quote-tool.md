# Inspection report — nac-quote-tool

**Date:** 8 November 2026 · **Commit:** `4b8e6d0` · **Inspected by:** Claude Code, in this repository

Written to the same headings as the report requested from `nac-ops-assistant`, so the
two can be read side by side. The prompt for that second report is
`docs/inspection-prompt-ops-assistant.md` — paste it into a Claude Code session on that
repository, because a report written from outside a project can only say what its code
claims, not what it does.

---

## 1. What this project is

A **static site plus serverless functions**, not a framework app.

| | |
|---|---|
| Front end | 16 plain HTML screens, ES modules, no build step, no bundler |
| Back end | 11 files in `api/` (Vercel caps a Hobby project at 12), two of which are dispatchers routing 17 public paths |
| Logic | 52 engines in `designer/engines/`, pure ES modules, no DOM |
| Store | Supabase (Postgres) over PostgREST |
| Auth | Supabase Auth; `designer/auth.mjs` gates every internal screen |
| Deploy | Vercel, `main` auto-deploys |

There is no package.json and nothing to install. `node tools/serve.mjs` serves it locally.

---

## 2. What works, and how I know

Everything below was **run**, not read.

| Area | Evidence |
|---|---|
| **929 node tests, 0 failing** | `node --test tests/*.test.mjs`, 56 files |
| **18 browser suites, all passing** | Real Chromium at 1440 / 820 / 390 |
| **The full quote lifecycle** | `tools/lifecycle-proof.mjs` against real PostgreSQL — see below |
| **The proposal renders and prints** | `tools/quote-only-proof.mjs` writes HTML + a 2.8 MB PDF |

### The lifecycle, proven end to end

`tools/lifecycle-proof.mjs` runs against a real Postgres and demonstrates, in one pass:

1. Issue at revision 1 — $15,400
2. Customer opens the link (reviews, installs, logo all render)
3. Customer selects options — server recalculates to $15,716
4. **The internal design is then edited** (+$5,000, rooms deleted, every review removed from the library) — the issued page is re-opened and is **unchanged**
5. Accept — displayed total equals recorded total
6. **Re-press Accept** → `200 repeat:true`, one acceptance not two
7. A stale price → `409 price_mismatch`
8. Revision 2 issued — revision 1 **keeps its acceptance**, old link still readable, no Accept button

That covers acceptance checks 1–9 of the platform brief.

### The three earlier review findings — all closed

| Finding | Status |
|---|---|
| `nac_designs.design` vs `.data` | **Fixed.** `server/design-row.js` is the single reader. Its header documents the original bug: the endpoints asked PostgREST for a column in neither schema file, so issuing could never work against the real database — and every browser test stubbed the call, so nothing caught it. |
| Issued quotes rebuilt from mutable data | **Not happening.** `quote-view` serves the frozen copy, refuses to render a pre-freeze quote rather than rebuild it, and verifies a fingerprint against tampering. |
| Acceptance never demonstrated | **Demonstrated** — above. |

### Duct designer

Removed. `designer.html` is now a 2.9 kB retirement notice; the routing, sizing, BTO and
drawing engines are gone from the repository. `tests/designer-removed.test.mjs` fails if any
of them becomes reachable again — it caught a new file last week purely because it was
*named* `pipeline.mjs`, which in a ducted-AC codebase means refrigeration pipework.

---

## 3. What is built but not connected

This is the honest centre of the report.

| Thing | State |
|---|---|
| **ServiceM8** | Code exists (`api/servicem8.js`, `server/servicem8-job.js`). **Nothing verified from this project.** |
| **Podium** | Manual workflow only — the portal records a *copied link* as "copied", never as "sent". No API call is made anywhere. |
| **Ops assistant surface** | `/api/ops`, 12 operations, per-key scopes, idempotency on writes, refusals logged. Answers **503 on every operation** because `NAC_OPS_KEYS` is unset. No key has been issued. |
| **Xero** | Not present at all. Deposits are entered by hand. |
| **`designer/ops-integration-schema.sql`** | Additive, and **not applied**. |
| **Handover → ServiceM8** | ~~Handovers are prepared and stored locally.~~ **This line was wrong — see the correction below.** |

Required server configuration (names only): `SUPABASE_KEY`, `ANTHROPIC_API_KEY`,
`NAC_OPS_KEYS`, `SERVICEM8_API_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`,
`NAC_NOTIFY_WEBHOOK`, `NAC_PUBLIC_BASE_URL`.

### Correction, 8 November 2026 — "stored locally" was wrong

Section 3 above said handovers were *"prepared and stored locally"*, and
section 4 said *"Handovers have no endpoint. `engines/handover.mjs` builds and
validates them; nothing persists or lists them yet."*

**Both cannot be true, and the second one was.** `handover.mjs` is a pure
function: give it a frozen issued record and it returns a handover object.
Nothing called it. There was no table, no endpoint and no row, and
`/dashboard.html` passed `handovers: null` to the board — which correctly
reported the source as unreadable.

"Stored locally" was wrong in the flattering direction. It reads as "stored,
just not synced yet", when the truth was "not stored". The engine was right,
its tests were right, and the thing was unreachable from the application.

That is fixed: `nac_handovers`, `/api/handover`, and the duplicate rule in the
database. See the delivery note in `docs/deployment-and-inputs.md`.

**I cannot see the production Vercel environment from the development sandbox** —
outbound traffic to `vercel.app` and `supabase.co` is blocked here. So: which of those are
set in production, and whether the migrations have been applied, is **unverified**. That
needs checking in the Vercel dashboard, and it is a deployment action, not a code change.

---

## 4. What actually needs building

In the order I would do it. **All five were built on 8 November** — the status
line under each says what the finding turned out to be, which in two cases was
not what I wrote here.

1. **Enquiries have no store of their own.** `api/intake-submit.js` writes to `nac_quotes`;
   the board reads nothing, so its enquiry panel says "could not be read" — honestly, but
   uselessly. *Smallest useful change in the project.*
   → **Built.** `nac_enquiries`, `/api/enquiries`, and the old records read in
   place out of the intake notes rather than migrated. And a second finding I
   had missed: the intake's own `?intake=` link into the quote screen **did
   nothing** — the screen ignored the parameter, so every enquiry was re-keyed
   by hand off the email. `loadIntakeDraft()` had existed and been under test
   the whole time with no caller.
2. **Drafts and pending approvals are not on the board.** The engine supports them; no
   endpoint lists drafts with their gate state.
   → **Built**, on `quote.board`, additively. Blocker **codes** only: the gate's
   messages carry money.
3. **Handovers have no endpoint.** `engines/handover.mjs` builds and validates them; nothing
   persists or lists them yet.
   → **Correct, and it contradicted section 3.** See the correction above.
   Built: `nac_handovers`, `/api/handover`, duplicate-safe on an acceptance
   retry in the endpoint *and* in the database.
4. **The pricing engine needs NAC's allowances.** `engines/quote-pricing.mjs` assembles a
   price from the costs already on file and *refuses* while the installation allowances are
   unset — which is correct, and means it prices nothing today. One session on the Settings
   screen unblocks it.
   → **Wrong about the cause.** There was no Settings screen to have a session
   on. `proposalAllowance` and `jobFee` appeared in **no** `.html` file in the
   repository, so the refusal was permanent and the engine priced nothing,
   ever. `/settings.html` is that screen. The figures are still NAC's to
   supply — see `docs/deployment-and-inputs.md`.
5. **Technician permissions are not enforced.** Every signed-in user sees costs and margins.
   Owner/technician separation is specified and not built.
   → **Built**, in three places: the row-level policy on `nac_settings` (which
   is the only real control, because the browser reads that table directly),
   the capability check on `/api/quote-issue`, and the screens. Who is an owner
   is **not** decided in code — it is configuration, and it is a deployment
   prerequisite.

---

## 5. What I could not inspect

- The production Vercel environment and its variables.
- The live Supabase database: which tables and RLS policies actually exist.
- Whether any real customer has ever opened an issued link.
- The ops assistant's own runtime (see its report).

---

## 6. The smallest next input from you

1. **Who chases a customer for an answer** — Podium, ServiceM8 automation, or the assistant.
   Note the assistant's findings record that Podium has its own *"AI Employee" lead
   follow-up* feature; if that is switched on for NAC, something is already messaging
   customers. **Worth checking before anything else is connected.**
2. **Confirm in Vercel** which environment variables are set, so "configured" stops being a
   guess.
