-- Plaintext vault sharing. All decisions derive the actor from auth.uid(), never from a client role.
-- Existing editor memberships remain editors. Apply after 202609290003_noor_collaboration.sql.
alter table public.noor_vault_members drop constraint noor_vault_members_role_check;
alter table public.noor_vault_members add constraint noor_vault_members_role_check
  check (role in ('admin', 'editor', 'commenter', 'viewer'));

-- Attachment keys must survive an ownership transfer.
alter table public.noor_sync_vaults add column storage_owner_id uuid;
update public.noor_sync_vaults set storage_owner_id = owner_id where storage_owner_id is null;
alter table public.noor_sync_vaults alter column storage_owner_id set not null;
create or replace function public.noor_fix_storage_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.storage_owner_id is not null and new.storage_owner_id <> new.owner_id then
      raise exception 'Invalid attachment namespace' using errcode = '22023';
    end if;
    new.storage_owner_id := new.owner_id;
  elsif new.storage_owner_id is distinct from old.storage_owner_id then
    raise exception 'Attachment namespace is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger noor_storage_owner_guard before insert or update on public.noor_sync_vaults
  for each row execute function public.noor_fix_storage_owner();
revoke insert, update on public.noor_sync_vaults from authenticated;
grant insert (id, owner_id, name, encryption_mode) on public.noor_sync_vaults to authenticated;
grant update (name) on public.noor_sync_vaults to authenticated;

