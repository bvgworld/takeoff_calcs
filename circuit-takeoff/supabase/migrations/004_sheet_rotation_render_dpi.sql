-- Sheet display rotation (degrees) and actual raster DPI for scale presets.

alter table sheets
  add column if not exists rotation integer not null default 0;

alter table sheets
  drop constraint if exists sheets_rotation_check;

alter table sheets
  add constraint sheets_rotation_check
  check (rotation in (0, 90, 180, 270));

alter table sheets
  add column if not exists render_dpi double precision;

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('004_sheet_rotation_render_dpi.sql')
  on conflict do nothing;
