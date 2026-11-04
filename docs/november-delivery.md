# The quote tool, 4 November 2026 — what changed, what was tested, what is blocked

For Nick's review **before** production deployment or issuing any real client
proposal. Nothing here has been deployed, and no real customer has been
contacted.

---

## What it does now

**Create enquiry → upload floor plan → review rooms and preliminary sizing →
select equipment and installation options → calculate prices → preview
proposal → approve → issue customer link → customer selects options and
accepts.** That is the workflow, and it is six steps on one screen
(`/quote-builder.html`), with everything issued on `/quotes.html` and all the
wording, photographs, prices and allowances on `/quote-presentation.html`.

`docs/quote-tool-guide.md` is the short guide to using it.

## The duct designer is gone

48,202 lines. The removal set was decided by walking the real import graph
rather than by reading file names, and `tests/designer-removed.test.mjs` walks
the same graph to keep it gone — it is not hidden and still running. Auto
routing, duct sizing, BTO, static pressure, fabrication schedules, duct BOMs,
Site Adjust, the designer approval blockers and the background calls all went.
Plan reading, sizing, equipment, pricing and quoting stayed, and so did the
calibration rules, which had to be rescued out of a file that was being
deleted. `designer.html` is a signpost that carries a draft id across to the
builder; nothing auto-redirects.

A recoverable checkpoint exists at the tag `checkpoint/before-designer-removal`.

**The four September defects were all already fixed** — I checked each rather
than assuming: the design/data column name, proposals rebuilt from mutable
records, the issue/display/accept inputs diverging, and the static artifact
standing in for the customer page.

## The things worth knowing

**Sizing says what it is.** The 145 W/m² and 50 L/s per kW rules are offered as
clearly labelled, configurable estimating methods. Every figure carries
`isEstimate` and the rule's name, and the proposal says in words that it is not
a load calculation and not manufacturer performance data. An installer override
keeps the original calculation and the reason beside it.

**No scale is ever derived from furniture.** A room counts as measured only
when both dimensions were printed on the plan, or an installer confirmed a
distance. Anything else reads "Needs a dimension". The scale panel says so in
as many words.

**Markup is not margin.** Both are shown on every option, separately, labelled,
with the difference spelled out — a 50% markup is a 33% margin, and an
estimator applying it the wrong way round prices the job a third under. Where
the supplier cost is not known, both read **Unknown** rather than something
flattering.

**Nothing invents a rate.** A price with no approved figure and nothing typed
is refused. A supplier cost for a model not on the MMEM list is absent. An
installation allowance with no figure is withheld, not quoted at zero — a zero
reads as "no charge".

**Fixed price and provisional estimate are different promises**, and the
customer's page says which, beside the number. An allowance in the scope, a
room nobody measured, or a replacement with nothing said about the old system
all make it provisional on their own. Your own words about what has to be
confirmed are what the customer reads; the working behind it stays on your
screen.

**The approval was decoration and is not any more.** The builder has sent
`approvedBy` since the workflow was built and the server dropped it on the
floor, so no issued quote carried any record of who approved it. It is required
now — an issue with no approver mints no token — and it is frozen into the
offer with a fingerprint of that exact quote.

**Duplicated charges are reported, not removed.** A controller both included
and charged, an upgrade for a controller the quote already has, an upgrade also
in the inclusions, the same model quoted twice. Two of those are legitimate on
the right job, and silently deleting a line from somebody's quote is worse.

**The printable version is the same document.** One presentation object, one
renderer, the interactive furniture dropped. A separate print render could
disagree with the screen, which is exactly the September failure.

## Podium, and the AI ops assistant

**Neither is live, and nothing claims to be.** `docs/ops-integration.md` has
the diagram, the operations, the controls and the exact list of what is still
needed from each.

Podium is manual: an editable message you paste yourself, and a record that
tells **copying a link** from **sending a message** — because chasing a quote
nobody sent is the worst version of a follow-up. Every reason a follow-up stops
is its own state; an opt-out cannot be resumed by anybody.

The operations surface (`/api/ops`) is the half NAC owns. An assistant calls
in; this application never calls out. There is **no approve operation and no
pricing operation** — not scopes an assistant lacks, operations that do not
exist, so no key can ever be issued for them. Every money field is refused by
name. An accepted or declined offer cannot be changed. Everything that writes
needs an idempotency key, and a retry returns the first result rather than
opening a second customer, draft or booking task.

`NAC_OPS_KEYS` is unset, so every call answers 503 and says it is not connected
to anything.

Two of the requirements were stored rather than done, and are now both on
`/quotes.html`:

- **"Notify Nick that a quote needs approval."** `quote.request_approval` wrote
  the request onto the draft and no screen read it, so the operation notified
  nobody. The portal now shows what is waiting — who asked, what it is, what it
  is worth, the assistant's note, and whether it passes the gate *now* rather
  than when it was asked for. There is deliberately no approve button on that
  panel: Nick opens the quote and ticks the approval on the preview, which is
  the only place an approval can be made.
- **"Record actions and failures so NAC can see what happened."** Every call was
  written to the database and nothing read it back. The portal now lists them,
  newest first, with the reason for each refusal. And refusals were not being
  logged at all — the one kind of call NAC most needs to see, the assistant
  being told no, was the one kind leaving no trace. They are logged now, under
  their own id, so a refused call does not consume the caller's idempotency
  key.

