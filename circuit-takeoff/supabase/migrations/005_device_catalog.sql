-- Device catalog: catalog_id + expanded type categories + backfill.

alter table devices
  add column if not exists catalog_id text;

-- Expand type check beyond the original four Phase-1 types.
alter table devices drop constraint if exists devices_type_check;

update devices
set catalog_id = case type
  when 'fixture' then 'fix-troffer-2x4'
  when 'receptacle' then 'recep-duplex-20'
  when 'switch' then 'sw-sp'
  when 'panel' then 'panel'
  else coalesce(catalog_id, 'recep-duplex-20')
end
where catalog_id is null;

alter table devices
  alter column catalog_id set default 'recep-duplex-20';

update devices set catalog_id = 'recep-duplex-20' where catalog_id is null;

alter table devices
  alter column catalog_id set not null;

alter table devices
  add constraint devices_type_check
  check (type in (
    'receptacle',
    'fixture',
    'switch',
    'panel',
    'thermostat',
    'headend',
    'fire'
  ));

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('005_device_catalog.sql')
  on conflict do nothing;
