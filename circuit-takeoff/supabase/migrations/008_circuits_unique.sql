-- Unique circuit numbers per panel on a sheet (prevents mash-click duplicates).

create unique index if not exists circuits_sheet_panel_number_uidx
  on circuits (sheet_id, panel_device_id, number);
