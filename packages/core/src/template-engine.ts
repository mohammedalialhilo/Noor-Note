import { parseDocument, YAMLMap } from 'yaml';
import { z } from 'zod';
import { propertyValueSchema, templateSettingsSchema, type Folder, type PropertyValue, type TemplateSettings, type VaultNote } from './vault-domain';

export interface TemplateContext {
  title: string; filename: string; folder: string; selection?: string; clipboard?: string;
  properties?: Readonly<Record<string, PropertyValue>>; now?: Date;
}
type Value = string | number | boolean | null;
type TemplateNote = Pick<VaultNote, 'id' | 'folderId'>;
type TemplateFolder = Pick<Folder, 'id' | 'parentId'>;
const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;
const token = /\{\{([^{}]{1,500})\}\}/gu;
const maxTemplateLength = 200_000;

export function localDateStamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid template date');
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateParts(date: Date): Record<string, string> {
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    yyyy: String(date.getFullYear()), yy: String(date.getFullYear()).slice(-2),
    MMMM: new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date),
    MMM: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date),
    MM: pad(date.getMonth() + 1), M: String(date.getMonth() + 1),
    dd: pad(date.getDate()), d: String(date.getDate()), HH: pad(date.getHours()), mm: pad(date.getMinutes()),
  };
}

function formatDate(date: Date, pattern: string): string {
  if (!pattern || pattern.length > 100 || !/^[\p{L}\p{N} :/.,_-]+$/u.test(pattern)) throw new Error('Invalid date format');
  const parts = dateParts(date);
  return pattern.replace(/yyyy|MMMM|MMM|yy|MM|dd|HH|mm|M|d/gu, (part) => parts[part] ?? part);
}

class ExpressionReader {
  private offset = 0;
  private steps = 0;
  constructor(private readonly input: string, private readonly values: Readonly<Record<string, Value>>, private readonly properties: Readonly<Record<string, PropertyValue>>, private readonly now: Date) {}
  private skip(): void { while (/\s/u.test(this.input[this.offset] ?? '')) this.offset++; }
  private readString(): string {
    const quote = this.input[this.offset++]!;
    let result = '';
    while (this.offset < this.input.length) {
      const char = this.input[this.offset++]!;
      if (char === quote) return result;
      if (char === '\\') {
        const escaped = this.input[this.offset++];
        if (!escaped) throw new Error('Unterminated template string');
        result += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
      } else result += char;
    }
    throw new Error('Unterminated template string');
  }
  private evaluateFunction(name: string, args: Value[]): Value {
    const string = (index: number) => args[index] === null || args[index] === undefined ? '' : String(args[index]);
    const arity = (min: number, max = min) => { if (args.length < min || args.length > max) throw new Error(`${name} expects ${min === max ? min : `${min}-${max}`} arguments`); };
    switch (name) {
      case 'dateFormat': arity(1); return formatDate(this.now, string(0));
      case 'upper': arity(1); return string(0).toLocaleUpperCase();
      case 'lower': arity(1); return string(0).toLocaleLowerCase();
      case 'trim': arity(1); return string(0).trim();
      case 'titleCase': arity(1); return string(0).toLocaleLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
      case 'property': {
        arity(1);
        const key = string(0);
        if (!key || key.length > 100 || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid property name');
        const value = Object.hasOwn(this.properties, key) ? this.properties[key] : null;
        if (value === undefined || value === null) return null;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
        return JSON.stringify(value);
      }
      case 'if': arity(3); return args[0] ? args[1]! : args[2]!;
      case 'eq': arity(2); return args[0] === args[1];
      case 'ne': arity(2); return args[0] !== args[1];
      case 'and': arity(2); return Boolean(args[0] && args[1]);
      case 'or': arity(2); return Boolean(args[0] || args[1]);
      case 'not': arity(1); return !args[0];
      case 'contains': arity(2); return string(0).includes(string(1));
      default: throw new Error(`Unknown template function: ${name}`);
    }
  }
  private expression(depth: number): Value {
    if (++this.steps > 100 || depth > 8) throw new Error('Template expression is too complex');
    this.skip();
    const char = this.input[this.offset];
    if (char === '"' || char === "'") return this.readString();
    const number = this.input.slice(this.offset).match(/^-?(?:\d+\.\d+|\d+)/u);
    if (number) { this.offset += number[0].length; return Number(number[0]); }
    const identifier = this.input.slice(this.offset).match(/^[A-Za-z_][A-Za-z0-9_]{0,79}/u);
    if (!identifier) throw new Error('Invalid template expression');
    this.offset += identifier[0].length;
    const name = identifier[0];
    this.skip();
    if (this.input[this.offset] !== '(') {
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'null') return null;
      if (!Object.hasOwn(this.values, name)) throw new Error(`Unknown template variable: ${name}`);
      return this.values[name]!;
    }
    this.offset++;
    const args: Value[] = [];
    this.skip();
    while (this.input[this.offset] !== ')') {
      if (args.length >= 10) throw new Error('Too many template arguments');
      args.push(this.expression(depth + 1));
      this.skip();
      const separator = this.input[this.offset++];
      if (separator === ')') return this.evaluateFunction(name, args);
      if (separator !== ',') throw new Error('Expected a comma in template function');
      this.skip();
    }
    this.offset++;
    return this.evaluateFunction(name, args);
  }
  read(): Value {
    const value = this.expression(0);
    this.skip();
    if (this.offset !== this.input.length) throw new Error('Unexpected text in template expression');
    return value;
  }
}

