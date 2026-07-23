-- Labor rate tables + per-sheet difficulty (Prompt 12).
-- Rate/price computation only — takeoff quantities are untouched.

-- ————— rate_tables: e.g. "Non-union 2026", "Union" —————
create table if not exists rate_tables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table rate_tables enable row level security;
drop policy if exists "rate_tables_owner" on rate_tables;
create policy "rate_tables_owner" on rate_tables
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ————— labor_classes: rows per table (Foreman, Journeyman, …) —————
-- loaded_rate = base_rate × (1 + burden_pct/100) + burden_flat_per_hr
-- (computed in the app — single source of truth in src/lib/pricing.ts).
create table if not exists labor_classes (
  id uuid primary key default gen_random_uuid(),
  rate_table_id uuid references rate_tables on delete cascade not null,
  class_name text not null,
  base_rate numeric not null default 0,
  burden_pct numeric not null default 0,
  burden_flat_per_hr numeric not null default 0,
  is_field boolean not null default true,
  crew_weight numeric not null default 0
);

alter table labor_classes enable row level security;
drop policy if exists "labor_classes_owner" on labor_classes;
create policy "labor_classes_owner" on labor_classes
  for all using (
    exists (
      select 1 from rate_tables t
      where t.id = rate_table_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from rate_tables t
      where t.id = rate_table_id and t.user_id = auth.uid()
    )
  );

-- ————— sheets gain a difficulty level (1/2/3, default 1) —————
alter table sheets add column if not exists difficulty int not null default 1
  check (difficulty in (1, 2, 3));

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..013 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('013_labor_rates.sql')
  on conflict do nothing;
