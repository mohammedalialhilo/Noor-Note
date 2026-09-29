import { z } from 'zod';

const historySchema = z.object({ recent: z.array(z.string().max(1_000)).max(20), saved: z.array(z.string().max(1_000)).max(20) }).strict();
export type SearchHistory = z.infer<typeof historySchema>;
const empty = (): SearchHistory => ({ recent: [], saved: [] });
const key = (vaultId: string) => `noor-note-search:${vaultId}`;

export function readSearchHistory(vaultId: string): SearchHistory {
  try { return historySchema.parse(JSON.parse(localStorage.getItem(key(vaultId)) ?? '{}')); }
  catch { return empty(); }
}
export function writeSearchHistory(vaultId: string, value: SearchHistory): SearchHistory {
  const parsed = historySchema.parse(value);
  try { localStorage.setItem(key(vaultId), JSON.stringify(parsed)); } catch { /* Search works without preference storage. */ }
  return parsed;
}
export function addRecentSearch(vaultId: string, query: string): SearchHistory {
  const current = readSearchHistory(vaultId);
  const trimmed = query.trim();
  if (!trimmed) return current;
  return writeSearchHistory(vaultId, { ...current, recent: [trimmed, ...current.recent.filter((item) => item !== trimmed)].slice(0, 20) });
}
export function toggleSavedSearch(vaultId: string, query: string): SearchHistory {
  const current = readSearchHistory(vaultId);
  const trimmed = query.trim();
  if (!trimmed) return current;
  return writeSearchHistory(vaultId, { ...current, saved: current.saved.includes(trimmed) ? current.saved.filter((item) => item !== trimmed) : [trimmed, ...current.saved].slice(0, 20) });
}
