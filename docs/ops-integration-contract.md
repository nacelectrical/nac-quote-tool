# `quote.board` — the contract, for `nac-ops-assistant`

**Status: implemented and tested. Not connected.** `/api/ops` answers **503
`integration_not_configured`** on every operation until `NAC_OPS_KEYS` is set,
and no key has been issued. Everything below is proven against a real
PostgreSQL in `tests/quote-board-contract.test.mjs`; none of it is proven
against the assistant, because nothing has called it yet.

Written 8 November 2026, after adding four stages. **Nothing was renamed and
nothing changed meaning.**

---

## 1. What did NOT change

The assistant is implementing this interface now, so this is the part that
matters. All of it is byte-for-byte what it was:

| | |
|---|---|
| Operation name | `quote.board` |
| Scope | `quote:read` |
| Mutates | no — there is no write anywhere in it |
| Request | `{ "operation": "quote.board", "limit": 50 }` |
| `stages.awaitingResponse` | same panel shape, same item fields |
| `stages.accepted` | same panel shape, same item fields |
| `money` | `awaitingResponseIncGst`, `acceptedIncGst`, `note` |
| `notYetExposed` | still an array — now empty |
| `generatedAt` | ISO 8601 |

A consumer written against the November 8 contract reads the new response
correctly without being changed.

## 2. What was added

Four stages and one field. All additive.

| Added | Scope | What it is |
|---|---|---|
| `stages.enquiries` | `quote:read` | Enquiries not yet quoted, and what each is missing |
| `stages.draftsInProgress` | `quote:read` | Quotes being prepared, with blocker **codes** |
| `stages.awaitingOwnerApproval` | `quote:read` | Drafts waiting on Nick |
| `stages.handovers` | `quote:read` | Accepted work, and whether it can be booked |
| `sources` | — | Which sources answered: `ok` / `unreadable` / `not_created` |

Every new stage is the same panel shape as the two that existed:

```jsonc
{ "available": true, "count": 3, "items": [ … ], "truncated": false }
```

---

## 3. Request

```
POST /api/ops
Authorization: Bearer <the key NAC issues you>
Content-Type: application/json

{ "operation": "quote.board", "limit": 50 }
```

`limit` is optional, defaults to 50, and is capped at 200. **It truncates the
list and never the count** — see §5.

No other input is read. Money fields are refused by name on the way in, as on
every operation.

## 4. Response

```jsonc
{
  "generatedAt": "2026-11-08T08:30:00.000Z",
  "source": "NAC quote tool. Enquiries, drafts, issued revisions, acceptances and handovers.",

  "stages": {
    "enquiries": {
      "available": true, "count": 2, "truncated": false,
      "items": [
        { "ref": "NAC-EXAMPLE-1762567890123", "stage": "enquiry",
          "name": "A Customer", "site": "7 Example Court, Testville QLD 4000",
          "ageDays": 1, "totalIncGst": null, "totalSource": null,
          "action": "Start the assessment" },
        { "ref": "NAC-EXAMPLE-1762567999999", "stage": "enquiry",
          "name": "Unnamed enquiry", "site": "No address yet",
          "ageDays": 0, "totalIncGst": null, "totalSource": null,
          "action": "Fill in customer name, site address" }
      ]
    },

    "draftsInProgress": {
      "available": true, "count": 1, "truncated": false,
      "items": [
        { "ref": "Q-20261108-AB12C", "stage": "assessing",
          "name": "Another Customer", "site": "9 Example Street",
          "ageDays": 0, "blockerCount": 2,
          "blockers": ["DRAFT_NO_PRICE", "DRAFT_NO_SCOPE"],
          "action": "2 thing(s) to finish" }
      ]
    },

    "awaitingOwnerApproval": {
      "available": true, "count": 1, "truncated": false,
      "items": [
        { "ref": "Q-20261107-ZZ99Y", "stage": "awaiting_approval",
          "name": "Third Customer", "site": "11 Example Parade",
          "ageDays": 2, "blockerCount": 0, "blockers": [],
          "action": "Read the preview and approve it" }
      ]
    },

    "awaitingResponse": {
      "available": true, "count": 2, "truncated": false,
      "items": [
        { "ref": "<issue token>", "stage": "issued", "name": "A Customer",
          "site": "7 Example Court", "ageDays": 9,
          "totalIncGst": 15716, "totalSource": "issued revision",
          "action": "Opened, no answer yet" }
      ]
    },

    "accepted": {
      "available": true, "count": 1, "truncated": false,
      "items": [
        { "ref": "<issue token>", "stage": "accepted", "name": "A Customer",
          "site": "2 Example Road", "ageDays": 0,
          "totalIncGst": 21000, "totalSource": "acceptance record",
          "action": "2 thing(s) before it can be booked" }
      ]
    },

    "handovers": {
      "available": true, "count": 1, "truncated": false,
      "items": [
        { "ref": "<issue token>:1", "quoteToken": "<issue token>", "revision": 1,
          "stage": "prepared", "name": "A Customer", "site": "2 Example Road",
          "readyToBook": false,
          "deposit": "unknown", "equipment": "confirmed", "scheduling": "not_yet",
          "outstandingCount": 2, "externalId": null }
      ]
    }
  },

  "notYetExposed": [],

  "money": {
    "awaitingResponseIncGst": 15716,
    "acceptedIncGst": 21000,
    "note": "Issued revisions and acceptance records only. Drafts are not counted."
  },

  "sources": {
    "issued": "ok", "drafts": "ok", "enquiries": "ok", "handovers": "ok"
  }
}
```

Every id above is an example. No real customer, no real token.

### Vocabularies

`stage` on an item — `enquiry`, `assessing`, `awaiting_approval`, `issued`,
`accepted`.

