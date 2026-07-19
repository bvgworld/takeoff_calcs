-- Migration marker table — "what's applied" becomes a one-line query:
--   select filename, applied_at from schema_migrations order by filename;
-- Every migration (001+) appends its own filename on run; re-runs are
-- no-ops via on conflict do nothing.

create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);

-- RLS with no policies: not visible/writable through the API; the SQL
-- editor (service role) bypasses RLS, which is where migrations run.
alter table schema_migrations enable row level security;

insert into schema_migrations (filename) values ('011_schema_migrations.sql')
  on conflict do nothing;
