# Integrating NAC's quote tool with Podium and the AI ops assistant

Written 4 November 2026, for Nick.

**Neither integration is live.** Nothing in the quote tool sends a customer a
message, and nothing in it calls an assistant. What exists is the half NAC owns:
a documented, authenticated surface that an assistant calls *in* on, and a
manual Podium workflow that Nick drives himself. Both are built so that turning
them on later is wiring rather than a rebuild.

**No assistant code or documentation was supplied.** There is none in this
repository — `docs/` held only the September audits, and a search for any
assistant API, client or schema found nothing. So nothing below assumes
anything about what the assistant can do. The operations are the ones listed
in the brief, and the connection details at the foot are what is still needed.

---

## Who owns what

```
                        ┌──────────────────────────────┐
                        │        THE CUSTOMER          │
                        │  reads the proposal, picks   │
                        │  options, accepts or declines│
                        └──────▲────────────────┬──────┘
                               │ the link       │ acceptance
                               │                ▼
  ┌─────────────────┐   ┌──────┴──────────────────────────────────┐
  │     PODIUM      │   │            THE QUOTE TOOL               │
  │                 │   │                                         │
  │ · conversations │   │ · reads the plan, sizes the job         │
  │ · SMS / message │   │ · equipment options and prices          │
  │   DELIVERY      │◀──┤ · proposal revisions                    │
  │                 │   │ · Nick's approval, at one revision      │
  │ Nick pastes the │   │ · issues the customer link              │
  │ link himself    │   │ · records the acceptance, immutably     │
  │ (manual, today) │   │                                         │
  └─────────────────┘   │   /api/ops  ◀── authenticated, scoped   │
                        └──────▲──────────────────────────────────┘
                               │ calls in. Never called out to.
                               │
                   ┌───────────┴────────────────┐
                   │    AI OPS ASSISTANT        │
                   │                            │
                   │ · coordinates the tasks    │
                   │ · asks Nick for approval   │
                   │ · chases follow-ups        │
                   │ · hands over to the next   │
                   │   business step            │
                   │                            │
                   │ CANNOT: set a price,       │
                   │ approve a quote, or change │
                   │ an answered offer.         │
                   └────────────────────────────┘
```

The quote tool owns **the numbers**: sizing, equipment, pricing, revisions,
acceptance. Podium owns **the conversation and the delivery**. The assistant
owns **the coordination**: tasks, approvals, follow-ups, handover.

That split decides what the surface refuses. An assistant *coordinating* a
price is coordination. An assistant *setting* one is the quote tool's job being
done by something that cannot be held to it, so it is refused by name.

---

## The three controls that cannot be turned off

1. **Nick approves the exact revision.** There is no approve operation on the
   surface at all — not a scope the assistant lacks, an operation that does not
   exist, so no key can ever be issued for it. The approval is a tick in the
   application against a preview Nick has read, and `/api/quote-issue` now
   **refuses to issue a quote with no approver recorded**. The approval is
   frozen into the offer with a fingerprint of that exact offer, so it does not
   travel to a changed one.
2. **The assistant cannot invent a price.** Every money field — `price`,
   `priceIncGst`, `cost`, `supplierCost`, `margin`, `markup`, `jobFee`,
   `discount`, `deposit`, `allowance` and the rest — is refused on the way in,
   by name, however deep in the request it is buried. Refused, not stripped: an
   integration that thinks it set a price and did not is worse than one that is
   told it cannot.
3. **An accepted or declined offer is finished.** An integration cannot change
   it. A change means a new revision, and that is Nick's to make.

And one more, which is about retries rather than authority:

4. **Anything that changes something requires an `idempotencyKey`.** A retry
   carrying the same key returns the first result instead of doing the work
   twice; the same key carrying a different request is refused rather than
   quietly answering the wrong question. Every such call is written to
   `nac_integration_calls`, which is both the idempotency record and NAC's
   audit trail.

---

## The surface

`POST /api/ops`, with `Authorization: Bearer <integration key>` and a JSON body
carrying `operation` and that operation's fields.

`GET /api/ops` returns the discovery document — every operation, its scope,
what it takes and returns, the status events, the identifiers, and what is
still needed. It carries no customer, pricing or design information.

| Operation | Scope | Changes anything | What it does |
|---|---|---|---|
| `enquiry.find_or_create` | `enquiry:write` | yes | Finds the customer and job this enquiry belongs to, or opens one. Matches on phone, then email, then the same name at the same address — narrow on purpose, because a loose match merges two households. |
| `enquiry.attach_plan` | `enquiry:write` | yes | Attaches a plan *reference* and site notes to the job's draft. Never a scale: an installer confirms that in the application. |
| `quote.create_draft` | `quote:write` | yes | Opens an empty draft. No equipment, no price. |
| `quote.update_draft` | `quote:write` | yes | Changes site address, site notes, scope, rooms, sizing method, inclusions, exclusions, customer, proposal number or plan. Nothing else. |
| `quote.sizing` | `quote:read` | no | Preliminary sizing, labelled as an estimate, naming the rule that produced it. |
| `quote.options` | `quote:read` | no | The priced options, at customer prices. No cost, margin, markup or fee. |
| `quote.preview` | `quote:read` | no | Whether it can be issued, and what is missing in words. |
| `quote.request_approval` | `approval:request` | yes | Asks Nick to approve. Does not approve. |
| `quote.approved_link` | `delivery:read` | no | The customer link, for an approved, issued, still-live revision. Refuses otherwise. |
| `quote.status` | `quote:read` | no | Where it stands and what the customer chose. |
| `booking.create_task` | `booking:write` | yes | Opens the booking and deposit task — only after an acceptance. |

