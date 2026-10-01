import { z } from 'zod';
import { updateFrontmatterProperty } from './metadata';
import { normalizeTagName } from './tag-engine';
import { renderTemplate } from './template-engine';
import { propertyValueSchema, safeFileStem, type PropertyType, type PropertyValue } from './vault-domain';

const propertyName = z.string().trim().min(1).max(100).regex(/^[\p{L}_][\p{L}\p{N}_-]*$/u);
const bounded = z.string().trim().max(40).nullable();
const isLocalDateTime = (value: string): boolean => /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value) && z.iso.date().safeParse(value.slice(0, 10)).success;
export const baseFormFieldKindSchema = z.enum(['text', 'textarea', 'number', 'date', 'datetime', 'select', 'multiSelect', 'checkbox', 'tags', 'noteReference', 'url', 'email', 'fileAttachment']);
export type BaseFormFieldKind = z.infer<typeof baseFormFieldKindSchema>;

/** A deliberately bounded regex subset: anchored literals/classes, finite repeats, no groups or backreferences. */
export function compileSafeFormPattern(pattern: string): RegExp {
  if (pattern.length < 3 || pattern.length > 120 || !pattern.startsWith('^') || !pattern.endsWith('$')) throw new Error('Pattern must start with ^, end with $, and stay under 120 characters.');
  let offset = 1, combinations = 1, atoms = 0;
  while (offset < pattern.length - 1) {
    const character = pattern[offset]!;
    if (character === '\\') {
      const escaped = pattern[offset + 1];
      if (!escaped || !'dDsSwW.-_@'.includes(escaped)) throw new Error('Unsupported pattern escape.');
      offset += 2;
    } else if (character === '[') {
      offset++;
      let length = 0;
      while (offset < pattern.length - 1 && pattern[offset] !== ']') {
        if (pattern[offset] === '\\') { if (!pattern[offset + 1]) throw new Error('Invalid character class.'); offset += 2; }
        else { if (pattern[offset] === '[' || pattern[offset] === '^') throw new Error('Unsupported character class.'); offset++; }
        length++;
      }
      if (!length || pattern[offset] !== ']') throw new Error('Invalid character class.');
      offset++;
    } else {
      if (!/[\p{L}\p{N} _@:/.-]/u.test(character)) throw new Error('Unsupported pattern operator.');
      offset++;
    }
    atoms++;
    if (atoms > 80) throw new Error('Pattern is too long.');
    if (pattern[offset] === '{') {
      const repeat = pattern.slice(offset).match(/^\{(\d{1,2})(?:,(\d{1,2}))?\}/u);
      if (!repeat) throw new Error('Use finite repeats such as {3} or {2,5}.');
      const minimum = Number(repeat[1]), maximum = Number(repeat[2] ?? repeat[1]);
      if (maximum < minimum || maximum > 50) throw new Error('Pattern repeats must be between 0 and 50.');
      combinations *= maximum - minimum + 1;
      if (combinations > 10_000) throw new Error('Pattern has too many combinations.');
      offset += repeat[0].length;
    }
  }
  try { return new RegExp(pattern, 'u'); } catch { throw new Error('Invalid pattern.'); }
}

