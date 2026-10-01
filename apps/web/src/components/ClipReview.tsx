'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Bookmark, Check, FilePlus2, FolderOpen, Link2, Tag } from 'lucide-react';
import { isTemplateNote, renderWebClipTemplate, webClipSchema, type Vault } from '@noor-note/core';
import { DexieVaultRepository, type VaultTree } from '@noor-note/storage';
import { ClipInbox, type PendingWebClip } from '../lib/clip-inbox';
import { saveWebClip } from '../lib/clipper-import';
import styles from './ClipReview.module.css';

function parseProperties(input: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of input.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error('Enter properties as one key: value per line.');
    const key = line.slice(0, colon).trim(), value = line.slice(colon + 1).trim();
    if (!key || !value) throw new Error('Each property needs a key and value.');
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate property: ${key}`);
    result[key] = value;
  }
  return result;
}

export function ClipReview() {
  const inbox = useMemo(() => new ClipInbox(), []);
  const [repository, setRepository] = useState<DexieVaultRepository | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [vaultId, setVaultId] = useState('');
  const [tree, setTree] = useState<VaultTree | null>(null);
  const [draft, setDraft] = useState<PendingWebClip | null>(null);
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState<'new' | 'append'>('new');
  const [folderId, setFolderId] = useState('');
  const [noteId, setNoteId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
  const [tags, setTags] = useState('');
  const [properties, setProperties] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const repo = new DexieVaultRepository();
    void (async () => {
      try {
        const vault = await repo.initialize();
        const all = await repo.listVaults();
        if (!active) return;
        setRepository(repo); setVaults(all); setVaultId(vault.id);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Could not open local vaults.'); }
    })();
    return () => { active = false; repo.close(); };
  }, []);
  useEffect(() => {
    if (!repository || !vaultId) return;
    let active = true;
    void repository.listTree(vaultId).then((next) => { if (active) { setTree(next); setFolderId(''); setNoteId(''); setTemplateId(''); setTemplatePreview(null); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load destination.'); });
    return () => { active = false; };
  }, [repository, vaultId]);
  useEffect(() => {
    let active = true;
    const rawTicket = new URLSearchParams(window.location.search).get('ticket');
    const ticket = rawTicket && /^[0-9a-f-]{36}$/iu.test(rawTicket) ? rawTicket : null;
    if (rawTicket && !ticket) queueMicrotask(() => { if (active) setError('Invalid clip link. Capture the page again.'); });
    const receive = (event: MessageEvent<unknown>) => {
      if ((event.source !== window && event.source !== null) || event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.type === 'noor-note-clip-extension-ready' && data.ticket === ticket && ticket) {
        window.postMessage({ type: 'noor-note-clip-ready', ticket }, window.location.origin);
        return;
      }
      if (data.type !== 'noor-note-clip' || data.ticket !== ticket || !ticket) return;
      const parsed = webClipSchema.safeParse(data.clip);
      if (!parsed.success) { setError('This clip could not be validated. Capture it again.'); return; }
      void inbox.receive(ticket, parsed.data).then((item) => {
        if (active) { setDraft(item); setTitle(item.clip.title); setError(null); }
        window.postMessage({ type: 'noor-note-clip-accepted', ticket }, window.location.origin);
      }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not save the clip draft locally.'); });
    };
    window.addEventListener('message', receive);
    void (ticket ? inbox.get(ticket) : inbox.latest()).then((item) => { if (active && item) { setDraft(item); setTitle(item.clip.title); } });
    if (ticket) window.postMessage({ type: 'noor-note-clip-ready', ticket }, window.location.origin);
    return () => { active = false; window.removeEventListener('message', receive); };
  }, [inbox]);
  useEffect(() => () => inbox.close(), [inbox]);

  const templates = tree ? tree.notes.filter((note) => isTemplateNote(note, tree.folders, tree.vault.settings.templates.folderId)) : [];
  const notes = tree?.notes.filter((note) => !isTemplateNote(note, tree.folders, tree.vault.settings.templates.folderId)) ?? [];
  const previewTemplate = async () => {
    if (!repository || !draft || !templateId || !tree) return;
    try {
      const template = await repository.getNote(templateId);
      if (!template || template.vaultId !== vaultId || !templates.some((item) => item.id === templateId)) throw new Error('Choose an available template.');
      const target = destination === 'append' ? notes.find((note) => note.id === noteId) : null;
      const folder = tree.folders.find((item) => item.id === folderId);
      const path = target?.path ?? `${folder?.path ?? ''}/${title.trim() || draft.clip.title}.md`;
      setTemplatePreview(renderWebClipTemplate(template.markdown, draft.clip, {
        title: title.trim() || draft.clip.title, path,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), properties: parseProperties(properties),
      }));
      setError(null);
    } catch (cause) { setTemplatePreview(null); setError(cause instanceof Error ? cause.message : 'Could not preview the template.'); }
  };
  const save = async () => {
    if (!repository || !draft || !vaultId || busy) return;
    setBusy(true); setError(null);
    try {
      const template = templateId ? await repository.getNote(templateId) : null;
      if (templateId && (!template || template.vaultId !== vaultId || !templates.some((item) => item.id === templateId))) throw new Error('Choose an available template.');
      const saved = await saveWebClip(repository, draft.clip, {
        vaultId, folderId: destination === 'new' ? folderId || null : null,
        noteId: destination === 'append' ? noteId || null : null, title,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), properties: parseProperties(properties),
        templateMarkdown: template?.markdown ?? null,
      });
      await inbox.remove(draft.ticket);
      window.postMessage({ type: 'noor-note-clip-accepted', ticket: draft.ticket }, window.location.origin);
      setSavedTitle(saved.title || 'Untitled note');
      window.history.replaceState(null, '', '/clipper/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this clip.'); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    if (!draft) return;
    try { await inbox.remove(draft.ticket); window.postMessage({ type: 'noor-note-clip-accepted', ticket: draft.ticket }, window.location.origin); setDraft(null); window.history.replaceState(null, '', '/clipper/'); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not discard the clip.'); }
  };

  return <main className={styles.page}>
    <header className={styles.topbar}><a href="/" className={styles.brand}><span className={styles.brandMark}>✦</span><span>Noor Note</span></a><span className={styles.topbarLabel}>Web clipper</span></header>
    <div className={styles.content}>
      <div className={styles.heading}><a href="/" className={styles.back}><ArrowLeft size={16} /> Workspace</a><span className={styles.eyebrow}>CAPTURE INBOX</span><h1>Keep what matters.</h1><p>Review the clip, choose where it belongs, then save it to your local vault.</p></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {savedTitle ? <section className={styles.complete}><Check size={28} /><h2>Saved to Noor Note</h2><p>{savedTitle} is available in your local vault.</p><a href="/">Open workspace</a></section> : !draft ? <section className={styles.waiting}><Bookmark size={28} /><h2>Waiting for a clip</h2><p>Use the Noor Note browser extension on a webpage. If you already captured one, keep this tab open while the extension sends it.</p></section> :
      <div className={styles.grid}>
        <section className={styles.card} aria-label="Clip preview"><div className={styles.cardHeader}><span className={styles.eyebrow}>SOURCE PREVIEW</span><span className={styles.mode}>{draft.clip.mode}</span></div><h2>{draft.clip.title}</h2><a href={draft.clip.url} target="_blank" rel="noopener noreferrer" className={styles.source}><Link2 size={15} />{draft.clip.url}</a><div className={styles.meta}>{[draft.clip.author, draft.clip.site, draft.clip.publishedAt, draft.clip.language].filter(Boolean).join(' · ')}</div>{draft.clip.description && <p>{draft.clip.description}</p>}{draft.clip.screenshotDataUrl && <div className={styles.screenshot}><Image src={draft.clip.screenshotDataUrl} alt="Captured visible page" unoptimized fill sizes="(max-width: 760px) 100vw, 55vw" style={{ objectFit: 'contain' }} /></div>}{draft.clip.highlights.length > 0 && <div className={styles.highlights}>{draft.clip.highlights.map((item, index) => <blockquote key={item.id}><strong>Highlight {index + 1}</strong><p>{item.text}</p></blockquote>)}</div>}{draft.clip.markdown && <pre className={styles.markdown}>{draft.clip.markdown}</pre>}<button type="button" className={styles.discard} onClick={() => { void discard(); }}>Discard clip</button></section>
        <section className={styles.card} aria-label="Clip destination"><div className={styles.cardHeader}><span className={styles.eyebrow}>SAVE TO NOOR NOTE</span><FolderOpen size={17} /></div><div className={styles.fields}><label>Vault<select value={vaultId} onChange={(event) => setVaultId(event.target.value)}>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}</select></label><fieldset className={styles.destination}><legend>Destination</legend><label><input type="radio" checked={destination === 'new'} onChange={() => setDestination('new')} /> New note</label><label><input type="radio" checked={destination === 'append'} onChange={() => setDestination('append')} /> Append to note</label></fieldset>{destination === 'new' ? <><label>Note title<input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label><label>Folder<select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">Vault root</option>{tree?.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label></> : <label>Note<select value={noteId} onChange={(event) => setNoteId(event.target.value)}><option value="">Choose a note</option>{notes.map((note) => <option key={note.id} value={note.id}>{note.path}</option>)}</select></label>}<label>Template<select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setTemplatePreview(null); }}><option value="">No template</option>{templates.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label>{templateId && <><button type="button" className={styles.previewButton} onClick={() => { void previewTemplate(); }}>Preview template</button><small>Use title, url, author, content, selection, highlights, published, domain, description, date, and time in double braces.</small>{templatePreview !== null && <div className={styles.templatePreview}><strong>Rendered Markdown preview</strong><pre className={styles.markdown}>{templatePreview}</pre><small>Preview again after changing the destination or properties. Screenshot links are added when saved.</small></div>}</>}<label><span><Tag size={14} /> Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="research, reading/ideas" /></label><label>Properties <small>one key: value per line</small><textarea value={properties} onChange={(event) => setProperties(event.target.value)} placeholder={'status: To read\nproject: Noor Note'} rows={4} /></label><button type="button" className={styles.save} disabled={busy || !repository || (destination === 'append' && !noteId)} onClick={() => { void save(); }}>{busy ? 'Saving clip…' : destination === 'new' ? <><FilePlus2 size={17} /> Save as new note</> : 'Append to note'}</button><p className={styles.local}>Saved locally first. Cloud sync follows your vault settings.</p></div></section>
      </div>}
    </div>
  </main>;
}
