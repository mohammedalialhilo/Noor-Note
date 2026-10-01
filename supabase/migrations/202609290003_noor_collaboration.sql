-- Apply after the cloud sync and encryption migrations. Collaboration is limited
-- to plaintext cloud vaults until shared E2EE key distribution is implemented.
create table public.noor_vault_members (
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role = 'editor'),
  added_at timestamptz not null default now(),
  primary key (vault_id, user_id)
);
create index noor_vault_members_user_idx on public.noor_vault_members(user_id);
alter table public.noor_vault_members enable row level security;
revoke all on public.noor_vault_members from anon, authenticated;
grant select on public.noor_vault_members to authenticated;
create or replace function public.noor_can_access_vault(p_vault_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.noor_sync_vaults v where v.id = p_vault_id and v.owner_id = (select auth.uid()))
    or exists (select 1 from public.noor_vault_members m where m.vault_id = p_vault_id and m.user_id = (select auth.uid()));
$$;
revoke all on function public.noor_can_access_vault(uuid) from public, anon;
grant execute on function public.noor_can_access_vault(uuid) to authenticated;
create policy "Member or owner sees vault membership" on public.noor_vault_members for select to authenticated using (
  user_id = (select auth.uid()) or public.noor_can_access_vault(vault_id)
);

create or replace function public.noor_add_vault_member(p_vault_id uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = (select auth.uid()) and encryption_mode = 'none') then
    raise exception 'Only the owner of an unencrypted vault can share it' using errcode = '42501';
  end if;
  select id into target_id from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if target_id is null or target_id = (select auth.uid()) then
    raise exception 'No eligible Noor Note account was found' using errcode = '22023';
  end if;
  insert into public.noor_vault_members(vault_id, user_id) values (p_vault_id, target_id)
    on conflict (vault_id, user_id) do nothing;
  return target_id;
end;
$$;
revoke all on function public.noor_add_vault_member(uuid, text) from public, anon;
grant execute on function public.noor_add_vault_member(uuid, text) to authenticated;

create or replace function public.noor_remove_vault_member(p_vault_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = (select auth.uid())) then
    raise exception 'Only the vault owner can remove a member' using errcode = '42501';
  end if;
  delete from public.noor_vault_members where vault_id = p_vault_id and user_id = p_user_id;
end;
$$;
revoke all on function public.noor_remove_vault_member(uuid, uuid) from public, anon;
grant execute on function public.noor_remove_vault_member(uuid, uuid) to authenticated;

create or replace function public.noor_list_vault_members(p_vault_id uuid)
returns table(user_id uuid, email text) language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = (select auth.uid())) then
    raise exception 'Only the vault owner can view members' using errcode = '42501';
  end if;
  return query select m.user_id, u.email::text from public.noor_vault_members m
    join auth.users u on u.id = m.user_id where m.vault_id = p_vault_id order by u.email;
end;
$$;
revoke all on function public.noor_list_vault_members(uuid) from public, anon;
grant execute on function public.noor_list_vault_members(uuid) to authenticated;

create policy "Member reads shared vault" on public.noor_sync_vaults for select to authenticated using (
  public.noor_can_access_vault(id)
);
create policy "Member reads shared records" on public.noor_sync_records for select to authenticated using (
  public.noor_can_access_vault(vault_id)
);
create policy "Member reads shared attachments" on storage.objects for select to authenticated using (
  bucket_id = 'noor-note-attachments' and exists (
    select 1 from public.noor_vault_members m join public.noor_sync_vaults v on v.id = m.vault_id
    where m.user_id = (select auth.uid()) and m.vault_id::text = (storage.foldername(name))[2]
      and v.owner_id::text = (storage.foldername(name))[1] and v.encryption_mode = 'none'
  )
);
create policy "Member uploads shared attachments" on storage.objects for insert to authenticated with check (
  bucket_id = 'noor-note-attachments' and exists (
    select 1 from public.noor_vault_members m join public.noor_sync_vaults v on v.id = m.vault_id
    where m.user_id = (select auth.uid()) and m.vault_id::text = (storage.foldername(name))[2]
      and v.owner_id::text = (storage.foldername(name))[1] and v.encryption_mode = 'none'
  )
);
create policy "Member replaces shared attachments" on storage.objects for update to authenticated using (
  bucket_id = 'noor-note-attachments' and exists (
    select 1 from public.noor_vault_members m join public.noor_sync_vaults v on v.id = m.vault_id
    where m.user_id = (select auth.uid()) and m.vault_id::text = (storage.foldername(name))[2]
      and v.owner_id::text = (storage.foldername(name))[1] and v.encryption_mode = 'none'
  )
) with check (
  bucket_id = 'noor-note-attachments' and exists (
    select 1 from public.noor_vault_members m join public.noor_sync_vaults v on v.id = m.vault_id
    where m.user_id = (select auth.uid()) and m.vault_id::text = (storage.foldername(name))[2]
      and v.owner_id::text = (storage.foldername(name))[1] and v.encryption_mode = 'none'
  )
);

