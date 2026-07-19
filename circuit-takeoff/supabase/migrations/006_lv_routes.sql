-- LV routes share `routes` with power: nullable circuit_id + sheet_id + lv_system.
-- Dimming follows power geometry (not stored). Thermostats never route.

alter table routes alter column circuit_id drop not null;

alter table routes
  add column if not exists sheet_id uuid references sheets on delete cascade;

alter table routes
  add column if not exists lv_system text;

alter table routes drop constraint if exists routes_lv_system_check;
alter table routes add constraint routes_lv_system_check
  check (lv_system is null or lv_system in ('fire', 'data'));

alter table routes drop constraint if exists routes_power_or_lv;
alter table routes add constraint routes_power_or_lv check (
  (
    circuit_id is not null
    and lv_system is null
  )
  or (
    circuit_id is null
    and sheet_id is not null
    and lv_system is not null
  )
);

-- Backfill sheet_id for any legacy rows that somehow lack circuit (none expected).
-- Power routes keep sheet_id null; LV always set sheet_id.

drop policy if exists "routes_owner" on routes;
create policy "routes_owner" on routes
  for all using (
    (
      circuit_id is not null
      and exists (
        select 1 from circuits c
        join sheets s on s.id = c.sheet_id
        join projects p on p.id = s.project_id
        where c.id = circuit_id and p.user_id = auth.uid()
      )
    )
    or (
      sheet_id is not null
      and exists (
        select 1 from sheets s
        join projects p on p.id = s.project_id
        where s.id = sheet_id and p.user_id = auth.uid()
      )
    )
  )
  with check (
    (
      circuit_id is not null
      and exists (
        select 1 from circuits c
        join sheets s on s.id = c.sheet_id
        join projects p on p.id = s.project_id
        where c.id = circuit_id and p.user_id = auth.uid()
      )
    )
    or (
      sheet_id is not null
      and exists (
        select 1 from sheets s
        join projects p on p.id = s.project_id
        where s.id = sheet_id and p.user_id = auth.uid()
      )
    )
  );

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('006_lv_routes.sql')
  on conflict do nothing;