`stage` on a **handover** — and these five are the ones that matter most:

| | |
|---|---|
| `prepared` | Written down. Something is still outstanding. |
| `ready_for_scheduling` | Deposit, equipment and date all confirmed **with a source**, every site check closed. It can be booked. |
| `pending_sync` | NAC wants ServiceM8 to have it; ServiceM8 has not confirmed. |
| `synced` | ServiceM8 confirmed, **with a job id**. Never without one. |
| `failed` | The attempts ran out. A person has to look at it. |

Blocker codes are the closed vocabulary `DRAFT_BLOCK` in
`designer/engines/quote-draft.mjs`: `DRAFT_NO_EQUIPMENT`, `DRAFT_NO_PRICE`,
`DRAFT_BAD_PRICE`, `DRAFT_NO_CUSTOMER`, `DRAFT_NO_SCOPE`,
`DRAFT_OPTION_UNPRICED`, `DRAFT_OPTION_INCOMPATIBLE`,
`DRAFT_SENSOR_COUNT_NOT_SET`, `DRAFT_ZONE_COUNT_MISMATCH`,
`DRAFT_OUTLET_COUNT_MISMATCH`, `DRAFT_CONTROLLER_TOO_SMALL`,
`DRAFT_NO_CONTROLLER`. Treat an unrecognised code as "something to finish"
rather than failing on it — the list can grow.

`deposit` / `equipment` / `scheduling` — `unknown` (nobody has checked),
`confirmed` (checked, true, with a source recorded), `not_yet` (checked, and
not true yet).

**`unknown` and `not_yet` both mean outstanding.** "Has anybody checked?" and
"yes, and no" lead to the same next action.

---

## 5. The three rules the join depends on

**1. `count` is null when the source could not be read, never 0.** If the
assistant's briefing turns a null into a zero, it will say "nothing waiting on
the customer" on the one morning that is false. The quote tool holds the same
rule on its own board and in `designer/engines/workflow.mjs`.

`available: false` and `count: null` always travel together. `items` is `[]`
and must not be read as the answer.

**2. `count` is the true total; `limit` truncates only `items`.** A briefing
that says "3 waiting" because the page size was 3 under-reports the week.
`truncated` says when the list was cut.

**3. `sources` says which tables answered.** `not_created` means a migration
has not been applied yet — different from `unreadable`, and not an error.

---

## 6. What this will never carry

Checked by test, not by intention (`tests/quote-board-contract.test.mjs`):

- **No customer contact details.** No phone number, no email address, at any
  stage. The assistant reaches customers through Podium and ServiceM8, where
  their details already are.
- **No internal costs or margins.** No supplier price, no job fee, no
  installation allowance, no contingency, no `pricedBy` block. The only money
  is the customer-facing total, and every figure names its source.
- **No blocker prose.** The gate's messages are written for an estimator and
  several carry money — "3 line(s) are on rates that shipped with the
  application, worth $1,240.00". The board sends the **codes** and the count.
  There is a test that fails if a `$` appears anywhere in the response.

## 7. Errors

| Status | Body | Means |
|---|---|---|
| 503 | `{"error":"integration_not_configured","live":false}` | **Today's answer to everything.** `NAC_OPS_KEYS` is unset. |
| 401 | `{"error":"unauthorised"}` | No key, or a key that does not match. |
| 403 | `{"error":"scope_required", …}` | The key does not carry `quote:read`. |
| 400 | `{"error":"unknown_operation"}` | Misspelled operation. |
| 200 | a board with `available: false` on a stage | One source failed. **Not an error** — the rest of the board is good. |

A per-stage failure is a 200. The board does not go down because one table did.

## 8. What is NOT offered, and will not be

- **No `quote.approve`.** Not a scope the assistant lacks — an operation that
  does not exist, so no key can be issued for one. Nick approves the exact
  revision in this application, and the approval is bound to a fingerprint of
  the offer so it cannot travel to a changed one.
- **No price in, ever.** Every money field is refused by name.
- **No write to an accepted or declined offer.**
- **No Supabase credentials.** Direct database access would bypass every rule
  this application enforces about revisions, freezing and acceptance. The
  `/api/ops` key is the whole interface.
- **No call from this application to the assistant.** One direction: the
  assistant pulls.

## 9. To turn it on

Three steps, all NAC's, none of them code:

1. Apply `designer/ops-integration-schema.sql` — the call log, which is also
   the idempotency record. (Not needed for `quote.board`, which is read-only,
   but needed before any write operation.)
2. Apply `designer/enquiries-handovers-schema.sql`, or `stages.enquiries` and
   `stages.handovers` report `not_created`.
3. Set `NAC_OPS_KEYS` in the Vercel environment to a JSON array:

```jsonc
[ { "id": "ops-assistant",
    "name": "NAC ops assistant",
    "secret": "<generated, at least 32 characters>",
    "scopes": ["quote:read"] } ]
```

A read-only key carries `quote:read` and nothing else. Generate the secret with
`openssl rand -base64 32`, put it in Vercel and in the assistant's own
environment, and **do not paste it into a chat or a commit.**

## 10. Still to agree

Unchanged from `docs/two-projects.md`, and neither blocks this interface:

1. **A shared customer id across both systems.** Proposal: the ServiceM8 client
   uuid, since that is the one system both already touch. `quote.board` carries
   NAC's own refs today (`ref` is an enquiry id, a design id or an issue token).
2. **Who chases a customer for an answer** — Podium, ServiceM8 automation, or
   the assistant. Until that is set, neither system should message anybody.
   Worth re-reading the assistant's own finding that Podium ships an "AI
   Employee" lead follow-up feature.