create table public.noor_collab_documents (
  note_id uuid primary key,
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  initial_update text not null check (char_length(initial_update) between 1 and 4000000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index noor_collab_documents_vault_idx on public.noor_collab_documents(vault_id);
alter table public.noor_collab_documents enable row level security;
revoke all on public.noor_collab_documents from anon, authenticated;
grant select on public.noor_collab_documents to authenticated;
create policy "Vault participants read collaboration documents" on public.noor_collab_documents for select to authenticated using (
  public.noor_can_access_vault(vault_id)
);

create table public.noor_collab_updates (
  sequence bigint generated always as identity primary key,
  note_id uuid not null references public.noor_collab_documents(note_id) on delete cascade,
  update_id uuid not null,
  author_id uuid not null references auth.users(id),
  update_base64 text not null check (char_length(update_base64) between 1 and 4000000),
  created_at timestamptz not null default now(),
  unique (note_id, update_id)
);
create index noor_collab_updates_note_seq_idx on public.noor_collab_updates(note_id, sequence);
alter table public.noor_collab_updates enable row level security;
revoke all on public.noor_collab_updates from anon, authenticated;
grant select on public.noor_collab_updates to authenticated;
create policy "Vault participants read collaboration updates" on public.noor_collab_updates for select to authenticated using (
  exists (select 1 from public.noor_collab_documents d where d.note_id = noor_collab_updates.note_id and public.noor_can_access_vault(d.vault_id))
);

create or replace function public.noor_start_collaboration(p_note_id uuid, p_vault_id uuid, p_note_checksum text, p_initial_update text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = (select auth.uid()) and encryption_mode = 'none') then
    raise exception 'Only the owner of an unencrypted vault can start collaboration' using errcode = '42501';
  end if;
  if not exists (select 1 from public.noor_sync_records where vault_id = p_vault_id and kind = 'note' and item_id = p_note_id and payload->'item'->>'checksum' = p_note_checksum and payload->'item'->>'collaborative' = 'true') then
    raise exception 'Synchronize the current note before starting collaboration' using errcode = '22023';
  end if;
  if char_length(p_initial_update) > 4000000 or pg_catalog.octet_length(pg_catalog.decode(p_initial_update, 'base64')) = 0 then
    raise exception 'Invalid collaboration document' using errcode = '22023';
  end if;
  insert into public.noor_collab_documents(note_id, vault_id, initial_update, created_by)
    values (p_note_id, p_vault_id, p_initial_update, (select auth.uid()));
end;
$$;
revoke all on function public.noor_start_collaboration(uuid, uuid, text, text) from public, anon;
grant execute on function public.noor_start_collaboration(uuid, uuid, text, text) to authenticated;

create or replace function public.noor_append_collab_update(p_note_id uuid, p_update_id uuid, p_update_base64 text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare doc_vault uuid; next_sequence bigint;
begin
  select vault_id into doc_vault from public.noor_collab_documents where note_id = p_note_id;
  if doc_vault is null or not (
    exists (select 1 from public.noor_sync_vaults where id = doc_vault and owner_id = (select auth.uid()))
    or exists (select 1 from public.noor_vault_members where vault_id = doc_vault and user_id = (select auth.uid()))
  ) then raise exception 'Collaboration document is unavailable' using errcode = '42501'; end if;
  if char_length(p_update_base64) > 4000000 or pg_catalog.octet_length(pg_catalog.decode(p_update_base64, 'base64')) = 0 then
    raise exception 'Invalid collaboration update' using errcode = '22023';
  end if;
  insert into public.noor_collab_updates(note_id, update_id, author_id, update_base64)
    values (p_note_id, p_update_id, (select auth.uid()), p_update_base64)
    on conflict (note_id, update_id) do update set update_id = excluded.update_id
    returning sequence into next_sequence;
  return next_sequence;
end;
$$;
revoke all on function public.noor_append_collab_update(uuid, uuid, text) from public, anon;
grant execute on function public.noor_append_collab_update(uuid, uuid, text) to authenticated;

-- Broadcast sequence numbers only; durable Yjs bytes are fetched under table RLS.
create or replace function public.noor_notify_collab_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(pg_catalog.jsonb_build_object('sequence', new.sequence), 'update', 'noor:note:' || new.note_id::text, true);
  exception when others then
    raise warning 'Collaboration update % is durable but Realtime notification failed: %', new.sequence, sqlerrm;
  end;
  return new;
end;
$$;
create trigger noor_collab_update_broadcast after insert on public.noor_collab_updates
  for each row execute function public.noor_notify_collab_update();

create policy "Vault participants receive private note events" on realtime.messages for select to authenticated using (
  extension in ('broadcast', 'presence') and split_part(realtime.topic(), ':', 1) = 'noor'
  and split_part(realtime.topic(), ':', 2) = 'note'
  and exists (select 1 from public.noor_collab_documents d where d.note_id::text = split_part(realtime.topic(), ':', 3)
    and public.noor_can_access_vault(d.vault_id))
);
create policy "Vault participants send private note events" on realtime.messages for insert to authenticated with check (
  extension in ('broadcast', 'presence') and split_part(realtime.topic(), ':', 1) = 'noor'
  and split_part(realtime.topic(), ':', 2) = 'note'
  and exists (select 1 from public.noor_collab_documents d where d.note_id::text = split_part(realtime.topic(), ':', 3)
    and public.noor_can_access_vault(d.vault_id))
);

-- Replace the owner-only push RPC with the same version check for vault editors.
create or replace function public.noor_push_sync_record(
  p_operation_id uuid, p_vault_id uuid, p_kind text, p_item_id uuid,
  p_expected_version bigint, p_revision_id uuid, p_checksum text,
  p_payload jsonb, p_device_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  vault_mode text;
  current_row public.noor_sync_records%rowtype;
  previous_result jsonb;
  new_version bigint;
  new_sequence bigint;
  response jsonb;
begin
  select encryption_mode into vault_mode from public.noor_sync_vaults where id = p_vault_id;
  if actor is null or vault_mode is null or not (
    exists (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = actor)
    or (vault_mode = 'none' and exists (select 1 from public.noor_vault_members where vault_id = p_vault_id and user_id = actor))
  ) then raise exception 'Sync vault is unavailable' using errcode = '42501'; end if;
  if p_kind = 'vault' and not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = actor) then
    raise exception 'Only the vault owner can update vault settings' using errcode = '42501';
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
  if vault_mode = 'e2ee' and (
    not (p_payload ? 'sealed') or p_payload->'sealed'->>'version' is distinct from '1'
    or p_payload->'sealed'->>'epoch' is null or (p_kind = 'vault' and not (p_payload ? 'recovery'))
  ) or vault_mode = 'none' and p_payload ? 'sealed' then
    raise exception 'Sync payload encryption mode mismatch' using errcode = '22023';
  end if;
  if p_kind = 'note' and exists (select 1 from public.noor_collab_documents where note_id = p_item_id and vault_id = p_vault_id) then
    raise exception 'Collaborative Markdown is stored as Yjs updates' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_vault_id::text || ':' || p_kind || ':' || p_item_id::text, 0));
  select result into previous_result from public.noor_sync_operations where id = p_operation_id and owner_id = actor and vault_id = p_vault_id;
  if found then return previous_result; end if;
  select * into current_row from public.noor_sync_records where vault_id = p_vault_id and kind = p_kind and item_id = p_item_id for update;
  if found and current_row.version <> p_expected_version or not found and p_expected_version <> 0 then
    if found then response := pg_catalog.jsonb_build_object('status', 'conflict', 'current', pg_catalog.to_jsonb(current_row));
    else raise exception 'Sync record missing; reset this vault sync state' using errcode = 'P0001'; end if;
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
  insert into public.noor_sync_operations(id, vault_id, owner_id, result) values (p_operation_id, p_vault_id, actor, response);
  return response;
end;
$$;
