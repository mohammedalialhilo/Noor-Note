import { describe, expect, it } from 'vitest';
import { baseDefinitionSchema, baseFormSchema, compileSafeFormPattern, newBaseDefinition, newBaseForm, newBaseFormField, renderBaseFormFilename, renderBaseFormNote, validateBaseForm } from '../src';

const build = () => {
  const title = newBaseForm().fields[0]!;
  const fields = [title, newBaseFormField('number', 'quantity'), newBaseFormField('select', 'status'), newBaseFormField('multiSelect', 'groups'), newBaseFormField('checkbox', 'approved'), newBaseFormField('tags', 'tags'), newBaseFormField('noteReference', 'related'), newBaseFormField('textarea', 'body'), newBaseFormField('fileAttachment', 'files')];
  return { ...newBaseForm(), filenameTemplate: '{{title}}', defaultProperties: { source: 'Form' }, fields };
};

describe('Base forms', () => {
  it('validates typed answers, options, note references, and writes portable Markdown', () => {
    const form = build();
    const noteId = crypto.randomUUID();
    const [title, quantity, status, groups, approved, tags, related, body, files] = form.fields;
    const validated = validateBaseForm(form, { [title!.id]: 'Field notes', [quantity!.id]: '12', [status!.id]: 'Option 1', [groups!.id]: ['Option 1'], [approved!.id]: true, [tags!.id]: ['#research/deep', 'research/deep'], [related!.id]: noteId, [body!.id]: 'Details', [files!.id]: ['report.pdf'] }, [{ id: noteId, path: '/Reading/Source.md' }]);
    expect(validated.properties).toMatchObject({ source: 'Form', quantity: 12, status: 'Option 1', groups: ['Option 1'], approved: true, tags: ['research/deep'], related: '[[Reading/Source]]' });
    const note = renderBaseFormNote(form, validated, '---\nexisting: yes # keep\n---\n# {{title}}', '/Notes', '/Notes/Field notes.md', [{ fieldId: files!.id, name: 'report.pdf', path: '/Notes/report.pdf' }], new Date('2026-09-30T12:00:00Z'));
    expect(note.title).toBe('Field notes');
    expect(note.markdown).toContain('existing: yes # keep');
    expect(note.markdown).toContain('quantity: 12');
    expect(note.markdown).toContain('## Body\n\nDetails');
    expect(note.markdown).toContain('[report.pdf](report.pdf)');
  });

  it('rejects invalid bounds, options, email, URL, required fields, and references', () => {
    const form = build();
    const [title, quantity, status, , , , related] = form.fields;
    expect(() => validateBaseForm(form, {})).toThrow('Title is required');
    expect(() => validateBaseForm(form, { [title!.id]: 'A', [quantity!.id]: 'NaN' })).toThrow('must be a number');
    expect(() => validateBaseForm(form, { [title!.id]: 'A', [status!.id]: 'Unknown' })).toThrow('not an allowed option');
    expect(() => validateBaseForm(form, { [title!.id]: 'A', [related!.id]: crypto.randomUUID() })).toThrow('unavailable');
    const email = newBaseFormField('email', 'contact');
    expect(() => validateBaseForm({ ...form, fields: [title!, email] }, { [title!.id]: 'A', [email.id]: 'bad' })).toThrow('valid email');
    const url = newBaseFormField('url', 'website');
    expect(() => validateBaseForm({ ...form, fields: [title!, url] }, { [title!.id]: 'A', [url.id]: 'javascript:alert(1)' })).toThrow('HTTP or HTTPS');
  });

  it('accepts only bounded safe patterns and validates form configuration', () => {
    expect(compileSafeFormPattern('^[A-Z]{2}[0-9]{4}$').test('AB1234')).toBe(true);
    expect(() => compileSafeFormPattern('^(a+)+$')).toThrow();
    expect(() => compileSafeFormPattern('^[a]{51}$')).toThrow();
    const form = newBaseForm();
    expect(() => baseFormSchema.parse({ ...form, fields: [...form.fields, { ...form.fields[0], id: crypto.randomUUID() }] })).toThrow();
    expect(() => baseFormSchema.parse({ ...form, filenameTemplate: '{{filename}}' })).toThrow();
    const validated = validateBaseForm(form, { [form.fields[0]!.id]: 'A/B' });
    expect(renderBaseFormFilename(form, validated, '/')).toBe('A-B');
  });

  it('gives older Bases a stable default field ID', () => {
    const definition = newBaseDefinition();
    const legacy = { version: definition.version, query: definition.query, formulas: definition.formulas, views: definition.views, activeViewId: definition.activeViewId };
    expect(baseDefinitionSchema.parse(legacy).form.fields[0]?.id).toBe(baseDefinitionSchema.parse(legacy).form.fields[0]?.id);
  });
});
