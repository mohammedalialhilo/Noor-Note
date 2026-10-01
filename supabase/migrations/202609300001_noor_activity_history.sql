-- Shared activity records are generated at server commit points. Markdown-only
-- note updates deliberately produce no event.
create table public.noor_activity_events (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  actor_email text not null,
  event_kind text not null check (event_kind in (
    'note_created','note_renamed','note_moved','note_restored',
    'member_invited','member_removed','permission_changed',
    'comment_added','comment_resolved','revision_restored')),
  note_id uuid,
  target_user_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 4096),
  source_id uuid unique,
  occurred_at timestamptz not null default now()
);
create index noor_activity_vault_time_idx on public.noor_activity_events(vault_id, occurred_at desc, id desc);
create index noor_activity_kind_time_idx on public.noor_activity_events(vault_id, event_kind, occurred_at desc);
create index noor_activity_note_time_idx on public.noor_activity_events(vault_id, note_id, occurred_at desc) where note_id is not null;
create index noor_activity_actor_time_idx on public.noor_activity_events(vault_id, actor_id, occurred_at desc);
alter table public.noor_activity_events enable row level security;
revoke all on public.noor_activity_events from anon, authenticated;
grant select on public.noor_activity_events to authenticated;
create policy "Members read plaintext vault activity" on public.noor_activity_events for select to authenticated
  using (public.noor_has_vault_permission(vault_id,'read') and exists
    (select 1 from public.noor_sync_vaults v where v.id=vault_id and v.encryption_mode='none'));

