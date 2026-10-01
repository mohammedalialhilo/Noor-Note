'use client';

import { applyMetadataDefaults, applyTemplateProperties, calendarEventInputSchema, calendarEventMarkdown, configuredTemplateId, ensureTaskIdsInMarkdown, formatPeriodDate, isTemplateNote, markPeriodMarkdown, matchesPeriod, matchingMetadataSchemas, metadataSchemaSchema, moveCalendarProperty, parseImportedNotes, parsePortableMarkdown, parseTaskRecords, periodKey, periodStart, planLinkRename, planTagRewrite, renderTemplate, templateContextForNote, updateFrontmatterProperty, updateTaskMarkdown, validatePeriodRule, type CalendarEventInput, type MetadataSchema, type PeriodKind, type PropertyType, type PropertyValue, type RenameChange, type TagChange, type TaskPatch, type TaskSelector, type Vault, type VaultNote } from '@noor-note/core';
import { DexieVaultRepository, toNoteEntry, type VaultRepository, type VaultStatistics, type VaultTree } from '@noor-note/storage';
import { hybridResults, type SearchMode, type SearchResult, type SearchSort } from '@noor-note/search';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, getUserErrorMessage, logError, type ErrorAction } from '../lib/logger';
import { SearchClient } from '../lib/search-client';
import { SemanticSearchClient } from '../lib/semantic-client';
import { exportVaultZip, importVaultZip } from '../lib/vault-archive';

type SaveStatus = 'saved' | 'saving' | 'error';
type NotePatch = Partial<Pick<VaultNote, 'title' | 'markdown'>>;
export interface NewNoteOptions { title?: string; templateId?: string | null; skipTemplate?: boolean; daily?: boolean; baseId?: string; selection?: string; clipboard?: string; now?: Date; period?: { kind: PeriodKind; date: Date } }
const DRAFT_PREFIX = 'noor-note-draft:';

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function readDraft(note: VaultNote): NotePatch | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${note.id}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('updatedAt' in parsed) || !('markdown' in parsed) || !('title' in parsed) || !('vaultId' in parsed)) return null;
    const draft = parsed as Record<string, unknown>;
    if (draft.vaultId !== note.vaultId || typeof draft.updatedAt !== 'number' || draft.updatedAt <= Date.parse(note.updatedAt) || typeof draft.markdown !== 'string' || typeof draft.title !== 'string') return null;
    if (draft.markdown === note.markdown && draft.title === note.title) return null;
    return { title: draft.title, markdown: draft.markdown };
  } catch { return null; }
}

function writeDraft(note: VaultNote): void {
  if (note.markdown.length > 1_000_000) return;
  try { localStorage.setItem(`${DRAFT_PREFIX}${note.id}`, JSON.stringify({ vaultId: note.vaultId, title: note.title, markdown: note.markdown, updatedAt: Math.max(Date.now(), Date.parse(note.updatedAt) + 1) })); }
  catch { /* Autosave continues through IndexedDB when localStorage is unavailable. */ }
}

