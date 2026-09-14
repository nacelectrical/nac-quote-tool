-- ============================================================================
-- NAC — SCHEMA DIAGNOSTIC.  Run this FIRST, in the Supabase SQL editor.
-- ============================================================================
--
-- READ ONLY. It creates nothing, changes nothing, deletes nothing. It answers
-- one question: what is actually in the live database right now, compared with
-- what the application expects.
--
-- Paste the whole file and press Run. The result is one table you can read top
-- to bottom. Send it back if anything says MISSING.
--
-- Columns:
--   SECTION  what part of the picture the row belongs to
--   ITEM     the thing being reported
--   DETAIL   what was found
-- ============================================================================

drop table if exists _nac_diag;
create temp table _nac_diag (ord int, section text, item text, detail text);

do $diag$
declare
  t           text;
  c           text;
  n           bigint;
  rls         boolean;
  has_table   boolean;
  ord         int := 0;
  wanted      text[] := array['nac_quotes', 'nac_settings', 'nac_designs',
                              'nac_customers', 'nac_jobs'];
  needed_cols text[];
begin
  -- ── 1. What the application expects, and whether it is there ─────────────
  foreach t in array wanted loop
    ord := ord + 1;
    has_table := to_regclass('public.' || t) is not null;
    if has_table then
      execute format('select count(*) from public.%I', t) into n;
      select relrowsecurity into rls from pg_class
        where oid = to_regclass('public.' || t);
      insert into _nac_diag values (100 + ord, 'EXPECTED TABLE', t,
        'PRESENT · ' || n || ' row(s) · row level security ' ||
        case when rls then 'ON' else 'OFF' end);
    else
      insert into _nac_diag values (100 + ord, 'EXPECTED TABLE', t,
        'MISSING · nothing in public is named this');
    end if;
  end loop;

  -- ── 2. Every other table in public, so a differently named one shows up ──
  ord := 0;
  for t in
    select c.relname from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r', 'p')
       and not (c.relname = any (wanted))
     order by c.relname
  loop
    ord := ord + 1;
    execute format('select count(*) from public.%I', t) into n;
    select relrowsecurity into rls from pg_class where oid = to_regclass('public.' || t);
    insert into _nac_diag values (200 + ord, 'OTHER TABLE IN PUBLIC', t,
      n || ' row(s) · row level security ' || case when rls then 'ON' else 'OFF' end);
  end loop;
  if ord = 0 then
    insert into _nac_diag values (201, 'OTHER TABLE IN PUBLIC', '(none)',
      'Nothing else is in the public schema.');
  end if;

  -- ── 3. The columns the setup script and the policies depend on ───────────
  -- A policy that compares a column cannot be created if the column is not
  -- there, so this is checked before anything is run, not after it fails.
  ord := 0;
  for t, needed_cols in
    select * from (values
      ('nac_quotes',   array['id','client','job_desc','line_items','accepted']),
      ('nac_settings', array['key','value']),
      ('nac_designs',  array['id','design'])
    ) as v(tbl, cols)
  loop
    if to_regclass('public.' || t) is null then
      ord := ord + 1;
      insert into _nac_diag values (300 + ord, 'REQUIRED COLUMN', t,
        'table is MISSING, so its columns could not be checked');
      continue;
    end if;
    foreach c in array needed_cols loop
      ord := ord + 1;
      insert into _nac_diag values (300 + ord, 'REQUIRED COLUMN', t || '.' || c,
        coalesce((select 'PRESENT · ' || data_type from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = c),
                 'MISSING'));
    end loop;
  end loop;

  -- ── 4. Columns the setup script would add ────────────────────────────────
  ord := 0;
  for t, c in
    select * from (values
      ('nac_designs','customer_id'), ('nac_designs','job_ref'),
      ('nac_quotes','customer_id'),  ('nac_quotes','job_ref'),
      ('nac_quotes','servicem8_status'), ('nac_quotes','servicem8_job_uuid'),
      ('nac_quotes','servicem8_job_id'), ('nac_quotes','servicem8_company_uuid'),
      ('nac_quotes','servicem8_error'),  ('nac_quotes','servicem8_attempted_at')
    ) as v(tbl, col)
  loop
    ord := ord + 1;
    insert into _nac_diag values (400 + ord, 'COLUMN TO BE ADDED', t || '.' || c,
      case when to_regclass('public.' || t) is null then 'table is MISSING'
           when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = t and column_name = c)
             then 'already there — the script will skip it'
           else 'not there — the script will add it (nullable, nothing is changed)'
      end);
  end loop;

  -- ── 5. Designs living in the key/value fallback ──────────────────────────
  -- Before nac_designs exists, designer/engines/store.mjs saves each design as
  -- an nac_settings row keyed nac_design_<id>. Those are real saved designs and
  -- the count below is how many would otherwise stop appearing in the list.
  if to_regclass('public.nac_settings') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='nac_settings' and column_name='key') then
    execute $q$select count(*) from public.nac_settings where key like 'nac\_design\_%'$q$ into n;
    insert into _nac_diag values (501, 'SAVED DESIGNS IN THE FALLBACK',
      'nac_settings rows keyed nac_design_*', n || ' design(s)');
    execute $q$select count(*) from public.nac_settings where key in ('nac_customers_v1','nac_jobs_v1')$q$ into n;
    insert into _nac_diag values (502, 'SAVED CUSTOMERS IN THE FALLBACK',
      'nac_settings rows nac_customers_v1 / nac_jobs_v1',
      n || ' row(s) — migrated by /setup.html, not by SQL');
  else
    insert into _nac_diag values (501, 'SAVED DESIGNS IN THE FALLBACK', 'nac_settings',
      'could not be counted — the table or its key column is MISSING');
  end if;

  -- ── 6. Policies that exist today ─────────────────────────────────────────
  ord := 0;
  for t, c in
    select tablename, policyname from pg_policies
     where schemaname = 'public' order by tablename, policyname
  loop
    ord := ord + 1;
    insert into _nac_diag values (600 + ord, 'EXISTING POLICY', t, c);
  end loop;
  if ord = 0 then
    insert into _nac_diag values (601, 'EXISTING POLICY', '(none)',
      'No row level security policies exist in public.');
  end if;

  -- ── 7. Server version, for the record ────────────────────────────────────
  insert into _nac_diag values (700, 'SERVER', 'postgres', version());
end
$diag$;

select section, item, detail from _nac_diag order by ord;
