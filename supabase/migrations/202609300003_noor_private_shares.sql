-- Private shares are separate from public publishing. Anonymous roles cannot read either table.
create schema if not exists extensions;
do $$
begin
  if to_regprocedure('extensions.crypt(text,text)') is null then
    create extension if not exists pgcrypto with schema extensions;
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null then
    raise exception 'pgcrypto must be installed in the extensions schema';
  end if;
end $$;

create table public.noor_private_shares (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  note_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(title) between 1 and 200),
  markdown text not null check (octet_length(markdown) <= 1048576),
  password_hash text,
  password_required boolean not null default false,
  expires_at timestamptz,
  download_allowed boolean not null default false,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint noor_share_password_consistency check (password_required = (password_hash is not null))
);
create index noor_private_shares_vault_idx on public.noor_private_shares(vault_id, created_at desc);
alter table public.noor_private_shares enable row level security;
revoke all on public.noor_private_shares from public, anon, authenticated;
grant select (id, vault_id, note_id, title, password_required, expires_at, download_allowed, created_by, created_at, revoked_at)
  on public.noor_private_shares to authenticated;
create policy "Managers list private share metadata" on public.noor_private_shares for select to authenticated
  using (public.noor_has_vault_permission(vault_id, 'manage'));

create table public.noor_private_share_sessions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.noor_private_shares(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index noor_share_sessions_share_idx on public.noor_private_share_sessions(share_id, expires_at);
alter table public.noor_private_share_sessions enable row level security;
revoke all on public.noor_private_share_sessions from public, anon, authenticated;

create function public.noor_create_private_share(
  p_vault_id uuid, p_note_id uuid, p_title text, p_markdown text,
  p_expires_at timestamptz default null, p_password text default null,
  p_download_allowed boolean default false
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_token text;
  v_share_id uuid;
  v_password_hash text;
begin
  if not public.noor_has_vault_permission(p_vault_id, 'manage')
    or not exists (select 1 from public.noor_sync_vaults v where v.id = p_vault_id and v.encryption_mode = 'none') then
    raise exception 'Share management is unavailable for this vault' using errcode = '42501';
  end if;
  if p_note_id is null or p_title is null or char_length(btrim(p_title)) not between 1 and 200
    or p_markdown is null or octet_length(p_markdown) > 1048576 then
    raise exception 'Invalid note snapshot' using errcode = '22023';
  end if;
  if p_expires_at is not null and (p_expires_at <= now() + interval '1 minute' or p_expires_at > now() + interval '365 days') then
    raise exception 'Expiration must be between one minute and one year from now' using errcode = '22023';
  end if;
  if p_password is not null and (char_length(p_password) < 12 or octet_length(p_password) > 72) then
    raise exception 'Share password must contain 12 to 72 UTF-8 bytes' using errcode = '22023';
  end if;
  if p_password is not null then
    v_password_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 12));
  end if;
  -- Two independent random UUIDv4 values provide 244 unpredictable bits.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.noor_private_shares(vault_id, note_id, token_hash, title, markdown,
    password_hash, password_required, expires_at, download_allowed, created_by)
  values (p_vault_id, p_note_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    btrim(p_title), p_markdown, v_password_hash, p_password is not null,
    p_expires_at, p_download_allowed, auth.uid()) returning id into v_share_id;
  return jsonb_build_object('id', v_share_id, 'token', v_token);
end;
$$;
revoke all on function public.noor_create_private_share(uuid,uuid,text,text,timestamptz,text,boolean) from public, anon, authenticated;
grant execute on function public.noor_create_private_share(uuid,uuid,text,text,timestamptz,text,boolean) to authenticated;

create function public.noor_open_private_share(p_token text, p_password text default null, p_session text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_share public.noor_private_shares%rowtype;
  v_session_token text := null;
  v_attempts integer;
  v_session_valid boolean := false;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select * into v_share from public.noor_private_shares
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found or v_share.revoked_at is not null or (v_share.expires_at is not null and v_share.expires_at <= now()) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_share.password_required then
    if p_session is not null and p_session ~ '^[0-9a-f]{64}$' then
      select exists (select 1 from public.noor_private_share_sessions s where s.share_id = v_share.id
        and s.token_hash = encode(sha256(convert_to(p_session, 'UTF8')), 'hex') and s.expires_at > now()) into v_session_valid;
    end if;
    if not v_session_valid then
      if p_password is null or p_password = '' then return jsonb_build_object('status', 'password_required'); end if;
      if v_share.locked_until is not null and v_share.locked_until > now() then return jsonb_build_object('status', 'locked'); end if;
      if octet_length(p_password) > 72 or v_share.password_hash <> extensions.crypt(p_password, v_share.password_hash) then
        v_attempts := v_share.failed_attempts + 1;
        update public.noor_private_shares set failed_attempts = case when v_attempts >= 5 then 0 else v_attempts end,
          locked_until = case when v_attempts >= 5 then now() + interval '15 minutes' else null end where id = v_share.id;
        return jsonb_build_object('status', 'password_required');
      end if;
      update public.noor_private_shares set failed_attempts = 0, locked_until = null where id = v_share.id;
      delete from public.noor_private_share_sessions where share_id = v_share.id and expires_at <= now();
      v_session_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      insert into public.noor_private_share_sessions(share_id, token_hash, expires_at)
        values (v_share.id, encode(sha256(convert_to(v_session_token, 'UTF8')), 'hex'),
          least(now() + interval '12 hours', coalesce(v_share.expires_at, now() + interval '12 hours')));
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_share.id, 'title', v_share.title,
    'markdown', v_share.markdown, 'download_allowed', v_share.download_allowed,
    'expires_at', v_share.expires_at, 'session', v_session_token);
end;
$$;
revoke all on function public.noor_open_private_share(text,text,text) from public, anon, authenticated;
grant execute on function public.noor_open_private_share(text,text,text) to anon, authenticated;

create function public.noor_revoke_private_share(p_share_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_vault_id uuid;
begin
  select vault_id into v_vault_id from public.noor_private_shares where id = p_share_id;
  if not found or not public.noor_has_vault_permission(v_vault_id, 'manage') then
    raise exception 'Share unavailable' using errcode = '42501';
  end if;
  update public.noor_private_shares set revoked_at = coalesce(revoked_at, now()) where id = p_share_id;
  delete from public.noor_private_share_sessions where share_id = p_share_id;
  return true;
end;
$$;
revoke all on function public.noor_revoke_private_share(uuid) from public, anon, authenticated;
grant execute on function public.noor_revoke_private_share(uuid) to authenticated;