export function useVaultWorkspace() {
  const repositoryRef = useRef<VaultRepository | null>(null);
  const searchClientRef = useRef<SearchClient | null>(null);
  const semanticClientRef = useRef<SemanticSearchClient | null>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ id: string; patch: NotePatch } | null>(null);
  const dirtyRef = useRef(false);
  const selectedRef = useRef<VaultNote | null>(null);
  const treeRef = useRef<VaultTree | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [deletedVaults, setDeletedVaults] = useState<Vault[]>([]);
  const [activeVault, setActiveVault] = useState<Vault | null>(null);
  const [tree, setTree] = useState<VaultTree | null>(null);
  const [selectedNote, setSelectedNote] = useState<VaultNote | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [quotaWarning, setQuotaWarning] = useState(false);

  const failure = useCallback((action: ErrorAction, caught: unknown) => {
    logError(`workspace.${action}`, caught);
    setError(getUserErrorMessage(caught, action));
  }, []);

  const updateSelected = useCallback((note: VaultNote | null) => {
    selectedRef.current = note;
    setSelectedNote(note);
  }, []);

  const updateEntry = useCallback((note: VaultNote) => {
    const entry = toNoteEntry(note);
    const current = treeRef.current;
    if (!current || current.vault.id !== note.vaultId) return;
    const next = { ...current, notes: [...current.notes.filter((item) => item.id !== note.id), entry] };
    treeRef.current = next;
    setTree(next);
  }, []);

  const refresh = useCallback(async (vaultId: string) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    const [allVaults, deleted, nextTree] = await Promise.all([repository.listVaults(), repository.listDeletedVaults(), repository.listTree(vaultId)]);
    setVaults(allVaults);
    setDeletedVaults(deleted);
    setActiveVault(nextTree.vault);
    treeRef.current = nextTree;
    setTree(nextTree);
  }, []);

  const loadSelected = useCallback(async (id: string | null) => {
    const repository = repositoryRef.current;
    if (!repository || !id) { updateSelected(null); return; }
    const note = await repository.getNote(id);
    if (!note || note.deletedAt) { updateSelected(null); return; }
    const draft = readDraft(note);
    if (draft) {
      const recovered = { ...note, ...draft };
      updateSelected(recovered);
      dirtyRef.current = true;
      setRecoveredDraft(true);
      pendingRef.current = { id, patch: draft };
      setSaveStatus('saving');
    } else { updateSelected(note); setSaveStatus('saved'); }
  }, [updateSelected]);

  const scheduleSave = useCallback((id: string, patch: NotePatch) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    writeChainRef.current = writeChainRef.current.catch(() => undefined).then(async () => {
      try {
        const saved = await repository.saveNote(id, patch);
        updateEntry(saved);
        if (selectedRef.current?.id === id && pendingRef.current?.id === id) writeDraft({ ...selectedRef.current, updatedAt: saved.updatedAt });
        if (selectedRef.current?.id === id && !pendingRef.current && selectedRef.current.title === saved.title && selectedRef.current.markdown === saved.markdown) {
          updateSelected(saved);
          setSaveStatus('saved');
          dirtyRef.current = false;
          try { localStorage.removeItem(`${DRAFT_PREFIX}${id}`); } catch { /* Recovery draft is best effort. */ }
        }
        if (navigator.storage?.estimate) {
          try {
            const estimate = await navigator.storage.estimate();
            if (estimate.quota && estimate.usage && estimate.usage / estimate.quota >= 0.9) setQuotaWarning(true);
          } catch { /* Storage estimates are advisory. */ }
        }
      } catch (caught) {
        pendingRef.current = pendingRef.current?.id === id
          ? { id, patch: { ...patch, ...pendingRef.current.patch } }
          : { id, patch };
        dirtyRef.current = true;
        setSaveStatus('error');
        failure('save', caught);
        throw caught;
      }
    });
  }, [failure, updateEntry, updateSelected]);

  const flushPending = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) scheduleSave(pending.id, pending.patch);
    await writeChainRef.current;
  }, [scheduleSave]);

  useEffect(() => {
    let live = true;
    const repository = new DexieVaultRepository();
    repositoryRef.current = repository;
    void repository.initialize().then(async (vault) => {
      if (!live) return;
      await refresh(vault.id);
      const first = (await repository.listTree(vault.id)).notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      await loadSelected(first?.id ?? null);
      setReady(true);
    }).catch((caught: unknown) => { if (live) { failure('open', caught); setReady(true); } });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault(); event.returnValue = '';
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flushPending().catch(() => undefined); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      void flushPending().catch(() => undefined).finally(() => repository.close());
      searchClientRef.current?.close();
      searchClientRef.current = null;
      semanticClientRef.current?.close();
      semanticClientRef.current = null;
      repositoryRef.current = null;
    };
  }, [failure, flushPending, loadSelected, refresh]);

  useEffect(() => {
    if (!recoveredDraft || !pendingRef.current) return;
    timerRef.current = setTimeout(() => { void flushPending().catch(() => undefined); }, 650);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [recoveredDraft, flushPending]);

  const patchNote = useCallback((id: string, patch: NotePatch) => {
    const current = selectedRef.current;
    if (!current || current.id !== id) return;
    const next = { ...current, ...patch };
    updateSelected(next);
    writeDraft(next);
    dirtyRef.current = true;
    pendingRef.current = { id, patch: { ...pendingRef.current?.patch, ...patch } };
    setSaveStatus('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flushPending().catch(() => undefined); }, 650);
  }, [flushPending, updateSelected]);

  const selectNote = useCallback(async (id: string): Promise<boolean> => {
    try { await flushPending(); await loadSelected(id); setSelectedFolderId(selectedRef.current?.folderId ?? null); return true; }
    catch (caught) { failure('save', caught); return false; }
  }, [failure, flushPending, loadSelected]);

  const switchVault = useCallback(async (id: string) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try {
      await flushPending();
      await repository.setActiveVault(id);
      setSelectedFolderId(null);
      await refresh(id);
      const nextTree = await repository.listTree(id);
      await loadSelected(nextTree.notes[0]?.id ?? null);
    } catch (caught) { failure('open', caught); }
  }, [failure, flushPending, loadSelected, refresh]);

  const createVault = useCallback(async (name: string) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try { await flushPending(); const vault = await repository.createVault(name); await refresh(vault.id); updateSelected(null); setSelectedFolderId(null); return vault; }
    catch (caught) { failure('create', caught); }
  }, [failure, flushPending, refresh, updateSelected]);

  const deleteVault = useCallback(async (id: string) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try {
      await flushPending();
      await repository.deleteVault(id);
      const next = await repository.getActiveVault();
      await refresh(next.id);
      await loadSelected((await repository.listTree(next.id)).notes[0]?.id ?? null);
      setSelectedFolderId(null);
    } catch (caught) { failure('delete', caught); }
  }, [failure, flushPending, loadSelected, refresh]);

  const restoreVault = useCallback(async (id: string) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try {
      await flushPending();
      await repository.restoreVault(id);
      await repository.setActiveVault(id);
      await refresh(id);
      await loadSelected((await repository.listTree(id)).notes[0]?.id ?? null);
      setSelectedFolderId(null);
    } catch (caught) { failure('open', caught); }
  }, [failure, flushPending, loadSelected, refresh]);

  const addNote = useCallback(async (folderId: string | null = selectedFolderId, options: NewNoteOptions = {}) => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const currentTree = await repository.listTree(activeVault.id);
      const settings = activeVault.settings.templates;
      const sourceId = options.skipTemplate || folderId && isTemplateNote({ id: '', folderId }, currentTree.folders, settings.folderId) ? null
        : options.templateId !== undefined ? options.templateId : configuredTemplateId(settings, folderId, currentTree.folders, { daily: options.daily, baseId: options.baseId });
      const sourceEntry = sourceId ? currentTree.notes.find((entry) => entry.id === sourceId && isTemplateNote(entry, currentTree.folders, settings.folderId)) : null;
      if (sourceId && !sourceEntry) throw new Error('The configured template is unavailable. Check template settings.');
      const source = sourceEntry ? await repository.getNote(sourceEntry.id) : null;
      if (sourceEntry && !source) throw new Error('The template note is unavailable.');
      const title = options.title?.trim() || 'Untitled';
      const note = await repository.createNote(activeVault.id, folderId, title, source || options.period ? (path) => {
        const rendered = source ? renderTemplate(source.markdown, {
          title, filename: path.split('/').at(-1) ?? '', folder: path.slice(0, path.lastIndexOf('/')) || '/',
          selection: options.selection, clipboard: options.clipboard, now: options.now, properties: {},
        }) : '';
        return options.period ? markPeriodMarkdown(rendered, options.period.kind, options.period.date) : rendered;
      } : '');
      await refresh(activeVault.id);
      updateSelected(note);
      return note;
    } catch (caught) { failure('create', caught); }
  }, [activeVault, failure, flushPending, refresh, selectedFolderId, updateSelected]);

  const openPeriodNote = useCallback(async (kind: PeriodKind, date: Date, create = false): Promise<VaultNote | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const rule = validatePeriodRule(kind, activeVault.settings.periodNotes[kind]);
      const start = periodStart(kind, date);
      const tree = await repository.listTree(activeVault.id);
      const marked = tree.notes.find((note) => matchesPeriod(note.properties, kind, start));
      if (marked) return await repository.getNote(marked.id);
      if (rule.folderId && !tree.folders.some((folder) => folder.id === rule.folderId)) throw new Error('The period note folder is unavailable. Check Settings.');
      const title = formatPeriodDate(kind, start, rule.filenameFormat);
      if (kind === 'daily') {
        const legacy = tree.notes.find((note) => note.folderId === rule.folderId && note.title === periodKey(kind, start) && !note.properties.noor_period_kind);
        if (legacy) return await repository.getNote(legacy.id);
      }
      if (!create) return undefined;
      const templateId = rule.templateId ?? (kind === 'daily' ? activeVault.settings.templates.dailyTemplateId : null);
      return await addNote(rule.folderId, { title, templateId: templateId ?? undefined, daily: kind === 'daily', now: start, period: { kind, date: start } });
    } catch (caught) { failure('create', caught); }
  }, [activeVault, addNote, failure, flushPending]);

  const createDailyNote = useCallback(() => openPeriodNote('daily', new Date(), true), [openPeriodNote]);

  const renderNoteTemplate = useCallback(async (templateId: string, note: VaultNote, selection = '', clipboard = ''): Promise<string> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) throw new Error('No active vault');
    const currentTree = await repository.listTree(activeVault.id);
    const entry = currentTree.notes.find((item) => item.id === templateId && isTemplateNote(item, currentTree.folders, activeVault.settings.templates.folderId));
    if (!entry) throw new Error('Choose a note from the template folder');
    const source = await repository.getNote(templateId);
    if (!source) throw new Error('Template note is unavailable');
    return renderTemplate(source.markdown, templateContextForNote(note, { selection, clipboard }));
  }, [activeVault]);

  const applyPropertiesFromTemplate = useCallback(async (noteId: string, templateId: string, selection = '', clipboard = ''): Promise<VaultNote | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const note = await repository.getNote(noteId);
      if (!note || note.deletedAt) throw new Error('Note is unavailable');
      const rendered = await renderNoteTemplate(templateId, note, selection, clipboard);
      const markdown = applyTemplateProperties(note.markdown, rendered);
      if (markdown === note.markdown) return note;
      const saved = await repository.saveNote(noteId, { markdown }, true);
      updateEntry(saved);
      if (selectedRef.current?.id === noteId) updateSelected(saved);
      return saved;
    } catch (caught) { failure('save', caught); }
  }, [activeVault, failure, flushPending, renderNoteTemplate, updateEntry, updateSelected]);

  const removeNote = useCallback(async (id: string) => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      await repository.deleteNote(id);
      await refresh(activeVault.id);
      const next = (await repository.listTree(activeVault.id)).notes.find((item) => item.id !== id);
      await loadSelected(next?.id ?? null);
    } catch (caught) { failure('delete', caught); }
  }, [activeVault, failure, flushPending, loadSelected, refresh]);

  const importFiles = useCallback(async (files: FileList | File[], destinationId: string | null = selectedFolderId) => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return 0;
    let imported = 0;
    let targetVaultId = activeVault.id;
    try {
      await flushPending();
      const folderIds = new Map<string, string>();
      const ensureFolder = async (relative: string): Promise<string | null> => {
        const parts = relative.split('/').filter(Boolean);
        let parentId = destinationId;
        let path = '';
        for (const part of parts) {
          path += `/${part}`;
          const cached = folderIds.get(path);
          if (cached) { parentId = cached; continue; }
          const existing = (await repository.listTree(activeVault.id)).folders.find((folder) => folder.parentId === parentId && folder.name.toLocaleLowerCase() === part.toLocaleLowerCase());
          const folder = existing ?? await repository.createFolder(activeVault.id, parentId, part);
          folderIds.set(path, folder.id);
          parentId = folder.id;
        }
        return parentId;
      };
      for (const file of Array.from(files)) {
        const lower = file.name.toLocaleLowerCase();
        if (lower.endsWith('.zip')) { targetVaultId = await importVaultZip(repository, file); imported += 1; continue; }
        const relative = (file as File & { noorRelativePath?: string }).noorRelativePath || file.webkitRelativePath || file.name;
        const parts = relative.replaceAll('\\', '/').split('/');
        if (parts.some((part) => part === '.' || part === '..')) throw new AppError('invalid_import');
        const folderId = await ensureFolder(parts.slice(0, -1).join('/'));
        if (lower.endsWith('.md')) {
          const markdown = await file.text();
          const parsed = parsePortableMarkdown(markdown, file.name.replace(/\.md$/iu, ''));
          await repository.createNote(activeVault.id, folderId, parsed.title, markdown);
          imported += 1;
        } else if (lower.endsWith('.json')) {
          const input: unknown = JSON.parse(await file.text());
          for (const legacy of parseImportedNotes(input)) { await repository.createNote(activeVault.id, folderId, legacy.title, legacy.content); imported += 1; }
        } else { await repository.addAttachment(activeVault.id, folderId, file, file.name); imported += 1; }
      }
      await refresh(targetVaultId);
      if (targetVaultId !== activeVault.id) await repository.setActiveVault(targetVaultId);
      const first = (await repository.listTree(targetVaultId)).notes[0];
      if (first) await loadSelected(first.id);
      return imported;
    } catch (caught) {
      failure('import', caught);
      try {
        if (imported > 0) await repository.setActiveVault(targetVaultId);
        await refresh(imported > 0 ? targetVaultId : activeVault.id);
        if (imported > 0) {
          const first = (await repository.listTree(targetVaultId)).notes[0];
          if (first) await loadSelected(first.id);
        }
      } catch (refreshError) { logError('workspace.import', refreshError); }
      if (imported > 0) {
        setError(`${imported} ${imported === 1 ? 'item was' : 'items were'} imported before a later file failed. Check the vault and retry the remaining files.`);
      }
      return imported;
    }
  }, [activeVault, failure, flushPending, loadSelected, refresh, selectedFolderId]);

  const updateTask = useCallback(async (noteId: string, selector: TaskSelector, patch: TaskPatch) => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const note = await repository.getNote(noteId);
      if (!note || note.deletedAt || note.vaultId !== activeVault.id) throw new Error('Task note is unavailable');
      const { markdown } = updateTaskMarkdown(note.markdown, selector, patch);
      const saved = await repository.saveNote(noteId, { markdown }, true);
      updateEntry(saved);
      if (selectedRef.current?.id === noteId) updateSelected(saved);
      return saved;
    } catch (caught) { failure('save', caught); return undefined; }
  }, [activeVault, failure, flushPending, updateEntry, updateSelected]);

  const createCalendarEvent = useCallback(async (input: CalendarEventInput, folderId: string | null = null): Promise<VaultNote | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const parsed = calendarEventInputSchema.parse(input);
      const note = await repository.createNote(activeVault.id, folderId, parsed.title, calendarEventMarkdown(parsed));
      await refresh(activeVault.id);
      return note;
    } catch (caught) { failure('create', caught); }
  }, [activeVault, failure, flushPending, refresh]);

  const moveCalendarDate = useCallback(async (noteId: string, field: string, from: string, to: string): Promise<VaultNote | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const current = await repository.getNote(noteId);
      if (!current || current.vaultId !== activeVault.id || current.deletedAt) throw new Error('Calendar note is unavailable');
      const markdown = moveCalendarProperty(current.markdown, field, from, to);
      if (markdown === current.markdown) return current;
      const saved = await repository.saveNote(noteId, { markdown }, true);
      updateEntry(saved);
      if (selectedRef.current?.id === noteId) updateSelected(saved);
      return saved;
    } catch (caught) { failure('save', caught); }
  }, [activeVault, failure, flushPending, updateEntry, updateSelected]);

  const toggleTask = useCallback(async (noteId: string, line: number) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    await flushPending();
    const note = await repository.getNote(noteId);
    const task = note && parseTaskRecords(note.markdown).find((item) => item.line === line);
    if (!task) return;
    await updateTask(noteId, { id: task.id, line, expectedText: task.text }, { completed: !task.completed });
  }, [flushPending, updateTask]);

  const assignTaskIds = useCallback(async (): Promise<number | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    let assigned = 0;
    try {
      await flushPending();
      const known = new Set<string>();
      const entries = (await repository.listTree(activeVault.id)).notes.filter((entry) => entry.tasks.length > 0);
      for (const entry of entries) {
        const note = await repository.getNote(entry.id);
        if (!note) continue;
        const result = ensureTaskIdsInMarkdown(note.markdown, known);
        if (!result.assigned) continue;
        const saved = await repository.saveNote(note.id, { markdown: result.markdown }, true);
        assigned += result.assigned;
        updateEntry(saved);
        if (selectedRef.current?.id === note.id) updateSelected(saved);
      }
      await refresh(activeVault.id);
      return assigned;
    } catch (caught) { failure('save', caught); if (assigned) await refresh(activeVault.id); }
  }, [activeVault, failure, flushPending, refresh, updateEntry, updateSelected]);

  const exportZip = useCallback(async (folderPath?: string) => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const zip = await exportVaultZip(repository, activeVault.id, folderPath);
      downloadBlob(`${(folderPath?.split('/').at(-1) || activeVault.name).replace(/[^\p{L}\p{N}._-]+/gu, '-')}.zip`, zip);
    } catch (caught) { failure('save', caught); }
  }, [activeVault, failure, flushPending]);

  const invoke = useCallback(async <T,>(operation: (repository: VaultRepository) => Promise<T>): Promise<T | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try { await flushPending(); const result = await operation(repository); searchClientRef.current?.invalidateOcr(); await refresh(activeVault.id); if (selectedRef.current) await loadSelected(selectedRef.current.id); return result; }
    catch (caught) { failure('save', caught); }
  }, [activeVault, failure, flushPending, loadSelected, refresh]);

  const searchNotes = useCallback(async (query: string, sort: SearchSort = 'relevance', limit = 500, mode: SearchMode = 'lexical', onProgress?: (message: string) => void): Promise<SearchResult[]> => {
    const repository = repositoryRef.current;
    if (!activeVault || !repository || !query.trim()) return [];
    await flushPending();
    if (mode === 'lexical') {
      searchClientRef.current ??= new SearchClient();
      return searchClientRef.current.search(repository, activeVault.id, `${query} sort:${sort}`, limit, treeRef.current);
    }
    semanticClientRef.current ??= new SemanticSearchClient();
    const semantic = semanticClientRef.current.search(repository, activeVault.id, query, limit, onProgress);
    if (mode === 'semantic') return semantic;
    searchClientRef.current ??= new SearchClient();
    const lexical = searchClientRef.current.search(repository, activeVault.id, `${query} sort:${sort}`, limit, treeRef.current);
    const [lexicalResults, semanticResults] = await Promise.all([lexical, semantic]);
    return hybridResults(lexicalResults, semanticResults, limit);
  }, [activeVault, flushPending]);
  const refreshActive = useCallback(async () => { if (activeVault) { searchClientRef.current?.invalidateOcr(); await refresh(activeVault.id); } }, [activeVault, refresh]);
  const invalidateOcrSearch = useCallback(() => { searchClientRef.current?.invalidateOcr(); }, []);
  const invalidateDerivedSearch = useCallback(() => { searchClientRef.current?.invalidateDerived(); }, []);

  const previewNoteRename = useCallback(async (id: string, title: string): Promise<{ expectedRevision: number; expectedRevisions: { id: string; revision: number }[]; changes: RenameChange[] } | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const entries = (await repository.listTree(activeVault.id)).notes;
      const bodies = (await Promise.all(entries.map((entry) => repository.getNote(entry.id)))).filter((note): note is VaultNote => Boolean(note));
      const target = bodies.find((note) => note.id === id);
      if (!target) throw new Error('Note not found');
      return { expectedRevision: target.revision, expectedRevisions: bodies.map((note) => ({ id: note.id, revision: note.revision })), changes: planLinkRename(bodies, target, title.trim()) };
    } catch (caught) { failure('save', caught); }
  }, [activeVault, failure, flushPending]);

  const createLinkedNote = useCallback(async (target: string, sourceFolderId: string | null): Promise<VaultNote | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const parts = target.split('/').map((part) => part.trim());
      if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('Invalid note path');
      let folderId = target.includes('/') ? null : sourceFolderId;
      for (const part of parts.slice(0, -1)) {
        const existing = (await repository.listTree(activeVault.id)).folders.find((folder) => folder.parentId === folderId && folder.name.toLocaleLowerCase() === part.toLocaleLowerCase());
        folderId = (existing ?? await repository.createFolder(activeVault.id, folderId, part)).id;
      }
      return await addNote(folderId, { title: parts.at(-1)! });
    } catch (caught) { failure('create', caught); }
  }, [activeVault, addNote, failure, flushPending]);

  const updateProperty = useCallback(async (id: string, name: string, value: PropertyValue | undefined, type?: PropertyType, options?: string[]): Promise<VaultNote | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const current = await repository.getNote(id);
      if (!current) throw new Error('Note not found');
      const markdown = updateFrontmatterProperty(current.markdown, name, value, type, options);
      const saved = await repository.saveNote(id, { markdown }, true);
      updateEntry(saved);
      if (selectedRef.current?.id === id) updateSelected(saved);
      return saved;
    } catch (caught) { failure('save', caught); }
  }, [activeVault, failure, flushPending, updateEntry, updateSelected]);

  const applyPropertyDefaults = useCallback(async (id: string, schemas: MetadataSchema[]): Promise<VaultNote | undefined> => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try {
      await flushPending();
      const current = await repository.getNote(id);
      if (!current) throw new Error('Note not found');
      const markdown = applyMetadataDefaults(current.markdown, matchingMetadataSchemas(current, schemas));
      const saved = await repository.saveNote(id, { markdown }, true);
      updateEntry(saved);
      if (selectedRef.current?.id === id) updateSelected(saved);
      return saved;
    } catch (caught) { failure('save', caught); }
  }, [failure, flushPending, updateEntry, updateSelected]);

  const previewTagChange = useCallback(async (from: string, to: string | null, includeChildren: boolean): Promise<{ changes: TagChange[]; expectedRevisions: { id: string; revision: number }[] } | undefined> => {
    const repository = repositoryRef.current;
    if (!repository || !activeVault) return;
    try {
      await flushPending();
      const entries = (await repository.listTree(activeVault.id)).notes;
      const bodies = (await Promise.all(entries.map((entry) => repository.getNote(entry.id)))).filter((note): note is VaultNote => Boolean(note));
      return { changes: planTagRewrite(bodies, from, to, includeChildren), expectedRevisions: bodies.map(({ id, revision }) => ({ id, revision })) };
    } catch (caught) { failure('save', caught); }
  }, [activeVault, failure, flushPending]);

  return {
    repository: repositoryRef.current, vaults, deletedVaults, activeVault, tree, notes: tree?.notes ?? [], folders: tree?.folders ?? [], attachments: tree?.attachments ?? [],
    selectedNote, selectedId: selectedNote?.id ?? null, selectedFolderId, setSelectedFolderId, selectNote,
    ready, error, clearError: () => setError(null), saveStatus, recoveredDraft, clearRecoveredDraft: () => setRecoveredDraft(false), quotaWarning, clearQuotaWarning: () => setQuotaWarning(false),
    flushPending, patchNote, addNote, createDailyNote, openPeriodNote, createCalendarEvent, moveCalendarDate, renderNoteTemplate, applyPropertiesFromTemplate, removeNote, importFiles, toggleTask, updateTask, assignTaskIds, exportZip, switchVault, createVault,
    renameVault: (id: string, name: string) => invoke((repository) => repository.renameVault(id, name)),
    deleteVault, restoreVault,
    updateVaultSettings: (settings: Partial<Vault['settings']>) => activeVault ? invoke((repository) => repository.updateVaultSettings(activeVault.id, settings)) : Promise.resolve(undefined),
    createFolder: (parentId: string | null, name: string) => activeVault ? invoke((repository) => repository.createFolder(activeVault.id, parentId, name)) : Promise.resolve(undefined),
    renameFolder: (id: string, name: string) => invoke((repository) => repository.renameFolder(id, name)),
    moveFolder: (id: string, parentId: string | null) => invoke((repository) => repository.moveFolder(id, parentId)),
    deleteFolder: (id: string) => invoke((repository) => repository.deleteFolder(id)),
    restoreFolder: (id: string) => invoke((repository) => repository.restoreFolder(id)),
    renameNote: (id: string, title: string) => invoke((repository) => repository.renameNote(id, title)),
    previewNoteRename,
    renameNoteWithLinks: (id: string, title: string, expectedRevision: number, changes: RenameChange[], expectedRevisions: { id: string; revision: number }[]) => invoke((repository) => repository.renameNoteWithLinks(id, title, expectedRevision, changes, expectedRevisions)),
    createLinkedNote,
    updateProperty, applyPropertyDefaults, previewTagChange,
    applyTagChange: (changes: TagChange[], expectedRevisions: { id: string; revision: number }[]) => activeVault ? invoke((repository) => repository.applyVaultNoteEdits(activeVault.id, changes, expectedRevisions)) : Promise.resolve(undefined),
    listMetadataSchemas: async (): Promise<MetadataSchema[]> => {
      const repository = repositoryRef.current;
      if (!repository || !activeVault) return [];
      return (await repository.listObjects('metadataSchema', activeVault.id)).flatMap((item) => { const parsed = metadataSchemaSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
    },
    putMetadataSchema: (schema: MetadataSchema) => invoke((repository) => repository.putObject('metadataSchema', schema)),
    deleteMetadataSchema: (id: string) => invoke((repository) => repository.deleteObject(id)),
    moveNote: (id: string, folderId: string | null) => invoke((repository) => repository.moveNote(id, folderId)),
    duplicateNote: (id: string) => invoke((repository) => repository.duplicateNote(id)),
    restoreNote: (id: string) => invoke((repository) => repository.restoreNote(id)),
    permanentlyDeleteNote: (id: string) => invoke((repository) => repository.permanentlyDeleteNote(id)),
    addAttachment: (folderId: string | null, file: File) => activeVault ? invoke((repository) => repository.addAttachment(activeVault.id, folderId, file, file.name)) : Promise.resolve(undefined),
    renameAttachment: (id: string, name: string) => invoke((repository) => repository.renameAttachment(id, name)),
    moveAttachment: (id: string, folderId: string | null) => invoke((repository) => repository.moveAttachment(id, folderId)),
    deleteAttachment: (id: string) => invoke((repository) => repository.deleteAttachment(id)),
    restoreAttachment: (id: string) => invoke((repository) => repository.restoreAttachment(id)),
    permanentlyDeleteAttachment: (id: string) => invoke((repository) => repository.permanentlyDeleteAttachment(id)),
    emptyTrash: () => activeVault ? invoke((repository) => repository.emptyTrash(activeVault.id)) : Promise.resolve(undefined),
    getStatistics: (): Promise<VaultStatistics | undefined> => activeVault ? invoke((repository) => repository.getStatistics(activeVault.id)) : Promise.resolve(undefined),
    listTrash: () => activeVault ? invoke((repository) => repository.listTrash(activeVault.id)) : Promise.resolve(undefined),
    searchNotes, refreshActive, invalidateOcrSearch, invalidateDerivedSearch,
  };
}