Each key carries only the scopes its integration needs. A delivery key cannot
open a draft; a read key cannot write one.

### Stable identifiers

| Id | Where it lives | Stable across |
|---|---|---|
| `customerId` | `nac_customers.id` | the life of the customer |
| `jobId` | `nac_jobs.id` | the life of the job |
| `quoteId` | `nac_designs.id` | every revision of that quote |
| `revision` | `nac_quote_issues.quote_rev` | 1, 2, 3 against one `quoteId` |
| `issueToken` | `nac_quote_issues.token` | one revision's customer link |

The issue token **is** the link, so it is a bearer credential: it is never put
in a log, a webhook or the audit trail, and it travels in the URL *fragment*
so it does not reach anybody's access log.

### Status events

`quote.approval_requested`, `quote.approved`, `quote.issued`, `quote.accepted`,
`quote.declined`, `quote.expired`, `quote.superseded`.

Plus the outreach events the manual Podium workflow records:
`outreach.link_copied`, `outreach.sent_manually`, `outreach.customer_replied`,
`outreach.taken_over`, `outreach.opted_out`, `outreach.resumed`.

---

## Follow-ups, and the duplicate-message problem

**Nothing is scheduled and nothing is sent.** `AUTOMATIC_SENDING` is `false` and
`SCHEDULING_OWNER` is `'undecided'`, in both the Podium engine and the
operations surface, and both are read before anything would go out.

This is not a flag waiting to be flipped because the code looks ready. Two
systems that both believe they own follow-up scheduling will both send, and the
customer gets chased twice for one quote. **The owner has to be decided before
anything automatic is turned on** — and it cannot be decided without knowing
whether Podium has its own automated follow-up, which is on the list below.

What *is* built is the state machine that decides whether a follow-up is due,
and every reason it is not:

- the link was copied but nobody recorded sending it — **a copied link is not a
  sent message**, and chasing one is the worst version of this: the customer
  gets "just checking you saw my quote" for a quote they never got;
- accepted, declined, withdrawn, expired, or superseded by a newer revision;
- the customer replied, or Nick took it over — paused, until somebody resumes it
  deliberately;
- the customer opted out — which cannot be resumed by anybody;
- not due yet.

---

## What is still needed

### From Podium

1. The API base URL and the authentication method (API key, OAuth client).
2. Whether NAC's plan includes API access at all, and for which inbox.
3. The endpoint that sends a message to a contact, and what it needs to
   identify that contact — a Podium contact id, or a phone number.
4. Whether Podium can tell us a message was **delivered**, and whether it can
   tell us a customer **replied**. Without the second, follow-up scheduling
   cannot safely live on the Podium side.
5. Whether Podium has its own automated follow-up that would run alongside
   ours. This is the duplicate-message question, and the one that decides who
   owns scheduling.
6. A test or sandbox inbox, so none of this is proved against a real customer.

### From the AI ops assistant

1. **What it is.** A hosted service, a scheduled script, something inside
   another product? Nothing about it is in this repository, so nothing about it
   has been assumed.
2. **How it would authenticate to the quote tool.** The surface expects a
   bearer key NAC issues. If the assistant can only do OAuth, or can only be
   called rather than call, that changes the shape and is better known now.
3. **Which operations it actually needs**, so its key carries those scopes and
   no others. The default should be the smallest set that does the job.
4. **Whether it is the one that chases follow-ups**, or Podium is. See above —
   this is the single most important answer on this page.
5. **Where Nick wants the approval request to arrive.** Today
   `quote.request_approval` records the request on the quote, so it shows up in
   NAC's own quote list. If Nick wants a push, an SMS or an email, that needs a
   channel and a destination.
6. **A test identity**, so the demonstration runs as something clearly not a
   real customer.

### Configuration, when there is something to configure

Server-side environment variables only. Nothing here reaches a browser.

| Variable | What it is |
|---|---|
| `NAC_OPS_KEYS` | A JSON array of `{ id, name, secret, scopes[] }`. Unset — as it is now — and the whole surface answers 503. |
| `NAC_PUBLIC_BASE_URL` | The base the customer link is built on. Defaults to the production domain. |
| `SUPABASE_KEY` | The service-role key, already configured, server-side only. |

And one migration: **`designer/ops-integration-schema.sql`** creates
`nac_integration_calls`. It is additive — one new table, nothing existing
touched. Until it is applied, every operation that would change something is
refused with `call_log_missing` rather than writing without the record that
makes a retry safe. **Applying it is a deployment action for Nick**; it has not
been applied to the live project from here, and nothing in this work claims it
has.

The CRM tables `nac_customers` and `nac_jobs` (`designer/crm-schema.sql`) are
also required for `enquiry.find_or_create`. If they are not in the live project
yet, that operation answers `customer_records_unavailable` and says so.

---

## What has been proven, and where

| Checked | Where it ran |
|---|---|
| The engine: scopes, refusals, fingerprints, idempotency, customer matching | `tests/ops-api.test.mjs` — 35 tests, locally |
| The Podium state machine: copied vs sent, every stop reason, opt-out, the message | `tests/podium-outreach.test.mjs` — 22 tests, locally |
| The real `/api/ops` handler end to end: a test enquiry to a customer, a job, a draft, a plan reference, a priced quote issued and accepted, the booking task, and every refusal | `tests/ops-surface-db.test.mjs` — 16 tests, against a **local PostgreSQL carrying NAC's own schema** |
| The approval surviving the round trip, and an issue with no approver refused | `tests/quote-only-db.test.mjs`, against the same local database |

**Nothing has been run against the live Supabase project, against Podium, or
against the assistant.** No real customer has been messaged, and automatic
sending has not been enabled.