**Nobody owns follow-up scheduling yet.** `SCHEDULING_OWNER` is `'undecided'`
in both engines and is read before anything would be scheduled. Two systems
that both believe they own it will both send, and it cannot be decided without
knowing whether Podium chases customers itself.

---

## What was tested, and where

| Checks | Where they ran |
|---|---|
| **800 node tests** — engines, gates, pricing, sizing, the offer freeze, the operations surface, the Podium state machine, the printable proposal | locally |
| **The real `/api/ops`, `/api/quote-issue`, `/api/quote-view`, `/api/quote-respond` handlers** end to end — a test enquiry to a customer, a job, a draft, a priced quote issued and accepted, a booking task, and every refusal | against a **local PostgreSQL carrying NAC's own schema** (`designer/schema.sql`, `quote-presentation-schema.sql`, `crm-schema.sql`, `ops-integration-schema.sql`) |
| **The whole journey in a real browser** at 1440px, 820px and 390px — a labelled test enquiry through to the Podium panel | locally, against the static server, database stubbed |
| **Every browser suite**: quote-builder, portal-podium, quote-page-customer, quote-presentation (50 checks), auth-gate, dialogs, customers-jobs, persistence-failure, persistence-settings, signed-in-smoke, system-choice, storage-sync-warning, setup-page | locally |
| **The rendered proposal and the A4 PDF**, looked at page by page | locally |

**Nothing ran against the live Supabase project, against the Vercel
deployment, against Podium, or against any assistant.** This environment's
network policy denies all four, which is stated here rather than worked
around.

### Defects the browser walkthrough found, which no unit test would have

- Typing a price left the markup and margin panel beside it reading "No price
  yet" until something else forced a redraw.
- The step navigation was unreachable on a phone: the header wraps to two lines
  and is taller than the offset the nav sticks at, so there was no way to
  change step on the device most likely to be in somebody's hand on site.
- A portal tile read "undefined" when the server sent no count.
- Four browser suites had broken when the designer came out — each covering
  something still live. Fixing them surfaced two more: the shared dialog
  component had lost its stylesheet, so a dialog on any page but `setup.html`
  rendered with 19px buttons on an iPad; and the page behind the sign-in gate
  was still in the accessibility tree and in `innerText`.
- The builder was not writing the customer and job records at all, so a quote
  the assistant opens had an identity and a quote you type had none.

---

## Blocked, and what I need

### 1. Deployment — a working test proposal link

I cannot reach `nac-quote-tool.vercel.app`, `vercel.com` or the Supabase
project from here; the network policy denies them. So there is **no live test
link in this delivery**, and the deployed Vercel environment is **not
verified**. That is a deployment action for you:

- Deploy this branch to a Vercel preview.
- Open `/api/server-key-selftest` on it. It returns pass/fail only — no key, no
  fragment, no length, no role detail. Confirm the server key is the
  **service role** key.
- Build a test quote in the builder with **This is a TEST quote** ticked, issue
  it, and open the link.

### 2. Two migrations, neither applied

Both are additive — new tables only, nothing existing touched. **I have not
applied either; there is no authorised development database connection from
here, and nothing in this work claims they are applied.**

- `designer/crm-schema.sql` — `nac_customers` and `nac_jobs`. Without it the
  builder simply does not link records and `enquiry.find_or_create` answers
  `customer_records_unavailable`.
- `designer/ops-integration-schema.sql` — `nac_integration_calls`, the
  idempotency record and the integration audit trail. Until it is applied,
  every operations-surface call that would change something is refused with
  `call_log_missing` rather than writing without the record that makes a retry
  safe.

### 3. Podium — six answers

1. API base URL and authentication method.
2. Whether NAC's plan includes API access at all, and for which inbox.
3. The endpoint that sends a message to a contact, and what identifies that
   contact.
4. Whether Podium can tell us a message was **delivered**, and whether a
   customer **replied**. Without the second, scheduling cannot live on the
   Podium side.
5. Whether Podium runs its own automated follow-up. This is the
   duplicate-message question and it decides who owns scheduling.
6. A test or sandbox inbox.

### 4. The AI ops assistant — six answers

**No assistant code or documentation exists in this repository.** I looked
before writing a line, and nothing about its capabilities has been assumed.

1. What it is — a hosted service, a scheduled script, part of another product?
2. How it would authenticate. The surface expects a bearer key NAC issues; if
   it can only do OAuth, or can only be called rather than call, that changes
   the shape.
3. Which operations it actually needs, so its key carries those scopes and no
   others.
4. Whether it, or Podium, owns follow-up scheduling. The most important answer
   on this page.
5. Where you want the approval request to arrive. Today it is recorded on the
   quote and shows in your list; a push, SMS or email needs a channel.
6. A test identity.

### 5. Content only NAC can supply

The **What is missing** tab in the content library is the live list, read off
the library as it stands. As it stands it asks for: installation photographs,
a wide cover photograph, product photographs of the units NAC fit, approved
reviews with their star ratings (Google's notification emails do not carry the
rating, so every review on file has `rating: null` and is refused), the
electrical contractor licence number when you have it, and manufacturer
brochures.

---

## Not restarted

Duct-designer development. Section 2 removed it and nothing here brings any of
it back.
