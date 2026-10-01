-- Threaded comments are scoped to existing shared content. All mutations use
-- authenticated RPCs so authorship and moderation cannot be forged by clients.
create table public.noor_comment_canvas_targets (
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  canvas_id uuid not null,
  registered_by uuid not null references auth.users(id),
  primary key (vault_id, canvas_id)
);

create table public.noor_comment_threads (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  target_kind text not null check (target_kind in ('note', 'canvas', 'pdf')),
  target_id uuid not null,
  anchor jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  check (anchor is null or jsonb_typeof(anchor) = 'object')
);
create index noor_comment_threads_target_idx on public.noor_comment_threads(vault_id, target_kind, target_id, created_at);

create table public.noor_comment_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.noor_comment_threads(id) on delete cascade,
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  check ((deleted_at is null and length(body) between 1 and 10000)
    or (deleted_at is not null and body = ''))
);
create index noor_comment_messages_thread_idx on public.noor_comment_messages(thread_id, created_at, id);

-- Preserve existing flat comments as one-message threads.
insert into public.noor_comment_threads(id, vault_id, target_kind, target_id, created_by, created_at, updated_at)
select id, vault_id, 'note', note_id, author_id, created_at, updated_at from public.noor_shared_comments;
insert into public.noor_comment_messages(thread_id, vault_id, author_id, body, created_at, edited_at)
select id, vault_id, author_id, body, created_at, case when updated_at > created_at then updated_at end
from public.noor_shared_comments;
revoke all on public.noor_shared_comments from authenticated, anon;

alter table public.noor_comment_canvas_targets enable row level security;
alter table public.noor_comment_threads enable row level security;
alter table public.noor_comment_messages enable row level security;
revoke all on public.noor_comment_canvas_targets, public.noor_comment_threads, public.noor_comment_messages from authenticated, anon;
grant select on public.noor_comment_threads, public.noor_comment_messages to authenticated;
create policy "Members read comment threads" on public.noor_comment_threads for select to authenticated
  using (public.noor_has_vault_permission(vault_id, 'read') and exists
    (select 1 from public.noor_sync_vaults v where v.id = vault_id and v.encryption_mode = 'none'));
create policy "Members read comment messages" on public.noor_comment_messages for select to authenticated
  using (public.noor_has_vault_permission(vault_id, 'read') and exists
    (select 1 from public.noor_comment_threads t where t.id = thread_id and t.vault_id = vault_id));

