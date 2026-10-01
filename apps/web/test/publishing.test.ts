import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { outgoingPublicLinks, publicWikiTarget, publicationSlug, publicSnapshotMarkdown, referencedPublicImages, type PublicPage, type PublicSite } from '../src/lib/publishing';
import { renderPublicHtml } from '../netlify/functions/publish';
import type { Attachment } from '@noor-note/core';

const id = () => crypto.randomUUID();
const siteId = id(), owner = id(), editor = id(), outsider = id();
const publicId = id(), linkedId = id(), privateId = id(), assetId = id();
const site: PublicSite = { vault_id: siteId, slug: 'research', title: 'Research notes', description: 'Published research', theme: 'system', robots: 'noindex', navigation: ['welcome', 'secret'], homepage_slug: 'welcome', graph_enabled: true, logo_path: null, favicon_path: null };
const page = (noteId: string, slug: string, markdown: string): PublicPage => ({ vault_id: siteId, note_id: noteId, slug, title: slug, source_path: `${slug}.md`, aliases: [], markdown, assets: {}, description: '', published_at: new Date().toISOString(), updated_at: new Date().toISOString() });

describe('public publishing', () => {
  it('resolves only explicitly published links, backlinks, and graph nodes', () => {
    const source = page(publicId, 'welcome', `# Welcome\n\n[[Linked]] and [[Secret]] and [[Secret]]<!-- noor-note-id:${privateId} -->\n\n![Selected](image.png)`);
    const linked = page(linkedId, 'linked', '# Linked\n\nA public page');
    linked.title = 'Linked';
    const pages = [source, linked];
    expect(outgoingPublicLinks(source, pages).map((item) => item.note_id)).toEqual([linkedId]);
    expect(publicWikiTarget('#noor-wiki-Secret', source, pages)).toBeNull();
    expect(publicWikiTarget(`#noor-wiki-Secret&noor-id=${privateId}`, source, pages)).toBeNull();
    const html = renderPublicHtml(new Request('https://example.test/p/research/welcome'), site, source, pages, false);
    expect(html).toContain('/p/research/linked');
    expect(html).not.toContain('/p/research/secret');
    expect(html).not.toContain(privateId);
    expect(html).not.toContain('Secret body');
    expect(html).toContain('noindex,nofollow');
    expect(html).toContain('Table of contents');
    const graph = renderPublicHtml(new Request('https://example.test/p/research/graph'), site, null, pages, true);
    expect(graph).toContain('Graph of 2 published pages');
    expect(graph).not.toContain('Secret body');
    const rich = renderPublicHtml(new Request('https://example.test/p/research/linked'), site,
      page(linkedId, 'linked', '## Math\n\n$x^2$\n\n```mermaid\ngraph LR; A-->B\n```\n\n```js\nconst a = 1\n```'), pages, false);
    expect(rich).toContain('class="katex"');
    expect(rich).toContain('class="mermaid"');
    expect(rich).toContain('language-js');
    expect(publicationSlug('A'.repeat(99) + '-Z')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(publicSnapshotMarkdown(`---\nsecret: private\n---\n[[Secret]]<!-- noor-note-id:${privateId} -->`)).toBe('[[Secret]]');
    const makeImage = (name: string): Attachment => ({ id: id(), vaultId: siteId, folderId: null, path: `/${name}`, name, mime: 'image/png', size: 1, storage: 'indexeddb', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, trashGroupId: null });
    const image = makeImage('image.png');
    const hidden = makeImage('hidden.png');
    expect(referencedPublicImages('![Shown](image.png)\n```md\n![Hidden](hidden.png)\n```\n`![Hidden](hidden.png)`', '/welcome.md', [image, hidden]).map((item) => item.id)).toEqual([image.id]);
  });

  it('enforces publication and asset access with database roles', async () => {
    const db = new PGlite();
    const as = async <T>(role: 'anon' | 'authenticated', user: string | null, action: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', user ?? '']);
      try { return await action(); } finally { await db.exec('reset role'); }
    };
    try {
      await db.exec(`
        create role anon; create role authenticated;
        create schema auth; create schema storage; create schema realtime;
        create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        create table storage.buckets(id text primary key,name text,public boolean);
        create table storage.objects(bucket_id text,name text primary key);
        alter table storage.objects enable row level security;
        create function storage.foldername(p_name text) returns text[] language sql immutable as $$select string_to_array(p_name,'/')$$;
        create table realtime.messages(extension text,topic text);
        alter table realtime.messages enable row level security;
        create function realtime.topic() returns text language sql stable as $$select current_setting('request.realtime.topic',true)$$;
        create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$select null$$;
        grant usage on schema public,storage,realtime to anon,authenticated;
        grant select on storage.objects to anon,authenticated;
        grant insert,delete on storage.objects to authenticated;
        grant select,insert on realtime.messages to authenticated;
      `);
      for (const name of ['202609290001_noor_cloud_sync.sql','202609290002_noor_e2ee.sql','202609290003_noor_collaboration.sql','202609290004_noor_sharing_permissions.sql','202609300002_noor_publishing.sql']) {
        await db.exec(readFileSync(resolve(process.cwd(), '../../supabase/migrations', name), 'utf8'));
      }
      for (const person of [owner, editor, outsider]) await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [person, `${person}@example.test`]);
      await as('authenticated', owner, async () => {
        await db.query('insert into public.noor_sync_vaults(id,owner_id,name) values($1,$2,$3)', [siteId, owner, 'Vault']);
        await db.query('insert into public.noor_public_sites(vault_id,slug,title) values($1,$2,$3)', [siteId, 'research', 'Research']);
        await db.query('insert into public.noor_public_pages(vault_id,note_id,slug,title,source_path,markdown,assets) values($1,$2,$3,$4,$5,$6,$7)', [siteId, publicId, 'welcome', 'Welcome', 'welcome.md', 'Published only', JSON.stringify({ 'image.png': assetId })]);
      });
      await db.query('insert into public.noor_vault_members(vault_id,user_id,role) values($1,$2,$3)', [siteId, editor, 'editor']);
      await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)', ['noor-note-published', `${siteId}/${publicId}/${assetId}`, `${siteId}/${publicId}/${privateId}`]);
      await as('anon', null, async () => {
        expect((await db.query('select title from public.noor_public_pages')).rows).toEqual([{ title: 'Welcome' }]);
        expect((await db.query('select name from storage.objects order by name')).rows).toEqual([{ name: `${siteId}/${publicId}/${assetId}` }]);
        await expect(db.query('insert into public.noor_public_pages(vault_id,note_id,slug,title,source_path,markdown) values($1,$2,$3,$4,$5,$6)', [siteId, privateId, 'secret', 'Secret', 'secret.md', 'Private body'])).rejects.toThrow();
      });
      await as('authenticated', outsider, async () => {
        expect((await db.query('select * from public.noor_public_pages')).rows).toHaveLength(0);
        await expect(db.query('delete from public.noor_public_pages where vault_id=$1', [siteId])).resolves.toBeDefined();
        expect((await db.query('select * from public.noor_public_sites')).rows).toHaveLength(0);
      });
      await as('authenticated', editor, async () => {
        await expect(db.query('insert into public.noor_public_pages(vault_id,note_id,slug,title,source_path,markdown) values($1,$2,$3,$4,$5,$6)', [siteId, privateId, 'secret', 'Secret', 'secret.md', 'Private body'])).rejects.toThrow();
      });
      await as('authenticated', owner, async () => {
        await db.query('delete from public.noor_public_pages where vault_id=$1 and note_id=$2', [siteId, publicId]);
      });
      await as('anon', null, async () => {
        expect((await db.query('select * from public.noor_public_pages')).rows).toHaveLength(0);
        expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
      });
    } finally { await db.close(); }
  }, 15_000);
});
