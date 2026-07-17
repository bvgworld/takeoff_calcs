-- One-time cleanup: remove duplicate circuits created by mash-clicking
-- "New circuit". Keeps the lowest id for each (sheet_id, panel_device_id, number).
-- Run in Supabase SQL editor BEFORE or AFTER applying 008_circuits_unique.sql.
-- If run after 008, duplicates should already be gone; this is still safe.

delete from circuits a
using circuits b
where a.sheet_id = b.sheet_id
  and a.panel_device_id = b.panel_device_id
  and a.number = b.number
  and a.id > b.id;
