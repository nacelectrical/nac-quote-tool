-- NAC — THE INTEGRATION CALL LOG.
--
-- Nick, 4 November 2026: "Retries must not create duplicate customers, quotes,
-- messages or booking tasks." And: "Record actions and failures so NAC can see
-- what happened and retry safely."
--
-- One table does both jobs. Every call an integration makes through /api/ops
-- is written here against its idempotency key, with the request fingerprint and
-- the result. A retry carrying the same key gets the SAME result back instead of
-- doing the work twice; the same key carrying a different request is refused.
--
-- READ THIS BEFORE RUNNING IT. Everything here is ADDITIVE: one new table, no
-- existing table touched, no column renamed, no value changed. The application
-- works without it — server/ops.js probes for it and, if it is not there, says
-- so and refuses every operation that would change something, rather than
-- writing without a safety net.
--
-- To undo: the DROP statements at the foot of this file.

create table if not exists public.nac_integration_calls (
  -- The caller's idempotency key, scoped to the integration that sent it, so
  -- two integrations cannot collide on the same key.
  id             text primary key,        -- <integration>:<idempotencyKey>
  integration    text not null,           -- which key was used (its id, never its secret)
  operation      text not null,           -- e.g. quote.create_draft
  request_hash   text not null,           -- fingerprint of the request body
  status         text not null,           -- ok | refused | failed
  result         jsonb,                   -- what the first call returned
  refusals       jsonb,                   -- why it was refused, if it was
  quote_id       text,                    -- what it touched, for NAC to follow
  customer_id    text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists nac_integration_calls_op_idx
  on public.nac_integration_calls (operation, created_at desc);
create index if not exists nac_integration_calls_quote_idx
  on public.nac_integration_calls (quote_id);
create index if not exists nac_integration_calls_integration_idx
  on public.nac_integration_calls (integration, created_at desc);

-- ── Row level security ─────────────────────────────────────────────────────
-- NAC's own audit trail. Staff read it; the anon key in the page source reads
-- nothing here, and there is no anon policy at all. The surface itself writes
-- with the service-role key, server-side, which bypasses RLS by design.
alter table public.nac_integration_calls enable row level security;

drop policy if exists nac_integration_calls_staff_read on public.nac_integration_calls;

create policy nac_integration_calls_staff_read on public.nac_integration_calls
  for select to authenticated using (true);

-- ── Undo ───────────────────────────────────────────────────────────────────
--   drop policy if exists nac_integration_calls_staff_read on public.nac_integration_calls;
--   drop table if exists public.nac_integration_calls;
