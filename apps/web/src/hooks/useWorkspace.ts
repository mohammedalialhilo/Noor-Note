'use client';

import { createNote, parseImportedNotes, parseMarkdownDocument, type Note } from '@noor-note/core';
import { DexieNoteRepository, type NoteRepository } from '@noor-note/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, getUserErrorMessage, logError, type ErrorAction } from '../lib/logger';
import { nextUpdatedAt, prepareImportedNotes, sortNotes, toggleTaskLine } from '../lib/workspace';

type SaveStatus = 'saved' | 'saving' | 'error';

export function useWorkspace() {
  const repositoryRef = useRef<NoteRepository | null>(null);
  const notesRef = useRef<Note[]>([]);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const dirtyNotesRef = useRef(new Set<string>());
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});

  const showFailure = useCallback((action: ErrorAction, caught: unknown) => {
    logError(`workspace.${action}`, caught);
    setError(getUserErrorMessage(caught, action));
  }, []);

  const replaceNotes = useCallback((next: Note[]) => {
    const sorted = sortNotes(next);
    notesRef.current = sorted;
    setNotes(sorted);
  }, []);

  const enqueueWrite = useCallback((note: Note) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    writeChainRef.current = writeChainRef.current
      .catch(() => undefined)
      .then(() => repository.put(note))
      .then(() => {
        if (notesRef.current.find((item) => item.id === note.id) === note) {
          dirtyNotesRef.current.delete(note.id);
          setSaveStatuses((current) => ({ ...current, [note.id]: 'saved' }));
        }
      })
      .catch((caught: unknown) => {
        if (notesRef.current.find((item) => item.id === note.id) === note) {
          setSaveStatuses((current) => ({ ...current, [note.id]: 'error' }));
          showFailure('save', caught);
        }
      });
  }, [showFailure]);

  const flushPending = useCallback(() => {
    return writeChainRef.current;
  }, []);

  useEffect(() => {
    let repository: NoteRepository | null = null;
    let live = true;
    const open = async () => {
      try {
        repository = new DexieNoteRepository();
        repositoryRef.current = repository;
        const loaded = await repository.list();
        if (!live) return;
        replaceNotes(loaded);
        setSelectedId((current) => current ?? loaded[0]?.id ?? null);
        setReady(true);
      } catch (caught) {
        if (!live) return;
        showFailure('open', caught);
        setReady(true);
      }
    };
    void open();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyNotesRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      live = false;
      window.removeEventListener('beforeunload', onBeforeUnload);
      const closingRepository = repository;
      if (closingRepository) void flushPending().finally(() => closingRepository.close());
      repositoryRef.current = null;
    };
  }, [flushPending, replaceNotes, showFailure]);

  const patchNote = useCallback((id: string, patch: Partial<Pick<Note, 'title' | 'content'>>) => {
    const previous = notesRef.current.find((note) => note.id === id);
    if (!previous) return;
    const next: Note = { ...previous, ...patch, updatedAt: nextUpdatedAt(previous) };
    replaceNotes(notesRef.current.map((note) => note.id === id ? next : note));
    dirtyNotesRef.current.add(id);
    setSaveStatuses((current) => ({ ...current, [id]: 'saving' }));
    enqueueWrite(next);
  }, [enqueueWrite, replaceNotes]);

  const addNote = useCallback(async () => {
    const repository = repositoryRef.current;
    if (!repository) return;
    const note: Note = { ...createNote(), title: '' };
    try {
      await repository.put(note);
      replaceNotes([note, ...notesRef.current]);
      setSelectedId(note.id);
      setSaveStatuses((current) => ({ ...current, [note.id]: 'saved' }));
      return note;
    } catch (caught) {
      showFailure('create', caught);
    }
  }, [replaceNotes, showFailure]);

  const removeNote = useCallback(async (id: string) => {
    const repository = repositoryRef.current;
    if (!repository) return;
    try {
      await flushPending();
      await repository.delete(id);
      dirtyNotesRef.current.delete(id);
      const remaining = notesRef.current.filter((note) => note.id !== id);
      replaceNotes(remaining);
      setSelectedId((current) => current === id ? remaining[0]?.id ?? null : current);
    } catch (caught) {
      showFailure('delete', caught);
    }
  }, [flushPending, replaceNotes, showFailure]);

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const repository = repositoryRef.current;
    if (!repository) return 0;
    try {
      const imported: Note[] = [];
      for (const file of Array.from(files)) {
        if (file.name.toLocaleLowerCase().endsWith('.md')) {
          const { title, content } = parseMarkdownDocument(await file.text());
          imported.push(createNote(content, { title: title || file.name.replace(/\.md$/i, '') }));
        } else if (file.name.toLocaleLowerCase().endsWith('.json')) {
          const data: unknown = JSON.parse(await file.text());
          imported.push(...parseImportedNotes(data));
        } else {
          throw new AppError('invalid_import');
        }
      }
      await flushPending();
      const existing = await repository.list();
      const toInsert = prepareImportedNotes(existing, imported);
      await repository.importNotes(toInsert);
      replaceNotes(await repository.list());
      if (toInsert[0]) setSelectedId(toInsert[0].id);
      return toInsert.length;
    } catch (caught) {
      showFailure('import', caught);
      return 0;
    }
  }, [flushPending, replaceNotes, showFailure]);

  const toggleTask = useCallback((noteId: string, line: number) => {
    const note = notesRef.current.find((item) => item.id === noteId);
    if (!note) return;
    const content = toggleTaskLine(note.content, line);
    if (content !== null) patchNote(noteId, { content });
  }, [patchNote]);

  return {
    notes,
    selectedId,
    selectedNote: notes.find((note) => note.id === selectedId) ?? null,
    setSelectedId,
    ready,
    error,
    clearError: () => setError(null),
    saveStatus: selectedId ? saveStatuses[selectedId] ?? 'saved' : 'saved',
    addNote,
    patchNote,
    removeNote,
    importFiles,
    toggleTask,
    flushPending,
  };
}
