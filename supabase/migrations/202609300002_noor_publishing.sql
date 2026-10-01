-- Public publishing stores an explicit snapshot, separate from private sync records.
create table public.noor_public_sites (
  vault_id uuid primary key references public.noor_sync_vaults(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 500),
  theme text not null default 'system' check (theme in ('light','dark','system')),
  robots text not null default 'noindex' check (robots in ('index','noindex')),
  navigation text[] not null default '{}' check (cardinality(navigation) <= 50 and array_position(navigation, null) is null and array_to_string(navigation, ',') ~ '^([a-z0-9]+(-[a-z0-9]+)*(,[a-z0-9]+(-[a-z0-9]+)*)*)?$'),
  homepage_slug text check (homepage_slug is null or (homepage_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(homepage_slug) <= 100)),
  graph_enabled boolean not null default false,
  logo_path text,
  favicon_path text,
  updated_at timestamptz not null default now(),
  constraint noor_public_site_brand_paths check (
    (logo_path is null or logo_path ~ ('^site/' || vault_id::text || '/[0-9a-f-]{36}$')) and
    (favicon_path is null or favicon_path ~ ('^site/' || vault_id::text || '/[0-9a-f-]{36}$'))
  )
);
create table public.noor_public_pages (
  vault_id uuid not null references public.noor_public_sites(vault_id) on delete cascade,
  note_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 100 and slug <> 'graph'),
  title text not null check (char_length(title) between 1 and 200),
  source_path text not null check (char_length(source_path) between 1 and 1024),
  aliases text[] not null default '{}',
  markdown text not null check (octet_length(markdown) <= 1048576),
  assets jsonb not null default '{}'::jsonb check (jsonb_typeof(assets) = 'object'),
  description text not null default '' check (char_length(description) <= 500),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (vault_id, note_id),
  unique (vault_id, slug)
);
create index noor_public_pages_site_idx on public.noor_public_pages(vault_id, slug);
alter table public.noor_public_sites enable row level security;
alter table public.noor_public_pages enable row level security;
revoke all on public.noor_public_sites, public.noor_public_pages from anon, authenticated;
grant select on public.noor_public_sites, public.noor_public_pages to anon, authenticated;
grant insert, update, delete on public.noor_public_sites, public.noor_public_pages to authenticated;
create policy "Anyone reads published site settings" on public.noor_public_sites for select to anon using (true);
create policy "Managers read site settings" on public.noor_public_sites for select to authenticated using (public.noor_has_vault_permission(vault_id, 'manage'));
create policy "Managers create sites" on public.noor_public_sites for insert to authenticated with check (public.noor_has_vault_permission(vault_id, 'manage'));
create policy "Managers edit sites" on public.noor_public_sites for update to authenticated using (public.noor_has_vault_permission(vault_id, 'manage')) with check (public.noor_has_vault_permission(vault_id, 'manage'));
create policy "Managers remove sites" on public.noor_public_sites for delete to authenticated using (public.noor_has_vault_permission(vault_id, 'manage'));
create policy "Anyone reads published pages" on public.noor_public_pages for select to anon using (true);
create policy "Managers read published pages" on public.noor_public_pages for select to authenticated using (public.noor_has_vault_permission(vault_id, 'manage'));
create policy "Managers publish pages" on public.noor_public_pages for insert to authenticated with check (public.noor_has_vault_permission(vault_id, 'manage'));
create policy "Managers update pages" on public.noor_public_pages for update to authenticated using (public.noor_has_vault_permission(vault_id, 'manage')) with check (public.noor_has_vault_permission(vault_id, 'manage'));
create policy "Managers unpublish pages" on public.noor_public_pages for delete to authenticated using (public.noor_has_vault_permission(vault_id, 'manage'));

-- The bucket is private. Anonymous downloads are authorized against the CURRENT snapshot.
insert into storage.buckets (id, name, public) values ('noor-note-published', 'noor-note-published', false) on conflict (id) do nothing;
create policy "Public reads selected publication assets" on storage.objects for select to anon using (
  bucket_id = 'noor-note-published' and (
    exists (select 1 from public.noor_public_sites s where name in (s.logo_path, s.favicon_path))
    or exists (select 1 from public.noor_public_pages p where
      (storage.foldername(name))[1] = p.vault_id::text and
      (storage.foldername(name))[2] = p.note_id::text and
      exists (select 1 from jsonb_each_text(p.assets) asset where asset.value = (storage.foldername(name))[3]))
  )
);
create policy "Managers read publication assets" on storage.objects for select to authenticated using (
  bucket_id = 'noor-note-published' and
  public.noor_has_vault_permission((storage.foldername(name))[case when (storage.foldername(name))[1] = 'site' then 2 else 1 end]::uuid, 'manage')
);
create policy "Managers upload publication assets" on storage.objects for insert to authenticated with check (
  bucket_id = 'noor-note-published' and
  public.noor_has_vault_permission((storage.foldername(name))[case when (storage.foldername(name))[1] = 'site' then 2 else 1 end]::uuid, 'manage')
);
create policy "Managers remove publication assets" on storage.objects for delete to authenticated using (
  bucket_id = 'noor-note-published' and
  public.noor_has_vault_permission((storage.foldername(name))[case when (storage.foldername(name))[1] = 'site' then 2 else 1 end]::uuid, 'manage')
);
