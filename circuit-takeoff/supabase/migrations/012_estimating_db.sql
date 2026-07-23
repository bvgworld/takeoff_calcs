-- Estimating database: items (materials w/ price) + assemblies (what gets
-- stamped/taken off, labor hours per difficulty level, item list).
-- Replaces the labor library: labor_items rows are migrated into
-- assemblies (hours become level-1 hours). labor_items is NOT dropped —
-- we stop writing to it and hide its UI.

-- ————— Shared normalize function —————
-- MUST stay in sync with normalizeItemKey in src/lib/labor.ts:
-- smart quotes/primes → straight quotes, collapse whitespace, trim, lower.
create or replace function normalize_item_key(s text)
returns text
language sql
immutable
as $fn$
  select lower(btrim(regexp_replace(
    translate(s, '“”″‘’′', $q$"""'''$q$),
    '\s+', ' ', 'g'
  )));
$fn$;

-- ————— items: materials with current price —————
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  name_normalized text not null,
  uom text not null check (uom in ('EA', 'LF', '100LF')),
  cost_per_uom numeric not null default 0,
  supplier text,
  quote_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name_normalized, uom)
);

alter table items enable row level security;
drop policy if exists "items_owner" on items;
create policy "items_owner" on items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ————— assemblies: takeoff keys with labor hours per difficulty —————
create table if not exists assemblies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  name_normalized text not null,
  uom text not null check (uom in ('EA', 'LF')),
  hours_l1 numeric,
  hours_l2 numeric,
  hours_l3 numeric,
  pricing_mode text not null default 'computed'
    check (pricing_mode in ('computed', 'flat')),
  flat_price numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name_normalized)
);

alter table assemblies enable row level security;
drop policy if exists "assemblies_owner" on assemblies;
create policy "assemblies_owner" on assemblies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ————— assembly_items: item list per assembly —————
-- qty_per_uom: for an EA assembly, qty per each; for an LF assembly, qty
-- per linear foot (e.g. 1/2" EMT assembly includes 0.1 couplings per LF).
create table if not exists assembly_items (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid references assemblies on delete cascade not null,
  item_id uuid references items on delete cascade not null,
  qty_per_uom numeric not null
);

alter table assembly_items enable row level security;
drop policy if exists "assembly_items_owner" on assembly_items;
create policy "assembly_items_owner" on assembly_items
  for all using (
    exists (
      select 1 from assemblies a
      where a.id = assembly_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from assemblies a
      where a.id = assembly_id and a.user_id = auth.uid()
    )
  );

-- ————— Migrate labor_items → assemblies —————
-- hours_l1 = hours_per_uom. 100LF rows are stored per-LF: divide by 100
-- and note the conversion. pricing_mode='computed', no items attached.
-- Conflicts (same user + normalized name) keep the existing assembly.
insert into assemblies
  (user_id, name, name_normalized, uom, hours_l1, pricing_mode, notes)
select
  li.user_id,
  li.item_key,
  normalize_item_key(li.item_key),
  case when upper(btrim(li.uom)) = '100LF' then 'LF'
       else upper(btrim(li.uom)) end,
  case when upper(btrim(li.uom)) = '100LF' then li.hours_per_uom / 100
       else li.hours_per_uom end,
  'computed',
  case when upper(btrim(li.uom)) = '100LF'
       then coalesce(li.notes || ' · ', '')
            || 'Converted from ' || li.hours_per_uom || ' hrs/100LF'
       else li.notes end
from labor_items li
where upper(btrim(li.uom)) in ('EA', 'LF', '100LF')
on conflict (user_id, name_normalized) do nothing;

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..012 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('012_estimating_db.sql')
  on conflict do nothing;
