import type { VaultNote } from '@noor-note/core';
import { z } from 'zod';

const PREFIX = 'noor-note-draft:';
const draftSchema = z.object({
  vaultId: z.uuid(), title: z.string().max(200), markdown: z.string().max(1_000_000),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export interface RecoveryDraft extends z.infer<typeof draftSchema> { noteId: string }

function parseDraft(key: string): RecoveryDraft | null {
  const noteId = key.slice(PREFIX.length);
  if (!key.startsWith(PREFIX) || !z.uuid().safeParse(noteId).success) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 1_100_000) return null;
    const parsed = draftSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? { noteId, ...parsed.data } : null;
  } catch { return null; }
}

export function readRecoveryDraft(note: VaultNote): Pick<VaultNote, 'title' | 'markdown'> | null {
  const draft = parseDraft(`${PREFIX}${note.id}`);
  if (!draft || draft.vaultId !== note.vaultId || draft.updatedAt <= Date.parse(note.updatedAt) || draft.title === note.title && draft.markdown === note.markdown) return null;
  return { title: draft.title, markdown: draft.markdown };
}

export function listRecoveryDrafts(vaultId: string): RecoveryDraft[] {
  const result: RecoveryDraft[] = [];
  try {
    for (let index = 0; index < localStorage.length && result.length < 1000; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const draft = parseDraft(key);
      if (draft?.vaultId === vaultId) result.push(draft);
    }
  } catch { return []; }
  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function writeRecoveryDraft(note: VaultNote): void {
  if (note.markdown.length > 1_000_000) return;
  try { localStorage.setItem(`${PREFIX}${note.id}`, JSON.stringify({ vaultId: note.vaultId, title: note.title, markdown: note.markdown, updatedAt: Math.max(Date.now(), Date.parse(note.updatedAt) + 1) })); }
  catch { /* IndexedDB autosave remains available when localStorage is full. */ }
}

export function discardRecoveryDraft(noteId: string): void {
  try { localStorage.removeItem(`${PREFIX}${z.uuid().parse(noteId)}`); } catch { /* Browser storage may be unavailable. */ }
}