create or replace function public.noor_vault_role(p_vault_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when v.owner_id = (select auth.uid()) then 'owner' else
    (select m.role from public.noor_vault_members m
      where m.vault_id = v.id and m.user_id = (select auth.uid())) end
  from public.noor_sync_vaults v where v.id = p_vault_id
    and (v.owner_id = (select auth.uid()) or v.encryption_mode = 'none');
$$;
revoke all on function public.noor_vault_role(uuid) from public, anon;
grant execute on function public.noor_vault_role(uuid) to authenticated;

create or replace function public.noor_has_vault_permission(p_vault_id uuid, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(case p_action
    when 'read' then public.noor_vault_role(p_vault_id) is not null
    when 'comment' then public.noor_vault_role(p_vault_id) in ('owner', 'admin', 'editor', 'commenter')
    when 'edit' then public.noor_vault_role(p_vault_id) in ('owner', 'admin', 'editor')
    when 'manage' then public.noor_vault_role(p_vault_id) in ('owner', 'admin')
    when 'transfer' then public.noor_vault_role(p_vault_id) = 'owner'
    else false end, false);
$$;
revoke all on function public.noor_has_vault_permission(uuid, text) from public, anon;
grant execute on function public.noor_has_vault_permission(uuid, text) to authenticated;

-- Future folder/note grants require path-aware checks. Unsupported scopes fail closed today.
create function public.noor_has_scope_permission(p_vault_id uuid, p_scope text, p_scope_id uuid, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_scope = 'vault' and p_scope_id = p_vault_id
    and public.noor_has_vault_permission(p_vault_id, p_action), false);
$$;
revoke all on function public.noor_has_scope_permission(uuid, text, uuid, text) from public, anon;
grant execute on function public.noor_has_scope_permission(uuid, text, uuid, text) to authenticated;

create or replace function public.noor_can_access_vault(p_vault_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.noor_has_vault_permission(p_vault_id, 'read');
$$;

create table public.noor_vault_invites (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  invitee_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id),
  role text not null check (role in ('admin', 'editor', 'commenter', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique (vault_id, invitee_user_id)
);
alter table public.noor_vault_invites enable row level security;
revoke all on public.noor_vault_invites from anon, authenticated;

create or replace function public.noor_invite_vault_member(p_vault_id uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_id uuid; invite_id uuid;
begin
  actor_role := public.noor_vault_role(p_vault_id);
  if actor_role is null or actor_role not in ('owner', 'admin')
    or not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and encryption_mode = 'none') then
    raise exception 'Vault is unavailable or sharing is not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'editor', 'commenter', 'viewer')
    or (actor_role = 'admin' and p_role = 'admin') then
    raise exception 'This role cannot be invited' using errcode = '42501';
  end if;
  if p_email is null or char_length(trim(p_email)) > 320 then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  select id into target_id from auth.users
    where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if target_id is null or target_id = (select auth.uid()) or exists
    (select 1 from public.noor_sync_vaults where id = p_vault_id and owner_id = target_id) then
    raise exception 'No eligible Noor Note account was found' using errcode = '22023';
  end if;
  if exists (select 1 from public.noor_vault_members where vault_id = p_vault_id and user_id = target_id) then
    raise exception 'This account is already a member' using errcode = '22023';
  end if;
  insert into public.noor_vault_invites(vault_id, invitee_user_id, invited_by, role)
    values (p_vault_id, target_id, (select auth.uid()), p_role)
    on conflict (vault_id, invitee_user_id) do update set
      invited_by = excluded.invited_by, role = excluded.role, status = 'pending',
      created_at = now(), expires_at = now() + interval '7 days'
    returning id into invite_id;
  return invite_id;
end;
$$;
revoke all on function public.noor_add_vault_member(uuid, text) from authenticated;
revoke all on function public.noor_invite_vault_member(uuid, text, text) from public, anon;
grant execute on function public.noor_invite_vault_member(uuid, text, text) to authenticated;

create function public.noor_list_vault_invites()
returns table(id uuid, vault_id uuid, vault_name text, role text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  return query select i.id, i.vault_id, v.name, i.role, i.expires_at
    from public.noor_vault_invites i join public.noor_sync_vaults v on v.id = i.vault_id
    where i.invitee_user_id = (select auth.uid()) and i.status = 'pending'
      and i.expires_at > now() and v.encryption_mode = 'none'
    order by i.created_at desc;
end;
$$;
revoke all on function public.noor_list_vault_invites() from public, anon;
grant execute on function public.noor_list_vault_invites() to authenticated;

create function public.noor_list_sent_vault_invites(p_vault_id uuid)
returns table(id uuid, email text, role text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault_id, 'manage') then
    raise exception 'Vault is unavailable' using errcode = '42501';
  end if;
  return query select i.id, u.email::text, i.role, i.expires_at
    from public.noor_vault_invites i join auth.users u on u.id = i.invitee_user_id
    where i.vault_id = p_vault_id and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc;
end;
$$;
revoke all on function public.noor_list_sent_vault_invites(uuid) from public, anon;
grant execute on function public.noor_list_sent_vault_invites(uuid) to authenticated;

create function public.noor_revoke_vault_invite(p_vault_id uuid, p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; invite_role text;
begin
  actor_role := public.noor_vault_role(p_vault_id);
  select role into invite_role from public.noor_vault_invites
    where id = p_invite_id and vault_id = p_vault_id and status = 'pending' for update;
  if actor_role is null or actor_role not in ('owner', 'admin') or invite_role is null
    or (actor_role = 'admin' and invite_role = 'admin') then
    raise exception 'Invitation is unavailable' using errcode = '42501';
  end if;
  update public.noor_vault_invites set status = 'revoked' where id = p_invite_id;
end;
$$;
revoke all on function public.noor_revoke_vault_invite(uuid, uuid) from public, anon;
grant execute on function public.noor_revoke_vault_invite(uuid, uuid) to authenticated;

create function public.noor_respond_vault_invite(p_invite_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare invite public.noor_vault_invites%rowtype;
begin
  select * into invite from public.noor_vault_invites where id = p_invite_id for update;
  if not found or invite.invitee_user_id <> (select auth.uid()) or invite.status <> 'pending'
    or invite.expires_at <= now()
    or not exists (select 1 from public.noor_sync_vaults v where v.id = invite.vault_id
      and v.encryption_mode = 'none' and (v.owner_id = invite.invited_by or exists
        (select 1 from public.noor_vault_members m where m.vault_id = invite.vault_id
          and m.user_id = invite.invited_by and m.role = 'admin'))) then
    raise exception 'Invitation is unavailable' using errcode = '42501';
  end if;
  if p_accept is true then
    insert into public.noor_vault_members(vault_id, user_id, role)
      values (invite.vault_id, invite.invitee_user_id, invite.role)
      on conflict (vault_id, user_id) do nothing;
    update public.noor_vault_invites set status = 'accepted' where id = p_invite_id;
  elsif p_accept is false then
    update public.noor_vault_invites set status = 'declined' where id = p_invite_id;
  else raise exception 'Choose accept or decline' using errcode = '22023'; end if;
end;
$$;
revoke all on function public.noor_respond_vault_invite(uuid, boolean) from public, anon;
grant execute on function public.noor_respond_vault_invite(uuid, boolean) to authenticated;

drop function public.noor_list_vault_members(uuid);
create function public.noor_list_vault_members(p_vault_id uuid)
returns table(user_id uuid, email text, role text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault_id, 'read') then
    raise exception 'Vault is unavailable' using errcode = '42501';
  end if;
  return query select m.user_id, u.email::text, m.role from public.noor_vault_members m
    join auth.users u on u.id = m.user_id where m.vault_id = p_vault_id order by u.email;
end;
$$;
revoke all on function public.noor_list_vault_members(uuid) from public, anon;
grant execute on function public.noor_list_vault_members(uuid) to authenticated;

create or replace function public.noor_remove_vault_member(p_vault_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text;
begin
  actor_role := public.noor_vault_role(p_vault_id);
  select role into target_role from public.noor_vault_members where vault_id = p_vault_id and user_id = p_user_id for update;
  if actor_role is null or actor_role not in ('owner', 'admin') or target_role is null or
    (actor_role = 'admin' and target_role = 'admin') then
    raise exception 'Member cannot be removed' using errcode = '42501';
  end if;
  delete from public.noor_vault_members where vault_id = p_vault_id and user_id = p_user_id;
end;
$$;

create function public.noor_change_vault_member_role(p_vault_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_role text;
begin
  actor_role := public.noor_vault_role(p_vault_id);
  select role into target_role from public.noor_vault_members where vault_id = p_vault_id and user_id = p_user_id for update;
  if actor_role is null or actor_role not in ('owner', 'admin') or target_role is null
    or p_role is null or p_role not in ('admin', 'editor', 'commenter', 'viewer')
    or (actor_role = 'admin' and (target_role = 'admin' or p_role = 'admin')) then
    raise exception 'Role cannot be changed' using errcode = '42501';
  end if;
  update public.noor_vault_members set role = p_role where vault_id = p_vault_id and user_id = p_user_id;
end;
$$;
revoke all on function public.noor_change_vault_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.noor_change_vault_member_role(uuid, uuid, text) to authenticated;

create function public.noor_leave_vault(p_vault_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.noor_vault_members where vault_id = p_vault_id and user_id = (select auth.uid())) then
    raise exception 'Membership is unavailable; an owner must transfer ownership first' using errcode = '42501';
  end if;
  delete from public.noor_vault_members where vault_id = p_vault_id and user_id = (select auth.uid());
end;
$$;
revoke all on function public.noor_leave_vault(uuid) from public, anon;
grant execute on function public.noor_leave_vault(uuid) to authenticated;

create table public.noor_vault_transfers (
  vault_id uuid primary key references public.noor_sync_vaults(id) on delete cascade,
  from_user_id uuid not null references auth.users(id),
  to_user_id uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);
alter table public.noor_vault_transfers enable row level security;
revoke all on public.noor_vault_transfers from anon, authenticated;

create function public.noor_request_vault_transfer(p_vault_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault_id, 'transfer')
    or not exists (select 1 from public.noor_sync_vaults where id = p_vault_id and encryption_mode = 'none')
    or not exists (select 1 from public.noor_vault_members where vault_id = p_vault_id and user_id = p_user_id) then
    raise exception 'Transfer requires an existing member of a plaintext vault' using errcode = '42501';
  end if;
  insert into public.noor_vault_transfers(vault_id, from_user_id, to_user_id)
    values (p_vault_id, (select auth.uid()), p_user_id)
    on conflict (vault_id) do update set from_user_id = excluded.from_user_id,
      to_user_id = excluded.to_user_id, created_at = now(), expires_at = now() + interval '7 days';
end;
$$;
revoke all on function public.noor_request_vault_transfer(uuid, uuid) from public, anon;
grant execute on function public.noor_request_vault_transfer(uuid, uuid) to authenticated;

create function public.noor_list_vault_transfers()
returns table(vault_id uuid, vault_name text, from_email text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  return query select t.vault_id, v.name, u.email::text, t.expires_at
    from public.noor_vault_transfers t
    join public.noor_sync_vaults v on v.id = t.vault_id and v.owner_id = t.from_user_id
    join auth.users u on u.id = t.from_user_id
    where t.to_user_id = (select auth.uid()) and t.expires_at > now();
end;
$$;
revoke all on function public.noor_list_vault_transfers() from public, anon;
grant execute on function public.noor_list_vault_transfers() to authenticated;

create function public.noor_respond_vault_transfer(p_vault_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare transfer public.noor_vault_transfers%rowtype; vault_owner uuid;
begin
  select owner_id into vault_owner from public.noor_sync_vaults where id = p_vault_id for update;
  select * into transfer from public.noor_vault_transfers where vault_id = p_vault_id for update;
  if not found or transfer.to_user_id <> (select auth.uid()) or transfer.from_user_id <> vault_owner
    or transfer.expires_at <= now() or not exists
      (select 1 from public.noor_vault_members where vault_id = p_vault_id and user_id = (select auth.uid())) then
    raise exception 'Transfer is unavailable' using errcode = '42501';
  end if;
  if p_accept is true then
    delete from public.noor_vault_members where vault_id = p_vault_id and user_id = transfer.to_user_id;
    update public.noor_sync_vaults set owner_id = transfer.to_user_id where id = p_vault_id;
    insert into public.noor_vault_members(vault_id, user_id, role)
      values (p_vault_id, transfer.from_user_id, 'admin')
      on conflict (vault_id, user_id) do update set role = 'admin';
  elsif p_accept is distinct from false then
    raise exception 'Choose accept or decline' using errcode = '22023';
  end if;
  delete from public.noor_vault_transfers where vault_id = p_vault_id;
end;
$$;
revoke all on function public.noor_respond_vault_transfer(uuid, boolean) from public, anon;
grant execute on function public.noor_respond_vault_transfer(uuid, boolean) to authenticated;

create function public.noor_cancel_vault_transfer(p_vault_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault_id, 'transfer') then
    raise exception 'Transfer is unavailable' using errcode = '42501';
  end if;
  delete from public.noor_vault_transfers where vault_id = p_vault_id;
end;
$$;
revoke all on function public.noor_cancel_vault_transfer(uuid) from public, anon;
grant execute on function public.noor_cancel_vault_transfer(uuid) to authenticated;

-- Remove permissive policies from the previous migrations, including owner path rules
-- that would stop working after a transfer.
drop policy "Owner reads own sync vaults" on public.noor_sync_vaults;
drop policy "Member reads shared vault" on public.noor_sync_vaults;
create policy "Vault participants read vault" on public.noor_sync_vaults for select to authenticated
  using (public.noor_has_vault_permission(id, 'read'));
drop policy "Owner reads own sync records" on public.noor_sync_records;
drop policy "Member reads shared records" on public.noor_sync_records;
create policy "Vault participants read records" on public.noor_sync_records for select to authenticated
  using (public.noor_has_vault_permission(vault_id, 'read'));

drop policy "Owner reads Noor attachments" on storage.objects;
drop policy "Owner uploads Noor attachments" on storage.objects;
drop policy "Owner replaces Noor attachments" on storage.objects;
drop policy "Member reads shared attachments" on storage.objects;
drop policy "Member uploads shared attachments" on storage.objects;
drop policy "Member replaces shared attachments" on storage.objects;
create policy "Vault participants read attachments" on storage.objects for select to authenticated using (
  bucket_id = 'noor-note-attachments' and exists
    (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(storage.objects.name))[2]
      and v.storage_owner_id::text = (storage.foldername(storage.objects.name))[1]
      and public.noor_has_vault_permission(v.id, 'read'))
);
create policy "Vault editors upload attachments" on storage.objects for insert to authenticated with check (
  bucket_id = 'noor-note-attachments' and exists
    (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(storage.objects.name))[2]
      and v.storage_owner_id::text = (storage.foldername(storage.objects.name))[1]
      and public.noor_has_vault_permission(v.id, 'edit'))
);
create policy "Vault editors replace attachments" on storage.objects for update to authenticated using (
  bucket_id = 'noor-note-attachments' and exists
    (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(storage.objects.name))[2]
      and v.storage_owner_id::text = (storage.foldername(storage.objects.name))[1]
      and public.noor_has_vault_permission(v.id, 'edit'))
) with check (
  bucket_id = 'noor-note-attachments' and exists
    (select 1 from public.noor_sync_vaults v where v.id::text = (storage.foldername(storage.objects.name))[2]
      and v.storage_owner_id::text = (storage.foldername(storage.objects.name))[1]
      and public.noor_has_vault_permission(v.id, 'edit'))
);

drop policy "Vault participants send private note events" on realtime.messages;
create policy "Vault participants send private presence" on realtime.messages for insert to authenticated with check (
  extension = 'presence' and split_part(realtime.topic(), ':', 1) = 'noor'
  and split_part(realtime.topic(), ':', 2) = 'note'
  and exists (select 1 from public.noor_collab_documents d
    where d.note_id::text = split_part(realtime.topic(), ':', 3)
      and public.noor_has_vault_permission(d.vault_id, 'read'))
);
create policy "Vault editors send private note events" on realtime.messages for insert to authenticated with check (
  extension = 'broadcast' and split_part(realtime.topic(), ':', 1) = 'noor'
  and split_part(realtime.topic(), ':', 2) = 'note'
  and exists (select 1 from public.noor_collab_documents d
    where d.note_id::text = split_part(realtime.topic(), ':', 3)
      and public.noor_has_vault_permission(d.vault_id, 'edit'))
);

create or replace function public.noor_start_collaboration(p_note_id uuid, p_vault_id uuid, p_note_checksum text, p_initial_update text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault_id, 'edit') then
    raise exception 'Vault is unavailable or editing is not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.noor_sync_records where vault_id = p_vault_id
    and kind = 'note' and item_id = p_note_id and payload->'item'->>'checksum' = p_note_checksum
    and payload->'item'->>'collaborative' = 'true') then
    raise exception 'Synchronize the current note before starting collaboration' using errcode = '22023';
  end if;
  if char_length(p_initial_update) > 4000000
    or pg_catalog.octet_length(pg_catalog.decode(p_initial_update, 'base64')) = 0 then
    raise exception 'Invalid collaboration document' using errcode = '22023';
  end if;
  insert into public.noor_collab_documents(note_id, vault_id, initial_update, created_by)
    values (p_note_id, p_vault_id, p_initial_update, (select auth.uid()));
end;
$$;
create or replace function public.noor_append_collab_update(p_note_id uuid, p_update_id uuid, p_update_base64 text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare doc_vault uuid; next_sequence bigint;
begin
  select vault_id into doc_vault from public.noor_collab_documents where note_id = p_note_id;
  if doc_vault is null or not public.noor_has_vault_permission(doc_vault, 'edit') then
    raise exception 'Collaboration document is unavailable' using errcode = '42501';
  end if;
  if char_length(p_update_base64) > 4000000
    or pg_catalog.octet_length(pg_catalog.decode(p_update_base64, 'base64')) = 0 then
    raise exception 'Invalid collaboration update' using errcode = '22023';
  end if;
  insert into public.noor_collab_updates(note_id, update_id, author_id, update_base64)
    values (p_note_id, p_update_id, (select auth.uid()), p_update_base64)
    on conflict (note_id, update_id) do update set update_id = excluded.update_id
    returning sequence into next_sequence;
  return next_sequence;
end;
$$;

-- Comments are separate from Markdown, so Commenter can write without note edit rights.
create table public.noor_shared_comments (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  note_id uuid not null,
  author_id uuid not null references auth.users(id),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index noor_shared_comments_note_idx on public.noor_shared_comments(vault_id, note_id, created_at);
alter table public.noor_shared_comments enable row level security;
revoke all on public.noor_shared_comments from anon, authenticated;
grant select, insert, delete on public.noor_shared_comments to authenticated;
create policy "Vault participants read comments" on public.noor_shared_comments for select to authenticated
  using (public.noor_has_vault_permission(vault_id, 'read') and exists
    (select 1 from public.noor_sync_vaults v where v.id = vault_id and v.encryption_mode = 'none'));
create policy "Vault commenters add comments" on public.noor_shared_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.noor_has_vault_permission(vault_id, 'comment')
    and exists (select 1 from public.noor_sync_vaults v where v.id = vault_id and v.encryption_mode = 'none')
    and exists (select 1 from public.noor_sync_records r where r.vault_id = noor_shared_comments.vault_id
      and r.kind = 'note' and r.item_id = noor_shared_comments.note_id));
create policy "Authors or managers remove comments" on public.noor_shared_comments for delete to authenticated
  using (public.noor_has_vault_permission(vault_id, 'read')
    and (author_id = (select auth.uid()) or public.noor_has_vault_permission(vault_id, 'manage')));

-- Reuse the established optimistic sync protocol, but authorize every object mutation.
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
  if actor is null or vault_mode is null or not public.noor_has_vault_permission(
    p_vault_id, case when p_kind = 'vault' then 'transfer' else 'edit' end) then
    raise exception 'Sync vault is unavailable or editing is not allowed' using errcode = '42501';
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
  if p_kind = 'note' and exists (select 1 from public.noor_collab_documents
    where note_id = p_item_id and vault_id = p_vault_id) then
    raise exception 'Collaborative Markdown is stored as Yjs updates' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_vault_id::text || ':' || p_kind || ':' || p_item_id::text, 0));
  select result into previous_result from public.noor_sync_operations
    where id = p_operation_id and owner_id = actor and vault_id = p_vault_id;
  if found then return previous_result; end if;
  select * into current_row from public.noor_sync_records
    where vault_id = p_vault_id and kind = p_kind and item_id = p_item_id for update;
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
  insert into public.noor_sync_operations(id, vault_id, owner_id, result)
    values (p_operation_id, p_vault_id, actor, response);
  return response;
end;
$$;

