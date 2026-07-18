-- Junction boxes + home-run entry designation.

-- Expand devices.type to allow jbox.
alter table devices drop constraint if exists devices_type_check;

alter table devices
  add constraint devices_type_check
  check (type in (
    'receptacle',
    'fixture',
    'switch',
    'panel',
    'thermostat',
    'headend',
    'fire',
    'jbox'
  ));

-- Optional HR entry device (J-box or switch). Null = auto (nearest).
alter table circuits
  add column if not exists entry_device_id uuid references devices on delete set null;
