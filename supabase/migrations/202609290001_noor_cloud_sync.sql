-- Apply this migration before enabling sync in a Supabase project.
create table if not exists public.noor_sync_vaults (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists noor_sync_vaults_owner_idx on public.noor_sync_vaults(owner_id);
alter table public.noor_sync_vaults enable row level security;
revoke all on public.noor_sync_vaults from anon, authenticated;
grant select, insert, update on public.noor_sync_vaults to authenticated;
create policy "Owner reads own sync vaults" on public.noor_sync_vaults for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owner creates own sync vaults" on public.noor_sync_vaults for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owner renames own sync vaults" on public.noor_sync_vaults for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create sequence if not exists public.noor_sync_sequence;
create table if not exists public.noor_sync_records (
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  kind text not null check (kind in ('vault', 'folder', 'note', 'attachment')),
  item_id uuid not null,
  version bigint not null check (version > 0),
  sequence bigint not null default nextval('public.noor_sync_sequence'),
  revision_id uuid not null,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  device_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (vault_id, kind, item_id),
  constraint noor_sync_payload_identity check (payload->>'kind' = kind and payload->'item'->>'id' = item_id::text)
);
create index if not exists noor_sync_records_cursor_idx on public.noor_sync_records(vault_id, sequence);
alter table public.noor_sync_records enable row level security;
revoke all on public.noor_sync_records from anon, authenticated;
grant select on public.noor_sync_records to authenticated;
create policy "Owner reads own sync records" on public.noor_sync_records for select to authenticated using (
  exists (select 1 from public.noor_sync_vaults v where v.id = vault_id and v.owner_id = (select auth.uid()))
);

create table if not exists public.noor_sync_operations (
  id uuid primary key,
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists noor_sync_operations_vault_idx on public.noor_sync_operations(vault_id);
alter table public.noor_sync_operations enable row level security;
revoke all on public.noor_sync_operations from anon, authenticated;

create or replace function public.noor_push_sync_record(
  p_operation_id uuid,
  p_vault_id uuid,
  p_kind text,
  p_item_id uuid,
  p_expected_version bigint,
  p_revision_id uuid,
  p_checksum text,
  p_payload jsonb,
  p_device_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid := (select auth.uid());
  current_row public.noor_sync_records%rowtype;
  previous_result jsonb;
  new_version bigint;
  new_sequence bigint;
  response jsonb;
begin
  if owner is null or not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = owner) then
    raise exception 'Sync vault is unavailable' using errcode = '42501';
  end if;
  if p_kind not in ('vault', 'folder', 'note', 'attachment')
    or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'kind' is distinct from p_kind
    or p_payload->'item'->>'id' is distinct from p_item_id::text
    or (p_kind = 'vault' and p_item_id <> p_vault_id)
    or (p_kind <> 'vault' and p_payload->'item'->>'vaultId' is distinct from p_vault_id::text)
    or p_checksum !~ '^[a-f0-9]{64}$'
    or pg_catalog.octet_length(p_payload::text) > 2000000
    or p_expected_version < 0 then
    raise exception 'Invalid sync record' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_vault_id::text || ':' || p_kind || ':' || p_item_id::text, 0));
  select result into previous_result from public.noor_sync_operations where id = p_operation_id and owner_id = owner and vault_id = p_vault_id;
  if found then return previous_result; end if;
  select * into current_row from public.noor_sync_records where vault_id = p_vault_id and kind = p_kind and item_id = p_item_id for update;
  if found and current_row.version <> p_expected_version or not found and p_expected_version <> 0 then
    if found then
      response := pg_catalog.jsonb_build_object('status', 'conflict', 'current', pg_catalog.to_jsonb(current_row));
    else
      raise exception 'Sync record missing; reset this vault sync state' using errcode = 'P0001';
    end if;
  else
    new_version := p_expected_version + 1;
    new_sequence := nextval('public.noor_sync_sequence');
    insert into public.noor_sync_records(vault_id, kind, item_id, version, sequence, revision_id, checksum, payload, device_id)
    values (p_vault_id, p_kind, p_item_id, new_version, new_sequence, p_revision_id, p_checksum, p_payload, p_device_id)
    on conflict (vault_id, kind, item_id) do update set
      version = excluded.version, sequence = excluded.sequence, revision_id = excluded.revision_id,
      checksum = excluded.checksum, payload = excluded.payload, device_id = excluded.device_id, updated_at = now();
    response := pg_catalog.jsonb_build_object('status', 'applied', 'version', new_version, 'sequence', new_sequence);
  end if;
  insert into public.noor_sync_operations(id, vault_id, owner_id, result) values (p_operation_id, p_vault_id, owner, response);
  return response;
end;
$$;
revoke all on function public.noor_push_sync_record(uuid, uuid, text, uuid, bigint, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.noor_push_sync_record(uuid, uuid, text, uuid, bigint, uuid, text, jsonb, uuid) to authenticated;

insert into storage.buckets(id, name, public) values ('noor-note-attachments', 'noor-note-attachments', false)
on conflict (id) do nothing;
create policy "Owner reads Noor attachments" on storage.objects for select to authenticated using (
  bucket_id = 'noor-note-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(name))[2] and v.owner_id = (select auth.uid()))
);
create policy "Owner uploads Noor attachments" on storage.objects for insert to authenticated with check (
  bucket_id = 'noor-note-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(name))[2] and v.owner_id = (select auth.uid()))
);
create policy "Owner replaces Noor attachments" on storage.objects for update to authenticated using (
  bucket_id = 'noor-note-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(name))[2] and v.owner_id = (select auth.uid()))
) with check (
  bucket_id = 'noor-note-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(name))[2] and v.owner_id = (select auth.uid()))
);
