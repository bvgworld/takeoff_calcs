-- Prompt 2 storage paths: {projectId}/{sheetId}/...
-- Allow access when the user owns the project named in the first path segment.

drop policy if exists "plans_select" on storage.objects;
drop policy if exists "plans_insert" on storage.objects;
drop policy if exists "plans_update" on storage.objects;
drop policy if exists "plans_delete" on storage.objects;

create policy "plans_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plans'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = auth.uid()
    )
  );

create policy "plans_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'plans'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = auth.uid()
    )
  );

create policy "plans_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'plans'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = auth.uid()
    )
  );

create policy "plans_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'plans'
    and exists (
      select 1 from projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.user_id = auth.uid()
    )
  );

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('002_storage_plans_by_project.sql')
  on conflict do nothing;
