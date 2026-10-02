-- Only recipient-specific, meaningful events become notifications. Routine note
-- edits remain in the vault and never enter this table.
create table public.noor_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  vault_id uuid references public.noor_sync_vaults(id) on delete set null,
  kind text not null check (kind in ('collaboration_invite','mention','comment_reply','share_changed')),
  source_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  body text not null check (length(body) <= 500),
  target_kind text not null check (target_kind in ('settings','note','canvas','pdf')),
  target_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (kind <> 'collaboration_invite' or expires_at is not null),
  unique (recipient_id, kind, source_id)
);
create index noor_notifications_recipient_time_idx
  on public.noor_notifications(recipient_id, created_at desc, id desc);
alter table public.noor_notifications enable row level security;
revoke all on public.noor_notifications from anon, authenticated;
grant select, update(read_at) on public.noor_notifications to authenticated;
create policy "Recipients read notifications" on public.noor_notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy "Recipients mark notifications read" on public.noor_notifications
  for update to authenticated using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

create function public.noor_notify_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.status <> 'pending' then
    update public.noor_notifications set
      title = case new.status when 'accepted' then 'Invitation accepted' when 'revoked' then 'Invitation revoked' else 'Invitation declined' end,
      body = 'This vault invitation is no longer pending.', read_at = coalesce(read_at,now())
      where recipient_id = new.invitee_user_id and kind = 'collaboration_invite' and source_id = new.id;
    return new;
  end if;
  select v.name into v_name from public.noor_sync_vaults v where v.id = new.vault_id;
  insert into public.noor_notifications(recipient_id,vault_id,kind,source_id,title,body,target_kind,expires_at)
    values(new.invitee_user_id,new.vault_id,'collaboration_invite',new.id,
      'Vault invitation',left(coalesce(v_name,'A vault') || ' invited you as ' || new.role || '.',500),'settings',new.expires_at)
    on conflict (recipient_id,kind,source_id) do update set
      title=excluded.title,body=excluded.body,expires_at=excluded.expires_at,created_at=now(),read_at=null;
  return new;
end $$;
revoke all on function public.noor_notify_invite() from public, anon, authenticated;
create trigger noor_notifications_invite after insert or update of status,role on public.noor_vault_invites
  for each row execute function public.noor_notify_invite();

create function public.noor_notify_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_thread public.noor_comment_threads%rowtype; v_recipient uuid;
begin
  select * into v_thread from public.noor_comment_threads where id = new.thread_id;
  if not found or new.deleted_at is not null or (tg_op = 'UPDATE' and old.mentions = new.mentions) then return new; end if;
  foreach v_recipient in array new.mentions loop
    if (tg_op = 'INSERT' or not (v_recipient = any(old.mentions)))
      and v_recipient is distinct from new.author_id and exists
      (select 1 from public.noor_sync_vaults v where v.id = v_thread.vault_id
        and (v.owner_id = v_recipient or exists
          (select 1 from public.noor_vault_members m where m.vault_id = v.id and m.user_id = v_recipient))) then
      insert into public.noor_notifications(recipient_id,vault_id,kind,source_id,title,body,target_kind,target_id)
        values(v_recipient,v_thread.vault_id,'mention',new.id,'You were mentioned',
          'A comment mentioned you in a shared vault.',v_thread.target_kind,v_thread.target_id)
        on conflict (recipient_id,kind,source_id) do nothing;
    end if;
  end loop;
  if tg_op = 'INSERT' and v_thread.created_by is distinct from new.author_id
    and not (v_thread.created_by = any(new.mentions))
    and exists (select 1 from public.noor_sync_vaults v where v.id = v_thread.vault_id
      and (v.owner_id = v_thread.created_by or exists
        (select 1 from public.noor_vault_members m where m.vault_id = v.id and m.user_id = v_thread.created_by))) then
    insert into public.noor_notifications(recipient_id,vault_id,kind,source_id,title,body,target_kind,target_id)
      values(v_thread.created_by,v_thread.vault_id,'comment_reply',new.id,'New comment reply',
        'Someone replied to your comment thread.',v_thread.target_kind,v_thread.target_id)
      on conflict (recipient_id,kind,source_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.noor_notify_comment() from public, anon, authenticated;
create trigger noor_notifications_comment after insert or update of mentions on public.noor_comment_messages
  for each row execute function public.noor_notify_comment();

create function public.noor_notify_share_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.role is distinct from new.role then
    insert into public.noor_notifications(recipient_id,vault_id,kind,source_id,title,body,target_kind)
      values(new.user_id,new.vault_id,'share_changed',new.vault_id,'Vault access changed',
        'Your role in a shared vault is now ' || new.role || '.','settings')
      on conflict (recipient_id,kind,source_id) do update set
        title=excluded.title,body=excluded.body,created_at=now(),read_at=null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Account deletion cascades through memberships after auth.users is gone.
    if not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;
    -- Ownership transfer removes the new owner's old membership row.
    if exists (select 1 from public.noor_vault_transfers t where t.vault_id = old.vault_id
      and t.to_user_id = old.user_id and t.from_user_id =
        (select v.owner_id from public.noor_sync_vaults v where v.id = old.vault_id)
      and t.to_user_id = auth.uid()) then return old; end if;
    insert into public.noor_notifications(recipient_id,vault_id,kind,source_id,title,body,target_kind)
      values(old.user_id,old.vault_id,'share_changed',old.vault_id,'Vault access changed',
        'Your access to a shared vault ended.','settings')
      on conflict (recipient_id,kind,source_id) do update set
        title=excluded.title,body=excluded.body,created_at=now(),read_at=null;
    return old;
  end if;
  return new;
end $$;
revoke all on function public.noor_notify_share_change() from public, anon, authenticated;
create trigger noor_notifications_member_update after update of role on public.noor_vault_members
  for each row execute function public.noor_notify_share_change();
create trigger noor_notifications_member_delete after delete on public.noor_vault_members
  for each row execute function public.noor_notify_share_change();
