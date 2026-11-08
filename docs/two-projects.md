# The quote tool and the ops assistant: who owns what

**Status: inspection complete, one interface implemented, nothing connected.**
Written 8 November 2026 after reading both repositories.

---

## What each project is

| | **nac-quote-tool** (this one) | **nac-ops-assistant** |
|---|---|---|
| Shape | Static site + Vercel serverless functions | Node 22 service, Docker, Railway |
| Store | Supabase (Postgres) | SQLite (Node's built-in) |
| Owns | Quoting, start to signature | The daily operating picture |
| Connectors | ServiceM8 (job creation), Podium (manual) | ServiceM8, Xero, Podium, Gmail |
| Interface | `/api/ops`, 12 operations, key + scopes | Own web UI, push notifications, approvals |
| Tests | 929 node + 16 browser suites | 43 tests, simulated data |
| Live? | Deployed. Integrations not live. | Read-only first release |

The assistant's README says: *"This is separate from the NAC quote tool, which
is not modified. The two meet only through ServiceM8."* That is the assumption
this document revisits — not because it is wrong, but because it is narrower
than it needs to be.

---

## Which project should host the main dashboard

**The ops assistant. Not this one.**

It already has the daily briefing, and it has the three things that make one
possible: the ServiceM8/Xero/Podium connectors, push notifications to Nick's
phone, and a freshness model that refuses to show a section as settled unless
every source behind it is fresh. Rebuilding that here would be a second answer
to the same question, and the two would drift.

What the assistant cannot see is **everything before a job exists**: drafts
being worked on, quotes waiting on Nick's approval, issued revisions nobody has
answered, acceptances that have not become jobs. Those records live in this
application's database and always should, because this application owns them.

So:

- **The assistant hosts the one operating picture.** It pulls quote-stage
  records from here and shows them beside ServiceM8 jobs, Xero invoices and
  Podium conversations.
- **This application keeps `/dashboard.html`** as the quote-stage board — the
  screen Nick is already on when he is quoting. It is not the business
  dashboard and does not try to be: no jobs, no invoices, no scheduling.

---

## Who owns each record

The rule: **one system writes, everybody else reads.** Where a record exists in
two places, the owner is the one that can enforce the rules about it.

| Record | Owner | Why |
|---|---|---|
| Customer, property | **ServiceM8** | It is the field system of record and the crew work from it. This app's `nac_customers` / `nac_jobs` are a local index, matched on ServiceM8 ids. |
| Enquiry | **Quote tool** | It is where an enquiry becomes an assessment. |
| Assessment, sizing, assumptions | **Quote tool** | The engines, the confidence scores and the technical-review gate are here. |
| Quote draft, revisions, options | **Quote tool** | Only this app can enforce "a later edit is a new revision". |
| **Issued revision** | **Quote tool** | Frozen at issue, fingerprinted, served from the frozen copy. Nothing else may write one. |
| **Acceptance** | **Quote tool** | Recorded server-side against the exact revision, options and total shown. Duplicate-safe. |
| Handover | **Quote tool** → ServiceM8 | Prepared here, pushed to ServiceM8 when that is connected. `pending` until ServiceM8 returns a job id. |
| Job, scheduling, crew | **ServiceM8** | |
| Invoice, payment, deposit | **Xero** | A deposit is confirmed against a Xero payment, never inferred from acceptance. |
| Customer conversations | **Podium** | |
| Task, approval, briefing | **Ops assistant** | |

### The one that bites

**A deposit is not implied by an acceptance.** The handover record carries
`deposit`, `equipment` and `scheduling` as three separate facts, each starting
`unknown`, each needing a *source* before it may read `confirmed`. A
confirmation with no source is demoted back to unknown. `readyToBook` is false
until all three are confirmed and every site check is closed.

---

## How the two should exchange information

**One direction, over the existing interface.** The assistant pulls; this
application never calls the assistant.

```
  ops assistant  ──GET/POST──►  /api/ops   (key + scopes, this repo)
                 ◄──summary───
```

That surface already exists (`server/ops.js`, 12 operations, per-key scopes,
idempotency on every write, refusals logged). It needs no new transport and no
shared database. **Do not give the assistant Supabase credentials** — it would
bypass every rule this application enforces.

### Implemented in this change

`quote.board` — scope `quote:read`, read-only. What is at each quote stage,
in the stage vocabulary both sides can share.

```jsonc
POST /api/ops  { "operation": "quote.board", "limit": 50 }

{
  "generatedAt": "2026-11-08T06:53:52.000Z",
  "source": "NAC quote tool. Issued revisions and acceptance records only.",
  "stages": {
    "awaitingResponse": { "available": true, "count": 2, "items": [...], "truncated": false },
    "accepted":         { "available": true, "count": 1, "items": [...], "truncated": false }
  },
  "notYetExposed": ["draftsInProgress", "awaitingOwnerApproval", "handovers"],
  "money": { "awaitingResponseIncGst": 15716, "acceptedIncGst": 21000,
             "note": "Issued revisions and acceptance records only. Drafts are not counted." }
}
```

Three things about it that matter:

1. **`count` is null when the source could not be read, never 0.** The
   assistant's briefing has the same rule (`sectionState`, "only a fully fresh
   section may say there is nothing to do"). Both sides must agree or the join
   lies at exactly the wrong moment.
2. **`count` is the true total; `limit` truncates only the list.** A briefing
   that says "3 waiting" because the page size was 3 under-reports the week.
3. **No internal costs, margins, supplier prices or customer contact details.**
   The assistant reaches customers through Podium and ServiceM8, where their
   details already are.

### Still to agree

- A shared id for a customer across both systems. Proposal: the ServiceM8
  client uuid, since that is the one system both already touch.
- Whether the assistant may see drafts and pending approvals. They are the most
  sensitive records here, which is why `notYetExposed` names them rather than
  shipping them before the surface has been used in anger.

---

## Duplicate functionality to avoid building

Found by reading both. Each is a real risk, not a theoretical one.

| Duplicate | Decision |
|---|---|
| **"What needs my attention today"** | The assistant owns it. This app's `/dashboard.html` is the quote-stage board only. |
| **Quote follow-up / chasing** | **Only one system may ever message a customer.** The assistant already has `quote_followup.owner_of_followups` and drafts nothing until it is set. This app has the Podium panel, which records a *copied link* as not a sent message. Set the owner before either is switched on. |
| **Freshness / unavailable-is-not-zero** | Both implement it independently and both should keep it — it is a principle, not a feature, and the join depends on both honouring it. |
| **Push notification to Nick** | The assistant owns it. This app should not grow a second notifier. |
| **A second AI assistant** | Not built, and not to be. This app's AI is the plan reader. Nothing here reasons about operations. |

---

## What is NOT connected

Everything. To be exact:

- `/api/ops` answers **503** on every operation until `NAC_OPS_KEYS` is set.
  No key has been issued.
- The assistant has **no code that calls this application**. It meets it only
  through ServiceM8 today.
- ServiceM8, Xero and Podium are not connected **from this application**.
  Handovers stay local and say so.
- `designer/ops-integration-schema.sql` has **not been applied**.

---

## The next input needed

Two decisions, both yours and neither urgent enough to block anything:

1. **Who chases a customer for an answer** — Podium, ServiceM8 automation, or
   the assistant. Until that is set, neither system should message anybody.
2. **Whether the assistant may read drafts and pending approvals**, or only
   issued and accepted work as it does now.
