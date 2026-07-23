-- Symbol template matching (Prompt 13).
-- Devices remember how they were created: manually stamped, or applied
-- from a "Find similar" template-match batch (with the match confidence).

alter table devices add column if not exists source text not null default 'manual'
  check (source in ('manual', 'template_match'));
alter table devices add column if not exists confidence numeric;

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..014 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('014_device_source.sql')
  on conflict do nothing;
