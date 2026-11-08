# What this change needs from you

**8 November 2026.** Six foundations built on `claude/nac-ai-hvac-designer-9oda35`.
Nothing is merged, no migration has been run against the live database, and no
external write has been enabled.

Three things are yours and nothing works properly without them: the migrations,
the pricing figures, and naming an owner. Each is below with the exact steps.

---

## 1. Migrations, in this order

Run them in the Supabase SQL editor. Every one is additive — no table is
dropped, no row is rewritten, and each is safe to re-run.

| # | File | What it does | Safe to run before merge? |
|---|---|---|---|
| 1 | `designer/enquiries-handovers-schema.sql` | Creates `nac_enquiries` and `nac_handovers`. | **Yes.** Nothing reads them until the code deploys. |
| 2 | `designer/roles-schema.sql` | Creates `nac_staff_roles`, `nac_is_owner()`. Changes no policy. | **Yes.** It closes nothing. |
| 3 | **Name the owners** — the commented `INSERT` at the foot of file 2 | Only you can decide this. | Yes. |
| 4 | `designer/roles-rls.sql` | **Closes `nac_settings` to anybody who is not an owner.** | Yes, but see the warning. |

### The warning on step 4

`nac_settings` holds the supplier cost prices, the job fee and the installation
allowances, and **the browser reads that table directly** with the signed-in
user's own token. So the policy is the only thing that actually restricts them
— hiding the fields in a page would be theatre.

**Run step 4 before step 3 and you lock yourself out of your own pricing
screen.** The file has a guard that refuses to run when no owner is named, so
the mistake is caught rather than discovered. Verify before running it:

```sql
select user_email, role from public.nac_staff_roles order by role, user_email;
```

At least one `owner` row has to come back.

### Also outstanding, from before this change

`designer/ops-integration-schema.sql` has **not** been applied. It is the
`/api/ops` call log and idempotency record. `quote.board` is read-only and does
not need it; any write operation does.

---

## 2. Deployment order

1. **Set `NAC_OWNER_EMAILS` in the Vercel environment first.** Your sign-in
   email, comma separated if there is more than one owner. Server-side only; it
   never reaches a browser.

   Without it, **nobody is an owner** — including you. That is deliberate: a
   permission layer whose unconfigured state is "everybody" is the bug this
   change fixes. The screens say exactly this and name the variable, so it is
   recoverable in thirty seconds, but it is better not to meet it.

2. Run migrations 1 and 2, then name the owners (3).
3. Merge to `main`. Vercel deploys.
4. Run migration 4.
5. Check `/api/whoami` signed in as yourself: `role` should read `owner` and
   `rolesConfigured` should be `true`.
6. Open `/settings.html` and enter the figures in §3 below.

### Environment variables

Names only. Do not paste a value into a chat or a commit.

| Variable | State | Needed for |
|---|---|---|
| `NAC_OWNER_EMAILS` | **NEW — set this first** | Owner/technician separation |
| `SUPABASE_KEY` | existing | Every server endpoint. Must be the **service role** key |
| `ANTHROPIC_API_KEY` | existing | The plan reader and the intake |
| `NAC_OPS_KEYS` | unset | `/api/ops`. Unset means 503 on every operation |
| `SERVICEM8_API_KEY` | unset here | Not used by this change |
| `GHL_API_KEY`, `GHL_LOCATION_ID`, `NAC_NOTIFY_WEBHOOK` | existing | Intake notification |
| `NAC_PUBLIC_BASE_URL` | existing | Customer links |

**Which of these are actually set in production is unverified.** Outbound
traffic to `vercel.app` and `supabase.co` is blocked from the development
sandbox, so I cannot read the environment. Checking it is a deployment action.

---

## 3. The pricing figures I need from you

These are NAC's own commercial numbers and nobody else can supply them. Enter
them on **`/settings.html`** (Pricing setup), which is new — until today there
was no screen in the application with these fields on it at all, which is why
the pricing engine has never priced anything.

Every one ships **empty**, and empty means *not set*: the engine refuses rather
than treating it as free. A **0 you type is a decision** and is honoured as
zero.

### Required — nothing is suggested without these

| Field | Unit | Note |
|---|---|---|
| **Job fee** | dollars per job | On NAC's method the fee **is** the margin. Currently sitting on **6000**, which **shipped with the application** — I do not know whether you agreed to it. The screen flags it as unconfirmed until you save it yourself. |
| **At least one installation allowance** | below | Any one unblocks the engine; the more that are set, the less the single figure has to carry. |

