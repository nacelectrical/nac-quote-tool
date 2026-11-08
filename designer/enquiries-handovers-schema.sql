-- ───────────────────────────────────────────────────────────────────────────
-- NAC — ENQUIRIES AND HANDOVERS GET A STORE OF THEIR OWN
--
-- ADDITIVE. NOT APPLIED. Nothing in this file drops, alters or rewrites an
-- existing table, and no row NAC already has is touched or migrated. Apply it
-- in the Supabase SQL editor.
--
-- WHY IT EXISTS
--
--   ENQUIRIES had no store. api/intake-submit.js wrote the customer's phone
--   number, their address and the whole AI sizing pack into the free-text
--   `notes` column of a row in nac_quotes — the QUOTE table — so nothing could
--   read an enquiry back as a record, count them, or follow one to the
--   assessment that came out of it.
--
--   HANDOVERS had no store either. designer/engines/handover.mjs builds and
--   validates one and nothing ever called it, so a prepared handover had
--   nowhere to live. (My own inspection report said they were "stored
--   locally". They were not stored at all. The report was wrong.)
--
-- WHAT HAPPENS TO THE OLD RECORDS: nothing. /api/enquiries reads the pre-table
-- enquiries out of the nac_quotes notes where they lie, marks them
-- `legacy_quote_notes`, and merges them with this table. There is no migration
-- pass to get half way through and no risk to NAC's history.
--
-- ORDER: this file is independent of designer/roles-schema.sql and either can
-- go first. Both are safe to re-run.
-- ───────────────────────────────────────────────────────────────────────────

-- ── ENQUIRIES ──────────────────────────────────────────────────────────────
--
-- The id is the one the intake already mints (`NAC-SMITH-1762567890123`) and
-- the one every link in NAC's sent mail already carries, so it is text and not
-- a generated uuid. A second identifier for the same enquiry would have made
-- every one of those links point at the wrong record.
create table if not exists public.nac_enquiries (
  id             text primary key,
  received_at    timestamptz not null default now(),
  -- intake_form | legacy_quote_notes | entered_by_staff | ops_integration
  source         text not null default 'intake_form',

  customer_name  text,
  phone          text,
  email          text,
  site_address   text,
  property_type  text,
  existing_ac    text,
  preferred_brand text,
  comments       text,

  plan_url       text,
  photo_urls     jsonb not null default '[]'::jsonb,

  -- The intake assistant's DRAFT NOTE, parsed into fields: conditioned area,
  -- indicative kW, confidence, action, flags, the rooms it counted and the
  -- rooms it did not. It is a proposal read off a photograph of a plan before
  -- anybody has been to the property. It is not an assessment, and the record
  -- carries `isDraftNote: true` so it cannot quietly become one.
  assessment     jsonb,

  -- new | assessing | quoted | closed
  state          text not null default 'new',
  closed_reason  text,

  -- ── WHAT CAME OF IT ──────────────────────────────────────────────────
  -- The links that were the whole point. An enquiry you cannot follow to its
  -- assessment and its quote is one you follow by searching for the
  -- customer's name and hoping.
  design_id      text,   -- nac_designs.id          (the assessment)
  quote_id       text,   -- nac_quotes.id           (the working quote)
  issued_token   text,   -- nac_quote_issues.token  (the revision that went out)
  legacy_quote_id text,  -- the nac_quotes row the intake has always written

  updated_at     timestamptz not null default now()
);

create index if not exists nac_enquiries_received_idx on public.nac_enquiries (received_at desc);
create index if not exists nac_enquiries_state_idx    on public.nac_enquiries (state);
create index if not exists nac_enquiries_design_idx   on public.nac_enquiries (design_id);
create index if not exists nac_enquiries_token_idx    on public.nac_enquiries (issued_token);

-- ── HANDOVERS ──────────────────────────────────────────────────────────────
--
-- THE PRIMARY KEY IS THE DUPLICATE RULE. `<token>:<revision>` — so a second
-- revision of the same quote gets its own handover, and a repeated prepare on
-- the same accepted revision cannot make a second one. /api/handover also
-- checks before it writes and returns the existing record with `repeat: true`,
-- but the guarantee does not depend on that code winning a race with itself:
-- the database refuses the second row.
--
-- A customer DOES retry an acceptance — quote-respond has carried replay
-- detection since acceptance existed — and a retry must never reset a deposit
-- somebody has already confirmed.
create table if not exists public.nac_handovers (
  id             text primary key,          -- '<quote token>:<revision>'
  quote_token    text not null,
  revision       integer not null default 1,
  design_id      text,

  -- prepared | ready_for_scheduling | pending_sync | synced | failed
  state          text not null default 'prepared',
  -- The ServiceM8 side, separately. NEVER 'synced' without external_id: the
  -- constraint below enforces it in the database, not just in the engine.
  sync_state     text not null default 'prepared',
  external_id    text,
  ready_to_book  boolean not null default false,

  prepared_by    text,
  prepared_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- The handover itself: the frozen scope, what was signed for, the three
  -- facts with their sources, and the site checks. `nac.handover.v1`.
  data           jsonb not null,

  constraint nac_handovers_one_per_revision unique (quote_token, revision),

  -- ── "SYNCED" IS NOT A WORD YOU MAY WRITE WITHOUT THE JOB ID ────────
  -- Nick: "Never display it as successfully synced." A row claiming the state
  -- with nothing behind it is refused outright, so no screen has to defend
  -- itself against one.
  constraint nac_handovers_synced_needs_id check (
    sync_state <> 'synced' or (external_id is not null and length(external_id) > 0)
  )
);

create index if not exists nac_handovers_token_idx on public.nac_handovers (quote_token);
create index if not exists nac_handovers_state_idx on public.nac_handovers (state);
create index if not exists nac_handovers_ready_idx on public.nac_handovers (ready_to_book);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
--
-- Both tables hold customer details. NEITHER gets an `anon` policy: with RLS
-- on and no policy for anon, the key that ships in every page's source reads
-- nothing here. The service role bypasses RLS, which is how the server
-- endpoints read and write them.
--
-- Signed-in NAC staff may read. Taking an enquiry and preparing a handover is
-- a technician's job, and there are no costs or margins in either table — the
-- figures that need the owner role live in nac_settings, which
-- designer/roles-rls.sql closes.
alter table public.nac_enquiries enable row level security;
alter table public.nac_handovers enable row level security;

drop policy if exists nac_enquiries_staff_read on public.nac_enquiries;
drop policy if exists nac_handovers_staff_read on public.nac_handovers;

create policy nac_enquiries_staff_read on public.nac_enquiries
  for select to authenticated using (true);

create policy nac_handovers_staff_read on public.nac_handovers
  for select to authenticated using (true);

-- Deliberately NO insert/update/delete policy for `authenticated`. Both tables
-- are written only by the server endpoints with the service-role key, so every
-- write goes through the rules in server/enquiries.js and server/handover.js —
-- the link-conflict check, the duplicate rule, and the demotion of a
-- confirmation that has no source. A browser that could write directly would
-- bypass all three.

-- ── VERIFY ─────────────────────────────────────────────────────────────────
-- Run this after applying. Both rows should say `t`.
--
--   select 'nac_enquiries' as table_name, to_regclass('public.nac_enquiries') is not null as exists
--   union all
--   select 'nac_handovers', to_regclass('public.nac_handovers') is not null;

-- ── UNDO ───────────────────────────────────────────────────────────────────
-- Only for backing out. This DOES destroy the enquiry and handover records;
-- the nac_quotes rows the intake writes are untouched either way.
--
--   drop table if exists public.nac_handovers;
--   drop table if exists public.nac_enquiries;
