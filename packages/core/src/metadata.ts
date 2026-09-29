import { parseDocument, YAMLMap } from 'yaml';
import { z } from 'zod';
import { propertyTypeSchema, propertyValueSchema, type MetadataSchema, type PropertyType, type PropertyValue, type VaultNote } from './vault-domain';

const frontmatterPattern = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/u;
const hintKey = 'noor_property_types';
const optionsKey = 'noor_property_options';

export interface MetadataView { values: Record<string, PropertyValue>; types: Record<string, PropertyType>; options: Record<string, string[]>; hasFrontmatter: boolean }

function parseFrontmatter(markdown: string) {
  const match = markdown.match(frontmatterPattern);
  if (match && (match[2]?.length ?? 0) > 65_536) throw new Error('Frontmatter is too large');
  const document = parseDocument(match?.[2] ?? '', { uniqueKeys: true, stringKeys: true, keepSourceTokens: true });
  if (document.errors.length) throw new Error('Invalid YAML frontmatter');
  if (document.contents !== null && !(document.contents instanceof YAMLMap)) throw new Error('Frontmatter must be a YAML mapping');
  return { match, document };
}

export function inspectMetadata(markdown: string): MetadataView {
  const { match, document } = parseFrontmatter(markdown);
  const raw: unknown = document.toJS({ maxAliasCount: 0 });
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('Frontmatter must be a YAML mapping');
  const record = raw as Record<string, unknown> | null;
  const types: Record<string, PropertyType> = {};
  const options: Record<string, string[]> = {};
  const hints = record?.[hintKey];
  if (hints && typeof hints === 'object' && !Array.isArray(hints)) {
    for (const [key, value] of Object.entries(hints)) {
      const result = propertyTypeSchema.safeParse(value);
      if (result.success) types[key] = result.data;
    }
  }
  const rawOptions = record?.[optionsKey];
  if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) for (const [key, value] of Object.entries(rawOptions)) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) options[key] = value;
  }
  const values: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    if (key === hintKey || key === optionsKey || key === 'title' || key === 'aliases') continue;
    const result = propertyValueSchema.safeParse(value);
    if (result.success) values[key] = result.data;
  }
  return { values, types, options, hasFrontmatter: Boolean(match) };
}

/** Updates only a named YAML key. The YAML document retains unrelated fields and comments. */
export function updateFrontmatterProperty(markdown: string, name: string, value: PropertyValue | undefined, type?: PropertyType, options?: string[]): string {
  const key = name.trim();
  if (!key || key.length > 100 || ['title', 'aliases', hintKey, optionsKey].includes(key) || /[\r\n]/u.test(key)) throw new Error('Invalid property name');
  if (value !== undefined) propertyValueSchema.parse(value);
  if (type) propertyTypeSchema.parse(type);
  if (options && (options.length > 100 || options.some((item) => !item.trim() || item.length > 100))) throw new Error('Invalid select options');
  const { match, document } = parseFrontmatter(markdown);
  if (!match && value === undefined) return markdown;
  if (value === undefined) document.delete(key);
  else document.set(key, value);
  const existingHints = document.get(hintKey);
  const hints = existingHints && typeof existingHints === 'object' && !Array.isArray(existingHints)
    ? (document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>)[hintKey] as Record<string, unknown>
    : {};
  if (type && value !== undefined) hints[key] = type;
  if (value === undefined) delete hints[key];
  if (Object.keys(hints).length) document.set(hintKey, hints);
  else document.delete(hintKey);
  const existingOptions = document.get(optionsKey);
  const allOptions = existingOptions && typeof existingOptions === 'object' && !Array.isArray(existingOptions)
    ? (document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>)[optionsKey] as Record<string, unknown>
    : {};
  if (options && value !== undefined) allOptions[key] = options;
  if (value === undefined) delete allOptions[key];
  if (Object.keys(allOptions).length) document.set(optionsKey, allOptions);
  else document.delete(optionsKey);
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const yaml = document.toString({ lineWidth: 0 }).trimEnd().replace(/\n/gu, newline);
  const body = match ? markdown.slice(match[0].length) : markdown;
  return `---${newline}${yaml}${newline}---${newline}${body}`;
}

export function inferPropertyType(value: PropertyValue, hint?: PropertyType): PropertyType {
  if (hint) return hint;
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)) return 'datetime';
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return 'date';
    if (/^https?:\/\//iu.test(value)) return 'url';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) return 'email';
    if (/^#[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(value)) return 'tag';
    if (/^\[\[[^\]]+\]\]$/u.test(value)) return 'noteReference';
    if (/^#[\da-f]{6}$/iu.test(value)) return 'color';
  }
  return 'text';
}

export function parsePropertyInput(type: PropertyType, input: string, options: string[] = []): PropertyValue {
  propertyTypeSchema.parse(type);
  const text = input.trim();
  if (type === 'boolean') { if (text !== 'true' && text !== 'false') throw new Error('Choose true or false'); return text === 'true'; }
  if (type === 'number' || type === 'rating') {
    const value = Number(text);
    if (!text || !Number.isFinite(value) || type === 'rating' && (value < 0 || value > 5 || value * 2 % 1 !== 0)) throw new Error(type === 'rating' ? 'Rating must be 0 to 5 in half steps' : 'Enter a valid number');
    return value;
  }
  if (type === 'multiSelect' || type === 'list') {
    const values = text ? text.split(',').map((item) => item.trim()).filter(Boolean) : [];
    if (type === 'multiSelect' && values.some((item) => !options.includes(item))) throw new Error('Choose an available option');
    return values;
  }
  if (type === 'singleSelect' && !options.includes(text)) throw new Error('Choose an available option');
  if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`)))) throw new Error('Enter a valid date');
  if (type === 'datetime' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(text) || !Number.isFinite(Date.parse(text)))) throw new Error('Enter a valid date and time');
  if (type === 'url' && (!/^https?:\/\//iu.test(text) || !z.url().safeParse(text).success)) throw new Error('Enter an HTTP or HTTPS URL');
  if (type === 'email' && !z.email().safeParse(text).success) throw new Error('Enter a valid email address');
  if (type === 'tag' && !/^#?[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(text)) throw new Error('Enter a tag name');
  if (type === 'noteReference' && !/^\[\[[^\]\n]+\]\]$/u.test(text)) throw new Error('Enter a wiki note reference');
  if (type === 'color' && !/^#[\da-f]{6}$/iu.test(text)) throw new Error('Enter a six-digit hex color');
  if (type === 'tag') return text.startsWith('#') ? text : `#${text}`;
  return text;
}

export function formatPropertyInput(value: PropertyValue): string {
  return Array.isArray(value) ? value.map(String).join(', ') : value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function matchingMetadataSchemas(note: Pick<VaultNote, 'folderId' | 'properties'>, schemas: MetadataSchema[]): MetadataSchema[] {
  return schemas.filter((schema) => {
    if (schema.scope === 'folder') return schema.selector === note.folderId;
    const key = schema.scope === 'noteType' ? 'type' : schema.scope;
    return note.properties[key] === schema.selector;
  });
}

export function applyMetadataDefaults(markdown: string, schemas: MetadataSchema[]): string {
  let result = markdown;
  for (const schema of schemas) for (const field of schema.fields) {
    if (field.defaultValue === undefined || Object.hasOwn(inspectMetadata(result).values, field.name)) continue;
    result = updateFrontmatterProperty(result, field.name, field.defaultValue, field.type, field.options);
  }
  return result;
}
