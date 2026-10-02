-- Independent, passphrase-encrypted vault snapshots. The bucket itself is private.
insert into storage.buckets (id, name, public)
values ('noor-note-backups', 'noor-note-backups', false)
on conflict (id) do update set public = false;

create or replace function public.noor_backup_account_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users where id = (select auth.uid()));
$$;
revoke all on function public.noor_backup_account_active() from public, anon;
grant execute on function public.noor_backup_account_active() to authenticated;

create policy "Owner reads Noor backups" on storage.objects for select to authenticated using (
  bucket_id = 'noor-note-backups' and
  (storage.foldername(name))[1] = (select auth.uid())::text and
  (select public.noor_backup_account_active())
);

create policy "Owner uploads Noor backups" on storage.objects for insert to authenticated with check (
  bucket_id = 'noor-note-backups' and
  (storage.foldername(name))[1] = (select auth.uid())::text and
  (select public.noor_backup_account_active())
);

create policy "Owner removes Noor backups" on storage.objects for delete to authenticated using (
  bucket_id = 'noor-note-backups' and
  (storage.foldername(name))[1] = (select auth.uid())::text and
  (select public.noor_backup_account_active())
);
