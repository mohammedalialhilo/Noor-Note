import { extractTags, type Note } from '@noor-note/core';

export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

export function nextUpdatedAt(note: Note, now = Date.now()): string {
  return new Date(Math.max(now, Date.parse(note.createdAt), Date.parse(note.updatedAt) + 1)).toISOString();
}

/** Import collisions become new notes, so an old backup cannot replace newer local work. */
export function prepareImportedNotes(
  existing: readonly Note[],
  incoming: readonly Note[],
  createId: () => string = () => crypto.randomUUID(),
): Note[] {
  const byId = new Map(existing.map((note) => [note.id, note]));
  const prepared: Note[] = [];
  for (const note of incoming) {
    const match = byId.get(note.id);
    if (match && match.title === note.title && match.content === note.content &&
      match.createdAt === note.createdAt && match.updatedAt === note.updatedAt) continue;
    let candidate = note;
    if (match) {
      let id = createId();
      while (byId.has(id)) id = createId();
      candidate = { ...note, id };
    }
    byId.set(candidate.id, candidate);
    prepared.push(candidate);
  }
  return prepared;
}

export function filterNotes(notes: readonly Note[], query: string, tag: string | null = null): Note[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return sortNotes(notes).filter((note) => {
    if (tag && !extractTags(note.content).some((noteTag) => noteTag.toLocaleLowerCase() === tag.toLocaleLowerCase())) return false;
    if (!normalizedQuery) return true;
    return `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalizedQuery);
  });
}

export function toggleTaskLine(content: string, lineNumber: number): string | null {
  const lines = content.split('\n');
  const line = lines[lineNumber - 1];
  if (line === undefined) return null;
  const match = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/);
  if (!match) return null;
  const next = match[2] === ' ' ? 'x' : ' ';
  lines[lineNumber - 1] = line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, `$1[${next}]`);
  return lines.join('\n');
}

export function excerpt(content: string, maxLength = 110): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trimEnd()}…` : plain;
}

export function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
