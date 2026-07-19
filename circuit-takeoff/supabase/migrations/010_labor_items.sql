-- Labor foundation: per-user labor units keyed by takeoff item name.
-- Seed NOTHING — values come from the company or a licensed manual.

create table if not exists labor_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  item_key text not null,          -- matches takeoff item name, e.g. '1/2" EMT'
  uom text not null,               -- LF or EA
  hours_per_uom numeric not null,  -- company value
  source text not null default 'company'
    check (source in ('company', 'licensed')),
  notes text,
  unique (user_id, item_key)
);

-- RLS: owner-only, all verbs.
alter table labor_items enable row level security;

drop policy if exists "labor_items_owner" on labor_items;
create policy "labor_items_owner" on labor_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('010_labor_items.sql')
  on conflict do nothing;
