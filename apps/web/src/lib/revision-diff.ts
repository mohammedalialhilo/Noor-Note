import type { Revision, VaultNote } from '@noor-note/core';

export interface DiffLine {
  kind: 'equal' | 'added' | 'removed';
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
}

export interface SideBySideRow { before: DiffLine | null; after: DiffLine | null }

export function pairDiffLines(diff: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  for (let index = 0; index < diff.length;) {
    if (diff[index]!.kind === 'equal') {
      rows.push({ before: diff[index]!, after: diff[index]! });
      index += 1;
      continue;
    }
    const removed: DiffLine[] = [], added: DiffLine[] = [];
    while (index < diff.length && diff[index]!.kind !== 'equal') {
      const item = diff[index++]!;
      if (item.kind === 'removed') removed.push(item);
      else added.push(item);
    }
    for (let offset = 0; offset < Math.max(removed.length, added.length); offset += 1) rows.push({ before: removed[offset] ?? null, after: added[offset] ?? null });
  }
  return rows;
}

function lines(value: string): string[] { return value.split('\n'); }

/** Exact LCS for ordinary notes; large comparisons keep exact common ends and show the middle as a replacement. */
export function diffMarkdown(before: string, after: string): DiffLine[] {
  const left = lines(before), right = lines(after);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix += 1;
  const oldMid = left.slice(prefix, left.length - suffix), newMid = right.slice(prefix, right.length - suffix);
  const output: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) output.push({ kind: 'equal', text: left[i]!, beforeLine: i + 1, afterLine: i + 1 });
  let oldLine = prefix + 1, newLine = prefix + 1;
  if (oldMid.length * newMid.length <= 1_000_000) {
    const width = newMid.length + 1;
    const table = new Uint32Array((oldMid.length + 1) * width);
    for (let i = oldMid.length - 1; i >= 0; i -= 1) for (let j = newMid.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = oldMid[i] === newMid[j] ? 1 + table[(i + 1) * width + j + 1]! : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
    let i = 0, j = 0;
    while (i < oldMid.length || j < newMid.length) {
      if (i < oldMid.length && j < newMid.length && oldMid[i] === newMid[j]) { output.push({ kind: 'equal', text: oldMid[i]!, beforeLine: oldLine++, afterLine: newLine++ }); i++; j++; }
      else if (i < oldMid.length && (j === newMid.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) { output.push({ kind: 'removed', text: oldMid[i++]!, beforeLine: oldLine++, afterLine: null }); }
      else { output.push({ kind: 'added', text: newMid[j++]!, beforeLine: null, afterLine: newLine++ }); }
    }
  } else {
    for (const text of oldMid) output.push({ kind: 'removed', text, beforeLine: oldLine++, afterLine: null });
    for (const text of newMid) output.push({ kind: 'added', text, beforeLine: null, afterLine: newLine++ });
  }
  for (let i = 0; i < suffix; i += 1) output.push({ kind: 'equal', text: left[left.length - suffix + i]!, beforeLine: oldLine++, afterLine: newLine++ });
  return output;
}

export interface MetadataChange { field: string; before: string; after: string }

export function diffRevisionMetadata(before: Revision, after: Revision | VaultNote): MetadataChange[] {
  const changes: MetadataChange[] = [];
  const add = (field: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ field, before: display(left), after: display(right) });
  };
  add('Title', before.title, after.title);
  add('Path', before.path, after.path);
  if (before.metadata) {
    const next = 'revision' in after ? { folderId: after.folderId, aliases: after.aliases, properties: after.properties } : after.metadata;
    if (next) {
      add('Folder', before.metadata.folderId, next.folderId);
      add('Aliases', before.metadata.aliases, next.aliases);
      const keys = new Set([...Object.keys(before.metadata.properties), ...Object.keys(next.properties)]);
      for (const key of [...keys].sort()) add(`Property: ${key}`, before.metadata.properties[key], next.properties[key]);
    }
  }
  return changes;
}

function display(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'Root';
  if (typeof value === 'string') return value || '—';
  return JSON.stringify(value);
}
