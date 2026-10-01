-- Keep encrypted key material scoped to a currently authorized vault owner.
-- Shared E2EE vaults are not supported; no other account may receive a key
-- envelope until a reviewed shared-key protocol is deployed.
drop policy "Recipient reads sealed vault key" on public.noor_vault_key_envelopes;
create policy "Current vault owner reads sealed key" on public.noor_vault_key_envelopes
  for select to authenticated using (
    recipient_user_id = (select auth.uid())
    and public.noor_has_vault_permission(vault_id, 'transfer')
  );
drop policy "Vault owner distributes sealed key" on public.noor_vault_key_envelopes;
create policy "Vault owner wraps own key" on public.noor_vault_key_envelopes
  for insert to authenticated with check (
    recipient_user_id = (select auth.uid())
    and public.noor_has_vault_permission(vault_id, 'transfer')
    and exists (
      select 1 from public.noor_sync_vaults v
      where v.id = vault_id and v.encryption_mode = 'e2ee'
    )
  );

-- The pre-invitation sharing RPC would bypass acceptance. New sharing must
-- use pending invitations and explicit acceptance.
revoke execute on function public.noor_add_vault_member(uuid, text) from authenticated;

-- The flat-comment table is retained only for migration compatibility.
-- Its former policies should not become active if a grant is added later.
drop policy if exists "Vault participants read comments" on public.noor_shared_comments;
drop policy if exists "Vault commenters add comments" on public.noor_shared_comments;
drop policy if exists "Authors or managers remove comments" on public.noor_shared_comments;
revoke all on public.noor_shared_comments from public, anon, authenticated;

-- Trigger entry points are invoked by Postgres, not by API clients.
revoke all on function public.noor_activity_comment_change() from public, anon, authenticated;
revoke all on function public.noor_activity_invite_change() from public, anon, authenticated;
revoke all on function public.noor_activity_member_change() from public, anon, authenticated;
revoke all on function public.noor_activity_note_change() from public, anon, authenticated;
revoke all on function public.noor_activity_notify() from public, anon, authenticated;
revoke all on function public.noor_comment_notify() from public, anon, authenticated;
revoke all on function public.noor_notify_collab_update() from public, anon, authenticated;

-- Auth account removal must revoke membership and not be blocked by rows
-- that only retain historical attribution. Content stays in shared vaults.
-- A private bearer share created by the deleted account is revoked by
-- deleting that share (sessions cascade with it).
alter table public.noor_vault_invites
  drop constraint noor_vault_invites_invited_by_fkey,
  add constraint noor_vault_invites_invited_by_fkey
    foreign key (invited_by) references auth.users(id) on delete cascade;
alter table public.noor_vault_transfers
  drop constraint noor_vault_transfers_from_user_id_fkey,
  add constraint noor_vault_transfers_from_user_id_fkey
    foreign key (from_user_id) references auth.users(id) on delete cascade,
  drop constraint noor_vault_transfers_to_user_id_fkey,
  add constraint noor_vault_transfers_to_user_id_fkey
    foreign key (to_user_id) references auth.users(id) on delete cascade;
alter table public.noor_collab_documents alter column created_by drop not null;
alter table public.noor_collab_documents
  drop constraint noor_collab_documents_created_by_fkey,
  add constraint noor_collab_documents_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;
alter table public.noor_collab_updates alter column author_id drop not null;
alter table public.noor_collab_updates
  drop constraint noor_collab_updates_author_id_fkey,
  add constraint noor_collab_updates_author_id_fkey
    foreign key (author_id) references auth.users(id) on delete set null;
alter table public.noor_shared_comments alter column author_id drop not null;
alter table public.noor_shared_comments
  drop constraint noor_shared_comments_author_id_fkey,
  add constraint noor_shared_comments_author_id_fkey
    foreign key (author_id) references auth.users(id) on delete set null;
alter table public.noor_comment_canvas_targets alter column registered_by drop not null;
alter table public.noor_comment_canvas_targets
  drop constraint noor_comment_canvas_targets_registered_by_fkey,
  add constraint noor_comment_canvas_targets_registered_by_fkey
    foreign key (registered_by) references auth.users(id) on delete set null;
alter table public.noor_comment_threads alter column created_by drop not null;
alter table public.noor_comment_threads
  drop constraint noor_comment_threads_created_by_fkey,
  add constraint noor_comment_threads_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  drop constraint noor_comment_threads_resolved_by_fkey,
  add constraint noor_comment_threads_resolved_by_fkey
    foreign key (resolved_by) references auth.users(id) on delete set null;
alter table public.noor_comment_messages alter column author_id drop not null;
alter table public.noor_comment_messages
  drop constraint noor_comment_messages_author_id_fkey,
  add constraint noor_comment_messages_author_id_fkey
    foreign key (author_id) references auth.users(id) on delete set null,
  drop constraint noor_comment_messages_deleted_by_fkey,
  add constraint noor_comment_messages_deleted_by_fkey
    foreign key (deleted_by) references auth.users(id) on delete set null;
alter table public.noor_activity_events alter column actor_id drop not null;
alter table public.noor_activity_events
  drop constraint noor_activity_events_actor_id_fkey,
  add constraint noor_activity_events_actor_id_fkey
    foreign key (actor_id) references auth.users(id) on delete set null;
alter table public.noor_private_shares
  drop constraint noor_private_shares_created_by_fkey,
  add constraint noor_private_shares_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade;

-- Deleted users can still have historical events. They are not selectable
-- as an actor filter because their auth identity no longer exists.
create or replace function public.noor_list_activity_actors(p_vault uuid)
returns table(actor_id uuid, actor_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.noor_has_vault_permission(p_vault, 'read') then
    raise exception 'Vault unavailable' using errcode = '42501';
  end if;
  return query select distinct a.actor_id, a.actor_email
    from public.noor_activity_events a
    where a.vault_id = p_vault and a.actor_id is not null
    order by a.actor_email;
end $$;