create or replace function public.noor_comment_valid_target(p_vault uuid, p_kind text, p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'note' then exists (select 1 from public.noor_sync_records r where r.vault_id = p_vault and r.kind = 'note' and r.item_id = p_target and r.payload->'item'->>'deletedAt' is null)
    when 'pdf' then exists (select 1 from public.noor_sync_records r where r.vault_id = p_vault and r.kind = 'attachment' and r.item_id = p_target and r.payload->'item'->>'deletedAt' is null
      and (r.payload->'item'->>'mime' in ('application/pdf','application/x-pdf')
        or (r.payload->'item'->>'mime' = 'application/octet-stream'
          and r.payload->'item'->>'name' ~* '[.]pdf$')))
    when 'canvas' then exists (select 1 from public.noor_comment_canvas_targets c where c.vault_id = p_vault and c.canvas_id = p_target)
    else false end
$$;
revoke all on function public.noor_comment_valid_target(uuid,text,uuid) from public, anon;

create or replace function public.noor_register_comment_canvas(p_vault uuid, p_canvas uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault, 'edit') or not exists
    (select 1 from public.noor_sync_vaults v where v.id = p_vault and v.encryption_mode = 'none') then
    raise exception 'Canvas registration requires a plaintext vault editor';
  end if;
  insert into public.noor_comment_canvas_targets(vault_id,canvas_id,registered_by)
    values (p_vault,p_canvas,auth.uid()) on conflict do nothing;
end $$;
revoke all on function public.noor_register_comment_canvas(uuid,uuid) from public, anon;
grant execute on function public.noor_register_comment_canvas(uuid,uuid) to authenticated;

create or replace function public.noor_comment_canvas_available(p_vault uuid, p_canvas uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.noor_has_vault_permission(p_vault,'read') and exists
    (select 1 from public.noor_comment_canvas_targets c where c.vault_id=p_vault and c.canvas_id=p_canvas)
$$;
revoke all on function public.noor_comment_canvas_available(uuid,uuid) from public, anon;
grant execute on function public.noor_comment_canvas_available(uuid,uuid) to authenticated;

create or replace function public.noor_list_comment_participants(p_vault uuid)
returns table(user_id uuid, email text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault,'read') then raise exception 'Vault unavailable'; end if;
  return query select u.id, u.email::text from auth.users u where exists
    (select 1 from public.noor_sync_vaults v where v.id=p_vault and v.owner_id=u.id)
    or exists (select 1 from public.noor_vault_members m where m.vault_id=p_vault and m.user_id=u.id)
    order by 2;
end $$;
revoke all on function public.noor_list_comment_participants(uuid) from public, anon;
grant execute on function public.noor_list_comment_participants(uuid) to authenticated;

create or replace function public.noor_comment_mentions(p_vault uuid, p_body text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
  from (select lower(m[1]) as email from regexp_matches(p_body,
    '@([[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,})', 'g') m) names
  join auth.users u on lower(u.email) = names.email
  where exists (select 1 from public.noor_sync_vaults v where v.id = p_vault and v.owner_id = u.id)
    or exists (select 1 from public.noor_vault_members vm where vm.vault_id = p_vault and vm.user_id = u.id)
$$;
revoke all on function public.noor_comment_mentions(uuid,text) from public, anon;

create or replace function public.noor_comment_validate_anchor(p_kind text, p_anchor jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_anchor is null then p_kind in ('note','canvas')
    when pg_catalog.jsonb_typeof(p_anchor) <> 'object' or pg_catalog.octet_length(p_anchor::text) > 12000 then false
    when p_kind = 'note' then p_anchor->>'kind' = 'text'
      and length(p_anchor->>'exact') between 1 and 2000
      and length(coalesce(p_anchor->>'prefix','')) <= 80
      and length(coalesce(p_anchor->>'suffix','')) <= 80
      and length(coalesce(p_anchor->>'yStart','')) <= 2000
      and length(coalesce(p_anchor->>'yEnd','')) <= 2000
      and (p_anchor->>'start') ~ '^[0-9]{1,9}$'
      and (p_anchor->>'end') ~ '^[0-9]{1,9}$'
      and (p_anchor->>'end')::integer > (p_anchor->>'start')::integer
    when p_kind = 'canvas' then p_anchor->>'kind' = 'canvas'
      and (p_anchor->>'nodeId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when p_kind = 'pdf' then p_anchor->>'kind' = 'pdf'
      and (p_anchor->>'annotationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (p_anchor->>'page') ~ '^[1-9][0-9]{0,5}$'
      and length(coalesce(p_anchor->>'quote','')) <= 2000
    else false end
$$;
revoke all on function public.noor_comment_validate_anchor(text,jsonb) from public, anon;

create or replace function public.noor_create_comment_thread(p_vault uuid, p_kind text, p_target uuid, p_anchor jsonb, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_thread uuid;
begin
  if not public.noor_has_vault_permission(p_vault, 'comment') or not exists
    (select 1 from public.noor_sync_vaults v where v.id = p_vault and v.encryption_mode = 'none') then
    raise exception 'Comment permission required';
  end if;
  if not public.noor_comment_valid_target(p_vault,p_kind,p_target) then raise exception 'Comment target unavailable'; end if;
  if not coalesce(public.noor_comment_validate_anchor(p_kind,p_anchor),false) then raise exception 'Invalid comment anchor'; end if;
  if length(btrim(p_body)) not between 1 and 10000 then raise exception 'Comment must contain 1 to 10000 characters'; end if;
  insert into public.noor_comment_threads(vault_id,target_kind,target_id,anchor,created_by)
    values(p_vault,p_kind,p_target,p_anchor,auth.uid()) returning id into v_thread;
  insert into public.noor_comment_messages(thread_id,vault_id,author_id,body,mentions)
    values(v_thread,p_vault,auth.uid(),btrim(p_body),public.noor_comment_mentions(p_vault,p_body));
  return v_thread;
end $$;
revoke all on function public.noor_create_comment_thread(uuid,text,uuid,jsonb,text) from public, anon;
grant execute on function public.noor_create_comment_thread(uuid,text,uuid,jsonb,text) to authenticated;

create or replace function public.noor_reply_comment(p_thread uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_thread public.noor_comment_threads%rowtype; v_id uuid;
begin
  select * into v_thread from public.noor_comment_threads where id = p_thread;
  if not found or not public.noor_has_vault_permission(v_thread.vault_id,'comment') or not public.noor_comment_valid_target(v_thread.vault_id,v_thread.target_kind,v_thread.target_id)
    then raise exception 'Comment thread unavailable'; end if;
  if v_thread.resolved_at is not null then raise exception 'Reopen the thread before replying'; end if;
  if length(btrim(p_body)) not between 1 and 10000 then raise exception 'Comment must contain 1 to 10000 characters'; end if;
  insert into public.noor_comment_messages(thread_id,vault_id,author_id,body,mentions)
    values(p_thread,v_thread.vault_id,auth.uid(),btrim(p_body),public.noor_comment_mentions(v_thread.vault_id,p_body)) returning id into v_id;
  update public.noor_comment_threads set updated_at = now() where id = p_thread;
  return v_id;
end $$;
revoke all on function public.noor_reply_comment(uuid,text) from public, anon;
grant execute on function public.noor_reply_comment(uuid,text) to authenticated;

create or replace function public.noor_edit_comment(p_message uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_message public.noor_comment_messages%rowtype;
begin
  select * into v_message from public.noor_comment_messages where id = p_message;
  if not found or v_message.deleted_at is not null or v_message.author_id <> auth.uid()
    or not public.noor_has_vault_permission(v_message.vault_id,'comment') then raise exception 'Only the author may edit this comment'; end if;
  if length(btrim(p_body)) not between 1 and 10000 then raise exception 'Comment must contain 1 to 10000 characters'; end if;
  update public.noor_comment_messages set body=btrim(p_body), mentions=public.noor_comment_mentions(v_message.vault_id,p_body), edited_at=now() where id=p_message;
end $$;
revoke all on function public.noor_edit_comment(uuid,text) from public, anon;
grant execute on function public.noor_edit_comment(uuid,text) to authenticated;

create or replace function public.noor_delete_comment(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_message public.noor_comment_messages%rowtype; v_role text;
begin
  select * into v_message from public.noor_comment_messages where id = p_message;
  if not found or v_message.deleted_at is not null then raise exception 'Comment unavailable'; end if;
  v_role := public.noor_vault_role(v_message.vault_id);
  if not (v_message.author_id = auth.uid() and public.noor_has_vault_permission(v_message.vault_id,'comment'))
    and coalesce(v_role,'') not in ('owner','admin') then raise exception 'Only the author or a moderator may delete this comment'; end if;
  update public.noor_comment_messages set body='',mentions='{}',deleted_at=now(),deleted_by=auth.uid() where id=p_message;
end $$;
revoke all on function public.noor_delete_comment(uuid) from public, anon;
grant execute on function public.noor_delete_comment(uuid) to authenticated;

create or replace function public.noor_set_comment_resolved(p_thread uuid, p_resolved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_thread public.noor_comment_threads%rowtype; v_role text;
begin
  select * into v_thread from public.noor_comment_threads where id = p_thread;
  if not found then raise exception 'Comment thread unavailable'; end if;
  v_role := public.noor_vault_role(v_thread.vault_id);
  if not (v_thread.created_by = auth.uid() and public.noor_has_vault_permission(v_thread.vault_id,'comment'))
    and coalesce(v_role,'') not in ('owner','admin','editor') then raise exception 'Only the thread author or an editor may resolve it'; end if;
  update public.noor_comment_threads set resolved_at=case when p_resolved then now() else null end,
    resolved_by=case when p_resolved then auth.uid() else null end,updated_at=now() where id=p_thread;
end $$;
revoke all on function public.noor_set_comment_resolved(uuid,boolean) from public, anon;
grant execute on function public.noor_set_comment_resolved(uuid,boolean) to authenticated;

create or replace function public.noor_comment_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(pg_catalog.jsonb_build_object('threadId',case when TG_TABLE_NAME = 'noor_comment_threads' then new.id else new.thread_id end),
    'changed','noor:comments:' || new.vault_id::text,true);
  return new;
exception when others then return new;
end $$;
create trigger noor_comment_threads_notify after insert or update on public.noor_comment_threads
  for each row execute function public.noor_comment_notify();
create trigger noor_comment_messages_notify after insert or update on public.noor_comment_messages
  for each row execute function public.noor_comment_notify();
create policy "Members receive private comment changes" on realtime.messages for select to authenticated
  using (extension = 'broadcast' and split_part(realtime.topic(),':',1) = 'noor'
    and split_part(realtime.topic(),':',2) = 'comments'
    and exists (select 1 from public.noor_sync_vaults v where v.id::text = split_part(realtime.topic(),':',3)
      and public.noor_has_vault_permission(v.id,'read')));
