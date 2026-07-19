-- Unique circuit numbers per panel on a sheet (prevents mash-click duplicates).

create unique index if not exists circuits_sheet_panel_number_uidx
  on circuits (sheet_id, panel_device_id, number);

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('008_circuits_unique.sql')
  on conflict do nothing;
