# Paste this into the `nac-ops-assistant` Claude Code project

**Why this file is here:** you asked for an inspection report from *each* project. The
quote-tool half is `docs/inspection-quote-tool.md`, written from inside this repository
where things can be run. The assistant half has to be written from inside *its* repository
for the same reason — a report assembled by reading someone else's code can only say what
the code claims, not what it does.

Copy everything below the line into a Claude Code session on `nac-ops-assistant`. It uses
the same six headings, so the two reports read side by side.

---

You are inspecting this repository. Produce `docs/inspection-ops-assistant.md`.

**The one rule: separate what you RAN from what you READ.** Every claim that something
works must name the command and its result. Anything you only read, say so. A report that
reads as though everything is fine because the code looks fine is the failure mode here —
it is the exact failure that cost this project two weeks when an endpoint asked Postgres
for a column that existed in no schema file and every test stubbed the call.

Do not change behaviour, connect anything, or send anything outward while inspecting. No
real customer messages, no supplier orders, no money moved, no live external record
modified. If an integration can only be proven by a live write, say it is unproven.

Write to exactly these six headings:

### 1. What this project is
Shape, runtime, store, how it deploys, what has to be installed. A table is fine.

### 2. What works, and how I know
Only things you **ran**. Give the command and the count: tests passed/failed, which
suites, what was exercised against real data versus simulated. If the 43 tests run on
simulated data, say which behaviours are therefore unproven. Name anything that is proven
end to end against a real external system, and how.

### 3. What is built but not connected
The honest centre. For each connector — ServiceM8, Xero, Podium, Gmail — state one of:
**verified live** (and what call proved it), **code exists, unverified**, or **not
present**. `docs/INTEGRATION_FINDINGS.md` already carries `**TESTED LIVE**` and
`**UNVERIFIED**` markers; re-check them rather than trusting them, and say which you could
not re-check and why. List required configuration by **name only** — never a value, never a
fragment of one. If you cannot see the deployed Railway environment from the sandbox, say
that, and that confirming it is a deployment action for Nick, not a code change.

### 4. What actually needs building
In the order you would do it, smallest useful change first. Each item: what is missing, what
already exists that it would use, and what it unblocks.

### 5. What I could not inspect
Production environment, live data, whether any real notification has ever reached Nick's
phone, the other project's runtime.

### 6. The smallest next input from Nick
Decisions only he can make. Keep it to two or three.

### Four specific questions to answer in the body

1. **Podium's "AI Employee" lead follow-up.** `docs/INTEGRATION_FINDINGS.md` records that
   Podium ships its own automated lead follow-up. If that is switched on for NAC, something
   is already messaging customers. Say what this repository knows about whether it is on,
   and whether anything here would collide with it. This is the one finding that should be
   checked before anything else is connected.
2. **Who may message a customer.** `quote_followup.owner_of_followups` exists here. Report
   its current value and what this project does while it is unset.
3. **The freshness model.** `sectionState` is said to refuse to show a section as settled
   unless every source behind it is fresh. Prove it with a test or a run: feed it a stale
   source and show the section does not read as "nothing to do". Confirm that an
   unreadable source yields `null`, never `0`.
4. **The quote tool's interface.** `/api/ops` in the quote tool exposes 12 operations
   behind a key with per-key scopes, including `quote.board` (scope `quote:read`,
   read-only: what is at each quote stage, with `count` null when unreadable and never 0,
   and no costs, margins or customer contact details). It answers **503 on every
   operation** today because `NAC_OPS_KEYS` is unset and no key has been issued. State
   plainly: does this repository contain **any** code that calls the quote tool? If not,
   say so — do not describe what it could do as though it does it. Then say what you would
   need to consume `quote.board`, and note that the quote tool never calls this project;
   the assistant pulls, in one direction.

### Two things not to do

- **Do not ask for the quote tool's Supabase credentials.** The quote tool enforces rules
  about revisions, freezing and acceptance that direct database access would bypass. The
  `/api/ops` key is the whole interface.
- **Do not duplicate what the quote tool owns.** It owns enquiries, assessments, drafts,
  revisions, issued revisions and acceptances. This project owns tasks, approvals, the
  briefing, and push to Nick's phone. Where you find something here that reimplements the
  other side, name it in section 4 as a duplicate to delete, not a feature.

Keep it short enough that Nick reads all of it. Plain sentences. No marketing.
