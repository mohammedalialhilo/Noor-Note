import type { Folder } from '@noor-note/core';
import type { NoteEntry } from '@noor-note/storage';
import { z } from 'zod';

export type SwitcherEntry = { kind: 'note'; id: string; title: string; path: string; recent: boolean; score: number; updatedAt: string } | { kind: 'folder'; id: string; title: string; path: string; recent: false; score: number };
const recentSchema = z.array(z.uuid()).max(30);
const key = (vaultId: string) => `noor-note-recent-notes:${vaultId}`;
export function readRecentNotes(vaultId: string): string[] {
  try { return recentSchema.parse(JSON.parse(localStorage.getItem(key(vaultId)) ?? '[]')); } catch { return []; }
}
export function recordRecentNote(vaultId: string, noteId: string): string[] {
  const recent = [noteId, ...readRecentNotes(vaultId).filter((id) => id !== noteId)].slice(0, 30);
  try { localStorage.setItem(key(vaultId), JSON.stringify(recent)); } catch { /* Navigation remains available. */ }
  return recent;
}
function fuzzyScore(value: string, query: string): number {
  const source = value.normalize('NFKC').toLocaleLowerCase();
  const needle = query.normalize('NFKC').toLocaleLowerCase();
  if (!needle) return 0;
  if (source === needle) return 120;
  if (source.startsWith(needle)) return 90;
  if (source.includes(needle)) return 65;
  let cursor = 0;
  let gaps = 0;
  for (const letter of needle) {
    const next = source.indexOf(letter, cursor);
    if (next < 0) return -1;
    gaps += next - cursor;
    cursor = next + 1;
  }
  return Math.max(5, 45 - gaps);
}
export function quickSwitcherEntries(notes: NoteEntry[], folders: Folder[], query: string, recentIds: string[]): SwitcherEntry[] {
  const term = query.trim();
  const recentIndex = new Map(recentIds.map((id, index) => [id, index]));
  const noteEntries = notes.flatMap((note): SwitcherEntry[] => {
    const score = term ? Math.max(fuzzyScore(note.title, term), fuzzyScore(note.path, term) - 10) : 0;
    if (term && score < 0) return [];
    const rank = recentIndex.get(note.id);
    return [{ kind: 'note', id: note.id, title: note.title || 'Untitled note', path: note.path, recent: rank !== undefined, score: score + (rank === undefined ? 0 : Math.max(0, 100 - rank)), updatedAt: note.updatedAt }];
  });
  const folderEntries = folders.flatMap((folder): SwitcherEntry[] => {
    if (!term) return [];
    const score = Math.max(fuzzyScore(folder.name, term), fuzzyScore(folder.path, term) - 10);
    return score < 0 ? [] : [{ kind: 'folder', id: folder.id, title: folder.name, path: folder.path, recent: false, score }];
  });
  return [...noteEntries, ...folderEntries].sort((a, b) => b.score - a.score || (!term && a.kind === 'note' && b.kind === 'note' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title))).slice(0, 30);
}
export function canCreateMissingNote(query: string, notes: NoteEntry[]): boolean {
  const name = query.trim().replace(/\.md$/iu, '');
  if (!name || name.length > 200 || name.split('/').some((part) => !part || part === '.' || part === '..' || /[\\\r\n]/u.test(part))) return false;
  const target = name.toLocaleLowerCase();
  return !notes.some((note) => note.title.toLocaleLowerCase() === target || note.path.replace(/^\//u, '').replace(/\.md$/iu, '').toLocaleLowerCase() === target);
}