export const baseFormFieldSchema = z.object({
  id: z.uuid(), key: propertyName, label: z.string().trim().min(1).max(100), kind: baseFormFieldKindSchema,
  required: z.boolean(), minimum: bounded, maximum: bounded, pattern: z.string().max(120).nullable(),
  options: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict().superRefine((field, context) => {
  if (['aliases', 'noor_property_types', 'noor_property_options', '__proto__', 'constructor', 'prototype'].includes(field.key) || field.key.startsWith('noor_')) context.addIssue({ code: 'custom', path: ['key'], message: 'This property name is reserved.' });
  if (field.key === 'title' && field.kind !== 'text' || field.key === 'body' && field.kind !== 'textarea') context.addIssue({ code: 'custom', path: ['key'], message: 'Title needs text; body needs textarea.' });
  if (field.pattern) { try { compileSafeFormPattern(field.pattern); } catch (error) { context.addIssue({ code: 'custom', path: ['pattern'], message: error instanceof Error ? error.message : 'Invalid pattern.' }); } }
  if (field.pattern && !['text', 'textarea', 'email', 'url'].includes(field.kind)) context.addIssue({ code: 'custom', path: ['pattern'], message: 'Patterns apply to text, email, and URL fields.' });
  if (['select', 'multiSelect'].includes(field.kind)) {
    if (!field.options.length || new Set(field.options.map((item) => item.toLocaleLowerCase())).size !== field.options.length) context.addIssue({ code: 'custom', path: ['options'], message: 'Add unique allowed options.' });
  } else if (field.options.length) context.addIssue({ code: 'custom', path: ['options'], message: 'Only choice fields have options.' });
  const bounds = [field.minimum, field.maximum].filter((item): item is string => item !== null);
  if (field.kind === 'date' || field.kind === 'datetime') {
    if (bounds.some((item) => field.kind === 'date' ? !z.iso.date().safeParse(item).success : !isLocalDateTime(item))) context.addIssue({ code: 'custom', path: ['minimum'], message: 'Use an ISO date or local date and time.' });
  } else if (bounds.some((item) => !Number.isFinite(Number(item)) || Number(item) < 0 && field.kind !== 'number')) context.addIssue({ code: 'custom', path: ['minimum'], message: 'Bounds must be finite numbers.' });
  if (field.minimum !== null && field.maximum !== null && (field.kind === 'date' || field.kind === 'datetime' ? field.minimum > field.maximum : Number(field.minimum) > Number(field.maximum))) context.addIssue({ code: 'custom', path: ['maximum'], message: 'Maximum must be at least minimum.' });
});
export type BaseFormField = z.infer<typeof baseFormFieldSchema>;
export const baseFormSchema = z.object({
  targetFolderId: z.uuid().nullable(), filenameTemplate: z.string().trim().min(1).max(200), noteTemplateId: z.uuid().nullable(),
  defaultProperties: z.record(propertyName, propertyValueSchema), fields: z.array(baseFormFieldSchema).max(50),
}).strict().superRefine((form, context) => {
  if (/\bfilename\b/u.test(form.filenameTemplate)) context.addIssue({ code: 'custom', path: ['filenameTemplate'], message: 'Filename templates cannot refer to their own filename.' });
  const keys = new Set<string>();
  for (const [index, field] of form.fields.entries()) { const key = field.key.toLocaleLowerCase(); if (keys.has(key)) context.addIssue({ code: 'custom', path: ['fields', index, 'key'], message: 'Form field keys must be unique.' }); keys.add(key); }
  if (new Set(form.fields.map((field) => field.id)).size !== form.fields.length) context.addIssue({ code: 'custom', path: ['fields'], message: 'Form field IDs must be unique.' });
  for (const key of Object.keys(form.defaultProperties)) if (['title', 'body', 'aliases', '__proto__', 'constructor', 'prototype'].includes(key) || key.startsWith('noor_')) context.addIssue({ code: 'custom', path: ['defaultProperties', key], message: 'This default property is reserved.' });
});
export type BaseForm = z.infer<typeof baseFormSchema>;
export function newBaseForm(): BaseForm { return baseFormSchema.parse({ targetFolderId: null, filenameTemplate: '{{title}}', noteTemplateId: null, defaultProperties: {}, fields: [{ id: crypto.randomUUID(), key: 'title', label: 'Title', kind: 'text', required: true, minimum: null, maximum: '200', pattern: null, options: [] }] }); }
export function newBaseFormField(kind: BaseFormFieldKind, key: string): BaseFormField { return baseFormFieldSchema.parse({ id: crypto.randomUUID(), key, label: key[0]!.toUpperCase() + key.slice(1), kind, required: false, minimum: null, maximum: null, pattern: null, options: kind === 'select' || kind === 'multiSelect' ? ['Option 1'] : [] }); }

export interface FormNoteReference { id: string; path: string }
export interface ValidatedForm { title: string; properties: Record<string, PropertyValue>; body: { label: string; text: string }[]; fileFields: { fieldId: string; key: string; label: string; names: string[] }[] }
function boundary(field: BaseFormField, value: string | number | readonly string[]): void {
  const current = typeof value === 'string' && (field.kind === 'date' || field.kind === 'datetime' || field.kind === 'number') ? value : typeof value === 'number' ? value : typeof value === 'string' ? value.length : value.length;
  const minimum = field.kind === 'date' || field.kind === 'datetime' ? field.minimum : field.minimum === null ? null : Number(field.minimum);
  const maximum = field.kind === 'date' || field.kind === 'datetime' ? field.maximum : field.maximum === null ? null : Number(field.maximum);
  if (minimum !== null && current < minimum) throw new Error(`${field.label} is below the minimum.`);
  if (maximum !== null && current > maximum) throw new Error(`${field.label} exceeds the maximum.`);
}
export function validateBaseForm(formInput: BaseForm, input: Readonly<Record<string, unknown>>, notes: readonly FormNoteReference[] = []): ValidatedForm {
  const form = baseFormSchema.parse(formInput);
  const properties: Record<string, PropertyValue> = { ...form.defaultProperties };
  const body: ValidatedForm['body'] = [], fileFields: ValidatedForm['fileFields'] = [];
  let title = 'Untitled';
  for (const field of form.fields) {
    const raw = input[field.id];
    const blank = raw === undefined || raw === null || raw === '' || Array.isArray(raw) && raw.length === 0;
    if (blank) { if (field.required) throw new Error(`${field.label} is required.`); continue; }
    let value: PropertyValue;
    if (field.kind === 'checkbox') { if (typeof raw !== 'boolean') throw new Error(`${field.label} must be checked or unchecked.`); value = raw; }
    else if (field.kind === 'number') { const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN; if (!Number.isFinite(parsed)) throw new Error(`${field.label} must be a number.`); boundary(field, parsed); value = parsed; }
    else if (field.kind === 'multiSelect' || field.kind === 'tags' || field.kind === 'fileAttachment') {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) throw new Error(`${field.label} must be a list.`);
      const values = raw as string[];
      boundary(field, values);
      if (field.kind === 'multiSelect' && values.some((item) => !field.options.includes(item))) throw new Error(`${field.label} contains an option that is not allowed.`);
      value = field.kind === 'tags' ? [...new Set(values.map(normalizeTagName))] : values;
      if (field.kind === 'fileAttachment') { fileFields.push({ fieldId: field.id, key: field.key, label: field.label, names: values }); continue; }
    } else {
      if (typeof raw !== 'string') throw new Error(`${field.label} must be text.`);
      const text = field.kind === 'textarea' ? raw : raw.trim();
      if (text.length > 20_000) throw new Error(`${field.label} is too long.`);
      boundary(field, text);
      if (field.pattern && !compileSafeFormPattern(field.pattern).test(text)) throw new Error(`${field.label} does not match the required format.`);
      if (field.kind === 'date' && !z.iso.date().safeParse(text).success || field.kind === 'datetime' && !isLocalDateTime(text)) throw new Error(`${field.label} needs a valid date.`);
      if (field.kind === 'email' && !z.email().safeParse(text).success) throw new Error(`${field.label} needs a valid email.`);
      if (field.kind === 'url' && (!z.url().safeParse(text).success || !/^https?:\/\//iu.test(text))) throw new Error(`${field.label} needs an HTTP or HTTPS URL.`);
      if (field.kind === 'select' && !field.options.includes(text)) throw new Error(`${field.label} is not an allowed option.`);
      if (field.kind === 'noteReference') { const note = notes.find((item) => item.id === text); if (!note) throw new Error(`${field.label} points to a note that is unavailable.`); value = `[[${note.path.replace(/^\//u, '').replace(/\.md$/iu, '')}]]`; }
      else value = text;
    }
    if (field.key === 'title') title = String(value);
    else if (field.key === 'body') body.push({ label: field.label, text: String(value) });
    else properties[field.key] = value;
  }
  return { title, properties, body, fileFields };
}

export interface FormAttachmentReference { fieldId: string; name: string; path: string }
function relativePath(fromPath: string, toPath: string): string {
  const from = fromPath.split('/').filter(Boolean).slice(0, -1), to = toPath.split('/').filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].map((part) => part === '..' ? part : encodeURIComponent(part)).join('/');
}
export function renderBaseFormFilename(formInput: BaseForm, validated: ValidatedForm, folderPath: string, now = new Date()): string {
  const form = baseFormSchema.parse(formInput);
  const output = renderTemplate(form.filenameTemplate, { title: validated.title, filename: '', folder: folderPath, properties: validated.properties, now }).trim();
  if (!output) throw new Error('Filename template produced an empty name.');
  return safeFileStem(output);
}
export function renderBaseFormNote(formInput: BaseForm, validated: ValidatedForm, templateMarkdown: string, folderPath: string, notePath: string, attachments: readonly FormAttachmentReference[] = [], now = new Date()): { title: string; markdown: string } {
  const form = baseFormSchema.parse(formInput);
  const context = { title: validated.title, filename: notePath.split('/').at(-1) ?? '', folder: folderPath, properties: validated.properties, now };
  const title = renderBaseFormFilename(form, validated, folderPath, now);
  let markdown = renderTemplate(templateMarkdown, { ...context, title });
  for (const [key, value] of Object.entries(validated.properties)) {
    const field = form.fields.find((item) => item.key === key);
    const hint: PropertyType | undefined = field ? ({ number: 'number', date: 'date', datetime: 'datetime', select: 'singleSelect', multiSelect: 'multiSelect', checkbox: 'boolean', tags: 'list', noteReference: 'noteReference', url: 'url', email: 'email', textarea: 'text', text: 'text' } as Partial<Record<BaseFormFieldKind, PropertyType>>)[field.kind] : undefined;
    markdown = updateFrontmatterProperty(markdown, key, value, hint, field && (field.kind === 'select' || field.kind === 'multiSelect') ? field.options : undefined);
  }
  const sections = validated.body.map((entry) => `## ${entry.label}\n\n${entry.text}`);
  for (const entry of validated.fileFields) {
    const matching = attachments.filter((item) => item.fieldId === entry.fieldId);
    if (!matching.length) continue;
    const paths = matching.map((item) => relativePath(notePath, item.path));
    markdown = updateFrontmatterProperty(markdown, entry.key, paths, 'list');
    sections.push(`## ${entry.label}\n\n${matching.map((item, index) => `[${item.name.replaceAll('[', '\\[').replaceAll(']', '\\]')}](${paths[index]})`).join('\n')}`);
  }
  if (sections.length) markdown = `${markdown.trimEnd()}\n\n${sections.join('\n\n')}\n`;
  if (markdown.length > 1_000_000) throw new Error('Form note is too large.');
  return { title, markdown };
}
