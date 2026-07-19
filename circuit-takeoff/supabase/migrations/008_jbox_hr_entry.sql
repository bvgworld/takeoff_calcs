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

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('008_jbox_hr_entry.sql')
  on conflict do nothing;