### The installation allowances

What the installation is worth before anybody has measured a duct.

| Field | Unit |
|---|---|
| Ductwork | dollars per job |
| Return air | dollars per job |
| Plenums | dollars per job |
| Electrical | dollars per job |
| Refrigeration | dollars per job |
| Condensate | dollars per job |
| Installation labour | dollars per job — only where it is not already inside the job fee |
| Roof access and site difficulty | dollars per job |
| **One flat installation allowance** | dollars per job — use this **instead of** the breakdown above if that is how you price, not as well as it |
| Per supply outlet | dollars per outlet |
| Per motorised zone | dollars per zone |
| Contingency | percent of job cost — optional |

### Confirm or change

| Field | Shipped as | Why it is asked |
|---|---|---|
| **GST rate** | 10% | Right for Australia. Save it and it stops being a default. |
| **Is the job fee ex or inc GST?** | excluding | Get this wrong by one step and every quote is out by 10%. |

### Not set here

**Equipment cost.** It comes off the price list per job — the MMEM trade cost on
the brand, or a figure typed on the quote — and the quote screen says which it
used.

### What stays blocked while these are empty

Only the **suggested** price ("Work out the price" on the Systems step).

Drafts, assessments, room measurements, the sizing, site checks and handovers
all save as normal, and **a price you type by hand still works and still
issues**. The estimator is never stopped from recording what they found on
site.

---

## 4. Naming an owner

Two ways; either is enough, and the first is the quickest.

**A. The environment variable.** `NAC_OWNER_EMAILS=you@yourdomain` in Vercel.

**B. The roles table.** After migration 2:

```sql
insert into public.nac_staff_roles (user_email, role, note)
values (lower('you@yourdomain'), 'owner', 'Business owner')
on conflict (user_email) do update set role = excluded.role;
```

Technicians need no row — anybody without one is treated as a technician — but
a row makes the list readable:

```sql
insert into public.nac_staff_roles (user_email, role, note)
values (lower('tech@yourdomain'), 'technician', 'Install crew')
on conflict (user_email) do update set role = excluded.role;
```

There is a third path, for completeness: `app_metadata.nac_role` on the
Supabase user, which only a Supabase admin can write. `user_metadata` is
deliberately **not** read — a user can write their own, so reading a role from
it would let any account promote itself.

### What a technician can and cannot do

| | Owner / admin | Technician |
|---|---|---|
| Take an enquiry, upload a plan, measure rooms, run the sizing | ✓ | ✓ |
| Save a draft, record site checks | ✓ | ✓ |
| See the list of issued quotes and where each stands | ✓ | ✓ |
| Prepare a handover; confirm equipment and the installation date | ✓ | ✓ |
| See supplier costs, the job fee, the allowances | ✓ | ✗ |
| Change the pricing settings | ✓ | ✗ |
| Approve and issue a customer quote | ✓ | ✗ |
| Confirm a **deposit** | ✓ | ✗ |

A customer still reaches their own issued proposal through their link and
nothing else — unchanged.

### What I could not inspect

**Your Supabase user list.** Egress to `supabase.co` is blocked from the
sandbox, so I do not know which accounts exist or who should be an owner, and I
have not guessed: no owner is seeded anywhere in the code or the migrations.

---

## 5. What is still not connected

Unchanged by this work, and stated so it is not assumed:

- **ServiceM8** — not written to from this project. A handover never reads
  `synced`, and the database refuses a row that claims to be without a job id.
- **Xero** — not present. A deposit is confirmed by hand, against its source.
- **Podium** — manual only. The portal records a *copied link* as copied, never
  as sent.
- **`/api/ops`** — 503 on every operation. No key issued.
- **The ops assistant** — has no code that calls this application. The contract
  it is being built against is `docs/ops-integration-contract.md`.

---

## 6. The two decisions still waiting on you

Neither blocks anything, and the first is the one I would settle first:

1. **Who chases a customer for an answer** — Podium, ServiceM8 automation, or
   the assistant. Until one owns it, neither system should message anybody. The
   assistant's own findings record that Podium ships an **"AI Employee" lead
   follow-up** feature; if that is switched on for NAC, something is already
   messaging customers.
2. **Whether the assistant may read drafts and pending approvals.** It can now
   — `quote.board` exposes both — so this is a question about the key you issue,
   not about the code. A read-only key with `quote:read` sees all six stages;
   there is no narrower scope today.