export function renderTemplate(markdown: string, context: TemplateContext): string {
  if (markdown.length > maxTemplateLength) throw new Error('Template exceeds 200 KB');
  const now = context.now ?? new Date();
  const date = localDateStamp(now);
  const values: Record<string, Value> = {
    date, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    title: context.title, filename: context.filename, folder: context.folder, selection: context.selection ?? '', clipboard: context.clipboard ?? '',
    year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, '0'), day: String(now.getDate()).padStart(2, '0'),
  };
  let count = 0;
  const rendered = markdown.replace(token, (_whole, raw: string) => {
    if (++count > 1000) throw new Error('Template has too many expressions');
    const value = new ExpressionReader(raw.trim(), values, context.properties ?? {}, now).read();
    return value === null ? '' : String(value);
  });
  if (rendered.length > 1_000_000) throw new Error('Rendered template is too large');
  return rendered;
}

export function templateBody(markdown: string): string { return markdown.replace(frontmatter, ''); }

/** Adds only absent YAML fields, retaining the note's existing fields and comments. */
export function applyTemplateProperties(markdown: string, renderedTemplate: string): string {
  const match = renderedTemplate.match(frontmatter);
  if (!match) return markdown;
  if (match[1]!.length > 65_536) throw new Error('Template frontmatter is too large');
  const source = parseDocument(match[1]!, { uniqueKeys: true, stringKeys: true });
  if (source.errors.length || source.contents !== null && !(source.contents instanceof YAMLMap)) throw new Error('Invalid template frontmatter');
  const targetMatch = markdown.match(frontmatter);
  if (targetMatch && targetMatch[1]!.length > 65_536) throw new Error('Note frontmatter is too large');
  const target = parseDocument(targetMatch?.[1] ?? '', { uniqueKeys: true, stringKeys: true, keepSourceTokens: true });
  if (target.errors.length || target.contents !== null && !(target.contents instanceof YAMLMap)) throw new Error('Invalid note frontmatter');
  const values: unknown = source.toJS({ maxAliasCount: 0 });
  if (values !== null && (typeof values !== 'object' || Array.isArray(values))) throw new Error('Template frontmatter must be a mapping');
  let changed = false;
  for (const [key, value] of Object.entries(values ?? {})) {
    if (key.length > 100 || !key.trim() || /[\r\n]/u.test(key) || !propertyValueSchema.safeParse(value).success) throw new Error('Invalid template property');
    if (!target.has(key)) { target.set(key, value); changed = true; }
  }
  if (!changed) return markdown;
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const yaml = target.toString({ lineWidth: 0 }).trimEnd().replace(/\n/gu, newline);
  return `---${newline}${yaml}${newline}---${newline}${targetMatch ? markdown.slice(targetMatch[0].length) : markdown}`;
}

export function isTemplateNote(note: TemplateNote, folders: readonly TemplateFolder[], templateFolderId: string | null): boolean {
  if (!templateFolderId || !note.folderId) return false;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let id: string | null = note.folderId;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    if (id === templateFolderId) return true;
    visited.add(id); id = byId.get(id)?.parentId ?? null;
  }
  return false;
}

export function configuredTemplateId(settingsInput: TemplateSettings, destinationFolderId: string | null, folders: readonly TemplateFolder[], options: { daily?: boolean; baseId?: string } = {}): string | null {
  const settings = templateSettingsSchema.parse(settingsInput);
  if (options.daily && settings.dailyTemplateId) return settings.dailyTemplateId;
  if (options.baseId && settings.baseTemplates[options.baseId]) return settings.baseTemplates[options.baseId]!;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let id = destinationFolderId;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    if (settings.folderTemplates[id]) return settings.folderTemplates[id]!;
    visited.add(id); id = byId.get(id)?.parentId ?? null;
  }
  return settings.defaultTemplateId;
}

export function validateTemplateSettings(settingsInput: unknown, notes: readonly TemplateNote[], folders: readonly TemplateFolder[], baseIds: readonly string[]): TemplateSettings {
  const settings = templateSettingsSchema.parse(settingsInput);
  if (settings.folderId && !folders.some((folder) => folder.id === settings.folderId)) throw new Error('Choose an existing template folder');
  const validNote = (id: string | null) => !id || notes.some((note) => note.id === id && isTemplateNote(note, folders, settings.folderId));
  if (!validNote(settings.defaultTemplateId) || !validNote(settings.dailyTemplateId) || Object.values(settings.folderTemplates).some((id) => !validNote(id)) || Object.values(settings.baseTemplates).some((id) => !validNote(id))) throw new Error('Choose notes from the template folder');
  if (Object.keys(settings.folderTemplates).some((id) => !folders.some((folder) => folder.id === id)) || Object.keys(settings.baseTemplates).some((id) => !baseIds.includes(id))) throw new Error('A template rule targets a missing folder or Base');
  return settings;
}

export function templateContextForNote(note: Pick<VaultNote, 'title' | 'path' | 'properties'>, extra: Pick<TemplateContext, 'selection' | 'clipboard' | 'now'> = {}): TemplateContext {
  const filename = note.path.split('/').at(-1) ?? '';
  return { title: note.title, filename, folder: note.path.slice(0, -filename.length - 1) || '/', properties: note.properties, ...extra };
}

export const templateIdSchema = z.uuid();
