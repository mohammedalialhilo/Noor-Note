-- Apply after 202609290001_noor_cloud_sync.sql. Encryption mode is fixed at vault creation.
alter table public.noor_sync_vaults
  add column if not exists encryption_mode text not null default 'none'
  check (encryption_mode in ('none', 'e2ee'));

create or replace function public.noor_keep_vault_encryption_mode()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.encryption_mode is distinct from old.encryption_mode then
    raise exception 'Vault encryption mode cannot change after creation' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists noor_sync_vault_encryption_immutable on public.noor_sync_vaults;
create trigger noor_sync_vault_encryption_immutable before update on public.noor_sync_vaults
  for each row execute function public.noor_keep_vault_encryption_mode();

-- Public device keys and sealed vault-key envelopes prepare secure distribution to future shared vaults.
-- They do not grant access to sync records or attachment bytes by themselves.
create table if not exists public.noor_device_public_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  public_jwk jsonb not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, device_id),
  constraint noor_public_device_key_format check (public_jwk->>'kty' = 'EC' and public_jwk->>'crv' = 'P-256' and not (public_jwk ? 'd'))
);
alter table public.noor_device_public_keys enable row level security;
revoke all on public.noor_device_public_keys from anon, authenticated;
grant select, insert, update on public.noor_device_public_keys to authenticated;
create policy "Owner reads public device keys" on public.noor_device_public_keys for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner registers public device key" on public.noor_device_public_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner revokes public device key" on public.noor_device_public_keys for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.noor_keep_device_key_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id
    or new.device_id is distinct from old.device_id
    or new.public_jwk is distinct from old.public_jwk
    or new.fingerprint is distinct from old.fingerprint
    or new.created_at is distinct from old.created_at
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'Device key identity is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists noor_device_key_identity_immutable on public.noor_device_public_keys;
create trigger noor_device_key_identity_immutable before update on public.noor_device_public_keys
  for each row execute function public.noor_keep_device_key_identity();

create table if not exists public.noor_vault_key_envelopes (
  vault_id uuid not null references public.noor_sync_vaults(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_device_id uuid not null,
  key_epoch integer not null check (key_epoch > 0),
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  primary key (vault_id, recipient_user_id, recipient_device_id, key_epoch),
  constraint noor_key_envelope_format check (envelope->>'version' = '1' and envelope->>'vaultId' = vault_id::text and (envelope->>'epoch')::integer = key_epoch)
);
alter table public.noor_vault_key_envelopes enable row level security;
revoke all on public.noor_vault_key_envelopes from anon, authenticated;
grant select, insert on public.noor_vault_key_envelopes to authenticated;
create policy "Recipient reads sealed vault key" on public.noor_vault_key_envelopes for select to authenticated using (recipient_user_id = (select auth.uid()));
create policy "Vault owner distributes sealed key" on public.noor_vault_key_envelopes for insert to authenticated with check (
  exists (select 1 from public.noor_sync_vaults v where v.id = vault_id and v.owner_id = (select auth.uid()) and v.encryption_mode = 'e2ee')
);

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
  vault_mode text;
  current_row public.noor_sync_records%rowtype;
  previous_result jsonb;
  new_version bigint;
  new_sequence bigint;
  response jsonb;
begin
  select encryption_mode into vault_mode from public.noor_sync_vaults where id = p_vault_id and owner_id = owner;
  if owner is null or vault_mode is null then
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
  if vault_mode = 'e2ee' and (
    not (p_payload ? 'sealed')
    or p_payload->'sealed'->>'version' is distinct from '1'
    or p_payload->'sealed'->>'epoch' is null
    or (p_kind = 'vault' and not (p_payload ? 'recovery'))
  ) or vault_mode = 'none' and p_payload ? 'sealed' then
    raise exception 'Sync payload encryption mode mismatch' using errcode = '22023';
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