create or replace function public.noor_activity_write(p_vault uuid, p_kind text, p_note uuid,
  p_target_user uuid, p_details jsonb, p_source uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_email text;
begin
  if v_actor is null or not exists (select 1 from public.noor_sync_vaults v where v.id=p_vault and v.encryption_mode='none') then return; end if;
  select u.email::text into v_email from auth.users u where u.id=v_actor;
  if v_email is null then return; end if;
  insert into public.noor_activity_events(vault_id,actor_id,actor_email,event_kind,note_id,target_user_id,details,source_id)
    values(p_vault,v_actor,v_email,p_kind,p_note,p_target_user,coalesce(p_details,'{}'::jsonb),p_source)
    on conflict (source_id) do nothing;
end $$;
revoke all on function public.noor_activity_write(uuid,text,uuid,uuid,jsonb,uuid) from public, anon, authenticated;

create or replace function public.noor_activity_note_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_item jsonb; new_item jsonb; v_title text; v_path text;
begin
  if new.kind <> 'note' or new.payload ? 'sealed' then return new; end if;
  new_item := new.payload->'item';
  v_title := left(coalesce(new_item->>'title','Untitled note'),200);
  v_path := left(coalesce(new_item->>'path',''),1024);
  if TG_OP = 'INSERT' then
    if new_item->>'deletedAt' is null then
      perform public.noor_activity_write(new.vault_id,'note_created',new.item_id,null,
        pg_catalog.jsonb_build_object('title',v_title,'path',v_path));
    end if;
    return new;
  end if;
  old_item := old.payload->'item';
  if old_item->>'deletedAt' is not null and new_item->>'deletedAt' is null then
    perform public.noor_activity_write(new.vault_id,'note_restored',new.item_id,null,
      pg_catalog.jsonb_build_object('title',v_title,'path',v_path));
  end if;
  if old_item->>'title' is distinct from new_item->>'title' and new_item->>'deletedAt' is null then
    perform public.noor_activity_write(new.vault_id,'note_renamed',new.item_id,null,
      pg_catalog.jsonb_build_object('title',v_title,'path',v_path,'previousTitle',left(coalesce(old_item->>'title',''),200)));
  end if;
  if old_item->>'path' is distinct from new_item->>'path' and new_item->>'deletedAt' is null then
    perform public.noor_activity_write(new.vault_id,'note_moved',new.item_id,null,
      pg_catalog.jsonb_build_object('title',v_title,'path',v_path,'previousPath',left(coalesce(old_item->>'path',''),1024)));
  end if;
  return new;
end $$;
create trigger noor_activity_sync_note after insert or update on public.noor_sync_records
  for each row execute function public.noor_activity_note_change();

create or replace function public.noor_activity_invite_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if new.status <> 'pending' then return new; end if;
  select u.email::text into v_email from auth.users u where u.id=new.invitee_user_id;
  perform public.noor_activity_write(new.vault_id,'member_invited',null,new.invitee_user_id,
    pg_catalog.jsonb_build_object('email',left(coalesce(v_email,''),320),'role',new.role));
  return new;
end $$;
create trigger noor_activity_invite after insert or update on public.noor_vault_invites
  for each row execute function public.noor_activity_invite_change();

create or replace function public.noor_activity_member_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if TG_OP = 'DELETE' then
    -- Accepting ownership removes the recipient's membership row before the
    -- vault owner changes. That transition is not a member removal.
    if exists (select 1 from public.noor_vault_transfers t
      where t.vault_id=old.vault_id and t.to_user_id=old.user_id
        and t.from_user_id=(select v.owner_id from public.noor_sync_vaults v where v.id=old.vault_id)
        and t.to_user_id=auth.uid()) then return old; end if;
    select u.email::text into v_email from auth.users u where u.id=old.user_id;
    perform public.noor_activity_write(old.vault_id,'member_removed',null,old.user_id,
      pg_catalog.jsonb_build_object('email',left(coalesce(v_email,''),320),'role',old.role));
    return old;
  end if;
  if old.role is distinct from new.role then
    select u.email::text into v_email from auth.users u where u.id=new.user_id;
    perform public.noor_activity_write(new.vault_id,'permission_changed',null,new.user_id,
      pg_catalog.jsonb_build_object('email',left(coalesce(v_email,''),320),'previousRole',old.role,'role',new.role));
  end if;
  return new;
end $$;
create trigger noor_activity_member_removed after delete on public.noor_vault_members
  for each row execute function public.noor_activity_member_change();
create trigger noor_activity_member_role after update of role on public.noor_vault_members
  for each row execute function public.noor_activity_member_change();

create or replace function public.noor_activity_comment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_thread public.noor_comment_threads%rowtype;
begin
  if TG_TABLE_NAME = 'noor_comment_messages' then
    select * into v_thread from public.noor_comment_threads where id=new.thread_id;
    if found then perform public.noor_activity_write(v_thread.vault_id,'comment_added',
      case when v_thread.target_kind='note' then v_thread.target_id else null end,null,
      pg_catalog.jsonb_build_object('targetKind',v_thread.target_kind,'targetId',v_thread.target_id,'threadId',v_thread.id,'messageId',new.id)); end if;
  elsif TG_OP = 'UPDATE' and old.resolved_at is null and new.resolved_at is not null then
    perform public.noor_activity_write(new.vault_id,'comment_resolved',
      case when new.target_kind='note' then new.target_id else null end,null,
      pg_catalog.jsonb_build_object('targetKind',new.target_kind,'targetId',new.target_id,'threadId',new.id));
  end if;
  return new;
end $$;
create trigger noor_activity_comment_added after insert on public.noor_comment_messages
  for each row execute function public.noor_activity_comment_change();
create trigger noor_activity_comment_resolved after update of resolved_at on public.noor_comment_threads
  for each row execute function public.noor_activity_comment_change();

create or replace function public.noor_record_revision_restore(p_vault uuid, p_note uuid,
  p_source_revision uuid, p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_note jsonb;
begin
  if not public.noor_has_vault_permission(p_vault,'edit') then raise exception 'Editor role required'; end if;
  select r.payload->'item' into v_note from public.noor_sync_records r
    where r.vault_id=p_vault and r.kind='note' and r.item_id=p_note and r.payload->'item'->>'deletedAt' is null;
  if v_note is null then raise exception 'Synced note unavailable'; end if;
  perform public.noor_activity_write(p_vault,'revision_restored',p_note,null,
    pg_catalog.jsonb_build_object('title',left(coalesce(v_note->>'title','Untitled note'),200),
      'path',left(coalesce(v_note->>'path',''),1024),'sourceRevisionId',p_source_revision),p_event);
end $$;
revoke all on function public.noor_record_revision_restore(uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.noor_record_revision_restore(uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.noor_list_activity_actors(p_vault uuid)
returns table(actor_id uuid, actor_email text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault,'read') then raise exception 'Vault unavailable'; end if;
  return query select distinct a.actor_id,a.actor_email from public.noor_activity_events a
    where a.vault_id=p_vault order by a.actor_email;
end $$;
revoke all on function public.noor_list_activity_actors(uuid) from public, anon;
grant execute on function public.noor_list_activity_actors(uuid) to authenticated;

create or replace function public.noor_list_activity_notes(p_vault uuid)
returns table(note_id uuid, title text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault,'read') then raise exception 'Vault unavailable'; end if;
  return query select a.note_id,
    coalesce((array_agg(a.details->>'title' order by a.occurred_at desc) filter (where a.details ? 'title'))[1],a.note_id::text)
    from public.noor_activity_events a where a.vault_id=p_vault and a.note_id is not null
    group by a.note_id order by 2;
end $$;
revoke all on function public.noor_list_activity_notes(uuid) from public, anon;
grant execute on function public.noor_list_activity_notes(uuid) to authenticated;

create or replace function public.noor_activity_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(pg_catalog.jsonb_build_object('eventId',new.id),'changed',
    'noor:activity:' || new.vault_id::text,true);
  return new;
exception when others then return new;
end $$;
create trigger noor_activity_notify_trigger after insert on public.noor_activity_events
  for each row execute function public.noor_activity_notify();
create policy "Members receive private activity changes" on realtime.messages for select to authenticated
  using (extension='broadcast' and split_part(realtime.topic(),':',1)='noor'
    and split_part(realtime.topic(),':',2)='activity'
    and exists (select 1 from public.noor_sync_vaults v where v.id::text=split_part(realtime.topic(),':',3)
      and public.noor_has_vault_permission(v.id,'read')));
