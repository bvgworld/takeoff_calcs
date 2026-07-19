-- Circuit Takeoff — PROMPT 1 schema
-- Run this file in the Supabase SQL editor.
-- Private Storage bucket "plans"; objects under {auth.uid()}/...

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  settings jsonb not null default '{
    "ceiling_height_ft": 10,
    "panel_stub_ft": 10,
    "switch_drop_ft": 10,
    "makeup_per_box_ft": 2,
    "waste_pct": 10,
    "branch_method": "mc",
    "lighting_voltage": 277,
    "receptacle_voltage": 120
  }'::jsonb,
  created_at timestamptz default now()
);

create table if not exists sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade not null,
  name text not null,
  pdf_path text not null,
  image_path text not null,
  image_w int not null,
  image_h int not null,
  ft_per_px double precision,
  created_at timestamptz default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid references sheets on delete cascade not null,
  type text not null check (type in ('panel','fixture','receptacle','switch')),
  x double precision not null,
  y double precision not null,
  attrs jsonb not null default '{}'::jsonb,
  circuit_id uuid,
  created_at timestamptz default now()
);

create table if not exists circuits (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid references sheets on delete cascade not null,
  panel_device_id uuid references devices not null,
  number int not null,
  ctype text not null check (ctype in ('lighting','receptacle')),
  voltage int not null,
  breaker_amps int not null default 20,
  created_at timestamptz default now()
);

alter table devices drop constraint if exists devices_circuit_fk;
alter table devices add constraint devices_circuit_fk
  foreign key (circuit_id) references circuits on delete set null;

create table if not exists routes (
  id uuid primary key default gen_random_uuid(),
  circuit_id uuid references circuits on delete cascade not null,
  kind text not null check (kind in ('homerun','branch','switchleg')),
  path jsonb not null,
  plan_length_ft double precision not null,
  user_edited boolean not null default false,
  created_at timestamptz default now()
);

alter table projects enable row level security;
alter table sheets enable row level security;
alter table devices enable row level security;
alter table circuits enable row level security;
alter table routes enable row level security;

drop policy if exists "projects_owner" on projects;
create policy "projects_owner" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "sheets_owner" on sheets;
create policy "sheets_owner" on sheets
  for all using (
    exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists "devices_owner" on devices;
create policy "devices_owner" on devices
  for all using (
    exists (
      select 1 from sheets s
      join projects p on p.id = s.project_id
      where s.id = sheet_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from sheets s
      join projects p on p.id = s.project_id
      where s.id = sheet_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "circuits_owner" on circuits;
create policy "circuits_owner" on circuits
  for all using (
    exists (
      select 1 from sheets s
      join projects p on p.id = s.project_id
      where s.id = sheet_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from sheets s
      join projects p on p.id = s.project_id
      where s.id = sheet_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "routes_owner" on routes;
create policy "routes_owner" on routes
  for all using (
    exists (
      select 1 from circuits c
      join sheets s on s.id = c.sheet_id
      join projects p on p.id = s.project_id
      where c.id = circuit_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from circuits c
      join sheets s on s.id = c.sheet_id
      join projects p on p.id = s.project_id
      where c.id = circuit_id and p.user_id = auth.uid()
    )
  );

-- Private plans bucket; paths: {auth.uid()}/{project_id}/...
insert into storage.buckets (id, name, public)
values ('plans', 'plans', false)
on conflict (id) do update set public = false;

drop policy if exists "plans_select" on storage.objects;
create policy "plans_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "plans_insert" on storage.objects;
create policy "plans_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "plans_update" on storage.objects;
create policy "plans_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "plans_delete" on storage.objects;
create policy "plans_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('001_initial_schema.sql')
  on conflict do nothing;
