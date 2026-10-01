'use client';

import type { useVaultWorkspace } from '../hooks/useVaultWorkspace';
import type { useCloudSync } from '../hooks/useCloudSync';
import { useAccount } from '../auth/AuthProvider';
import { pageSchema, publicationSlug, publicSnapshotMarkdown, referencedPublicImages, siteSchema, slugSchema, type PublicPage, type PublicSite } from '../lib/publishing';
import { Button } from '@noor-note/ui';
import { safeAttachmentPreview } from '../lib/safe-attachment-preview';
import { useEffect, useState } from 'react';
import styles from './PublishingManager.module.css';

const bucket = 'noor-note-published';
const imageMimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
type SiteDraft = Pick<PublicSite, 'slug' | 'title' | 'description' | 'theme' | 'robots' | 'navigation' | 'homepage_slug' | 'graph_enabled' | 'logo_path' | 'favicon_path'>;

export function PublishingManager({ workspace, sync }: { workspace: ReturnType<typeof useVaultWorkspace>; sync: ReturnType<typeof useCloudSync> }) {
  const account = useAccount();
  const vault = workspace.activeVault;
  const vaultId = vault?.id;
  const [site, setSite] = useState<PublicSite | null>(null);
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [pages, setPages] = useState<PublicPage[]>([]);
  const [noteId, setNoteId] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [favicon, setFavicon] = useState<File | null>(null);
  const available = Boolean(account.client && account.user && vaultId && sync.enabled && sync.encryption === 'none' && (sync.role === 'owner' || sync.role === 'admin'));

  useEffect(() => {
    if (!available || !account.client || !vaultId) return;
    let active = true;
    const client = account.client;
    void Promise.all([
      client.from('noor_public_sites').select('*').eq('vault_id', vaultId).maybeSingle(),
      client.from('noor_public_pages').select('*').eq('vault_id', vaultId).order('updated_at', { ascending: false }),
    ]).then(([siteResult, pageResult]) => {
      if (!active) return;
      if (siteResult.error || pageResult.error) throw siteResult.error ?? pageResult.error;
      const parsedSite = siteResult.data ? siteSchema.parse(siteResult.data) : null;
      setSite(parsedSite);
      setDraft(parsedSite ? { ...parsedSite } : { slug: publicationSlug(vault?.name ?? '') || 'my-notes', title: vault?.name ?? 'Noor Note', description: '', theme: 'system', robots: 'noindex', navigation: [], homepage_slug: null, graph_enabled: false, logo_path: null, favicon_path: null });
      setPages(pageSchema.array().parse(pageResult.data));
    }).catch(() => { if (active) setMessage('Could not load publishing settings. Apply the publishing database migration and check your connection.'); });
    return () => { active = false; };
  }, [account.client, available, vault?.name, vaultId]);

  useEffect(() => {
    const note = workspace.notes.find((item) => item.id === noteId);
    const published = pages.find((page) => page.note_id === noteId);
    const timer = window.setTimeout(() => { setSlug(published?.slug ?? publicationSlug(note?.title ?? '')); setDescription(published?.description ?? ''); setApproved(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [noteId, pages, workspace.notes]);

  const refresh = async () => {
    if (!account.client || !vaultId) return;
    const response = await account.client.from('noor_public_pages').select('*').eq('vault_id', vaultId).order('updated_at', { ascending: false });
    if (response.error) throw response.error;
    setPages(pageSchema.array().parse(response.data));
  };

  const uploadBrand = async (file: File | null, previous: string | null): Promise<string | null> => {
    if (!file || !account.client || !vaultId) return previous;
    if (!imageMimes.has(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Brand images must be PNG, JPEG, WebP, GIF, or AVIF under 8 MB.');
    const image = await safeAttachmentPreview(file, file.type);
    if (!image) throw new Error('Brand image bytes do not match the selected image type.');
    const path = `site/${vaultId}/${crypto.randomUUID()}`;
    const result = await account.client.storage.from(bucket).upload(path, image, { contentType: image.type, upsert: false });
    if (result.error) throw result.error;
    return path;
  };

  const saveSite = async () => {
    if (!available || !account.client || !vaultId || !draft) return;
    setBusy(true); setMessage('');
    try {
      if (!slugSchema.max(80).safeParse(draft.slug).success || !draft.title.trim()) throw new Error('Use a site slug with lowercase letters, digits, and hyphens, plus a title.');
      if (draft.navigation.length > 50 || !draft.navigation.every((item) => slugSchema.safeParse(item).success)) throw new Error('Navigation accepts up to 50 published page slugs, separated by commas.');
      const logoPath = await uploadBrand(logo, draft.logo_path);
      const faviconPath = await uploadBrand(favicon, draft.favicon_path);
      const payload = { ...draft, vault_id: vaultId, title: draft.title.trim(), description: draft.description.trim(), logo_path: logoPath, favicon_path: faviconPath, updated_at: new Date().toISOString() };
      const result = await account.client.from('noor_public_sites').upsert(payload, { onConflict: 'vault_id' }).select('*').single();
      if (result.error) throw result.error;
      const parsed = siteSchema.parse(result.data);
      setSite(parsed); setDraft({ ...parsed }); setLogo(null); setFavicon(null);
      const oldBrand = [logo && site?.logo_path, favicon && site?.favicon_path].filter((path): path is string => typeof path === 'string');
      if (oldBrand.length) void account.client.storage.from(bucket).remove(oldBrand);
      setMessage('Public site settings saved. Pages become visible only when you publish them below.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save public site.'); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    if (!available || !account.client || !vaultId || !workspace.repository || !site || !approved) return;
    setBusy(true); setMessage('');
    try {
      if (!slugSchema.safeParse(slug).success || slug === 'graph') throw new Error('Choose a lowercase page slug using letters, digits, and hyphens.');
      await workspace.flushPending();
      const note = await workspace.repository.getNote(noteId);
      if (!note || note.deletedAt || note.vaultId !== vaultId) throw new Error('The selected note is unavailable.');
      const selected = referencedPublicImages(note.markdown, note.path, workspace.attachments);
      const previous = pages.find((page) => page.note_id === note.id);
      if (selected.length > 30) throw new Error('A public page can include up to 30 local images.');
      const assets: Record<string, string> = {};
      const uploaded: string[] = [];
      try {
        for (const item of selected) {
          if (!imageMimes.has(item.mime)) throw new Error(`Unsupported public image type: ${item.path}`);
          if (item.size > 8 * 1024 * 1024) throw new Error(`Image exceeds 8 MB: ${item.path}`);
          const blob = await workspace.repository.getAttachmentBlob(item.id);
          if (!blob) throw new Error(`Image is missing locally: ${item.path}`);
          const image = await safeAttachmentPreview(blob, item.mime);
          if (!image) throw new Error(`Image bytes do not match the declared type: ${item.path}`);
          const assetId = crypto.randomUUID();
          const path = `${vaultId}/${note.id}/${assetId}`;
          const response = await account.client.storage.from(bucket).upload(path, image, { contentType: image.type, upsert: false });
          if (response.error) throw response.error;
          uploaded.push(path);
          assets[item.path] = assetId;
        }
        const result = await account.client.from('noor_public_pages').upsert({
          vault_id: vaultId, note_id: note.id, slug, title: note.title, source_path: note.path,
          aliases: note.aliases, markdown: publicSnapshotMarkdown(note.markdown), assets, description: description.trim(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'vault_id,note_id' });
        if (result.error) throw result.error;
      } catch (error) {
        if (uploaded.length) await account.client.storage.from(bucket).remove(uploaded);
        throw error;
      }
      await refresh(); setApproved(false);
      if (previous) {
        const oldPaths = Object.values(previous.assets).map((id) => `${vaultId}/${note.id}/${id}`);
        if (oldPaths.length) void account.client.storage.from(bucket).remove(oldPaths);
      }
      setMessage('Page published. Private linked notes and unselected attachments remain private.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not publish this page.'); }
    finally { setBusy(false); }
  };

  const unpublish = async (page: PublicPage) => {
    if (!available || !account.client || !vaultId) return;
    setBusy(true); setMessage('');
    try {
      const result = await account.client.from('noor_public_pages').delete().eq('vault_id', vaultId).eq('note_id', page.note_id);
      if (result.error) throw result.error;
      await refresh();
      const oldPaths = Object.values(page.assets).map((id) => `${vaultId}/${page.note_id}/${id}`);
      if (oldPaths.length) void account.client.storage.from(bucket).remove(oldPaths);
      setMessage(`Unpublished ${page.title}. Existing downloaded copies may remain outside Noor Note.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not unpublish this page.'); }
    finally { setBusy(false); }
  };

  return <section className={styles.card} aria-labelledby="publishing-heading">
    <h2 id="publishing-heading">Public publishing</h2>
    <p>Choose each page explicitly. Public snapshots are separate from the private vault; links to private notes stay unavailable.</p>
    {!available ? <p role="status">Publishing requires a signed-in account, enabled plaintext cloud sync, and Owner or Admin access. Local-only and encrypted vaults stay private.</p> : draft && <>
      <div className={styles.grid}>
        <label>Site URL slug<input value={draft.slug} maxLength={80} onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase() })} /></label>
        <label>Site title<input value={draft.title} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className={styles.wide}>Description<textarea value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>Theme<select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as PublicSite['theme'] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Search engines<select value={draft.robots} onChange={(event) => setDraft({ ...draft, robots: event.target.value as PublicSite['robots'] })}><option value="noindex">Do not index</option><option value="index">Allow indexing</option></select></label>
        <label>Homepage<select value={draft.homepage_slug ?? ''} onChange={(event) => setDraft({ ...draft, homepage_slug: event.target.value || null })}><option value="">Page list</option>{pages.map((page) => <option key={page.note_id} value={page.slug}>{page.title}</option>)}</select></label>
        <label>Navigation page slugs<input value={draft.navigation.join(', ')} onChange={(event) => setDraft({ ...draft, navigation: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="intro, guide" /></label>
        <label>Logo image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={(event) => setLogo(event.target.files?.[0] ?? null)} /></label>
        <label>Favicon image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={(event) => setFavicon(event.target.files?.[0] ?? null)} /></label>
      </div>
      <label className={styles.check}><input type="checkbox" checked={draft.graph_enabled} onChange={(event) => setDraft({ ...draft, graph_enabled: event.target.checked })} /> Show a graph of published pages only</label>
      <div className={styles.actions}><Button variant="secondary" disabled={busy} onClick={() => { void saveSite(); }}>{site ? 'Save site settings' : 'Create public site'}</Button>{site && <a href={`/p/${site.slug}`} target="_blank" rel="noopener noreferrer">Open public site</a>}</div>
      {site && <div className={styles.publish}>
        <h3>Publish a note</h3>
        <label>Note<select value={noteId} onChange={(event) => setNoteId(event.target.value)}><option value="">Choose a note</option>{workspace.notes.filter((note) => !note.deletedAt).map((note) => <option value={note.id} key={note.id}>{note.path}</option>)}</select></label>
        {noteId && <><label>Page URL slug<input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} /></label><label>Page description<input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} /></label>
          <label className={styles.check}><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I approve publishing this note’s body and its referenced local images. Frontmatter and internal link IDs are removed from the public copy. Linked notes stay private unless published separately.</label>
          <Button variant="primary" disabled={busy || !approved} onClick={() => { void publish(); }}>{pages.some((page) => page.note_id === noteId) ? 'Update public page' : 'Publish note'}</Button></>}
        <h3>Published pages</h3>
        {pages.length === 0 && <p>No pages published.</p>}
        {pages.map((page) => <div className={styles.pageRow} key={page.note_id}><a href={`/p/${site.slug}/${page.slug}`} target="_blank" rel="noopener noreferrer">{page.title}</a><span>/{page.slug}</span><Button variant="secondary" disabled={busy} onClick={() => { void unpublish(page); }}>Unpublish</Button></div>)}
      </div>}
    </>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>;
}
