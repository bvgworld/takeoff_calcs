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
