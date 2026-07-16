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
