import { describe, expect, it } from 'vitest';
import { applyMetadataDefaults, formatPropertyInput, inferPropertyType, inspectMetadata, matchingMetadataSchemas, metadataSchemaSchema, parsePropertyInput, updateFrontmatterProperty, type MetadataSchema } from '../src';

describe('portable metadata', () => {
  it('updates a known property while preserving unknown fields, nested data, body, and comments', () => {
    const original = '---\n# editorial note\nstatus: draft # keep this comment\ncustom:\n  owner: Mira\n---\n# Body\n';
    const updated = updateFrontmatterProperty(original, 'rating', 4.5, 'rating');
    expect(updated).toContain('# editorial note');
    expect(updated).toContain('custom:');
    expect(updated).toContain('owner: Mira');
    expect(updated).toContain('status: draft # keep this comment');
    expect(updated).toContain('# Body\n');
    expect(inspectMetadata(updated)).toMatchObject({ values: { status: 'draft', custom: { owner: 'Mira' }, rating: 4.5 }, types: { rating: 'rating' } });
    const removed = updateFrontmatterProperty(updated, 'rating', undefined);
    expect(inspectMetadata(removed).values.rating).toBeUndefined();
    expect(removed).toContain('custom:');
  });

  it('adds frontmatter to an ordinary Markdown note without changing its body', () => {
    const source = '# A note\nText';
    const updated = updateFrontmatterProperty(source, 'due', '2026-10-01', 'date');
    expect(updated.endsWith(source)).toBe(true);
    expect(inspectMetadata(updated).types.due).toBe('date');
    expect(() => updateFrontmatterProperty('---\nbroken: [\n---\nText', 'due', '2026-10-01')).toThrow(/Invalid YAML/);
  });

  it('validates supported input types and formats values for editing', () => {
    expect(parsePropertyInput('number', '3.5')).toBe(3.5);
    expect(parsePropertyInput('boolean', 'false')).toBe(false);
    expect(parsePropertyInput('multiSelect', 'Open, Review', ['Open', 'Review'])).toEqual(['Open', 'Review']);
    expect(parsePropertyInput('tag', 'research/ai')).toBe('#research/ai');
    expect(parsePropertyInput('noteReference', '[[Plan]]')).toBe('[[Plan]]');
    expect(() => parsePropertyInput('rating', '5.7')).toThrow();
    expect(() => parsePropertyInput('url', 'javascript:alert(1)')).toThrow();
    expect(formatPropertyInput(['One', 'Two'])).toBe('One, Two');
    expect(inferPropertyType('#nested/tag')).toBe('tag');
  });

  it('matches optional schema scopes and applies defaults only to missing fields', () => {
    const base = { id: '11111111-1111-4111-8111-111111111111', vaultId: '22222222-2222-4222-8222-222222222222', name: 'Research notes', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', fields: [{ name: 'status', type: 'singleSelect' as const, options: ['Draft', 'Done'], defaultValue: 'Draft' }] };
    const schemas = [metadataSchemaSchema.parse({ ...base, scope: 'folder', selector: '33333333-3333-4333-8333-333333333333' }), metadataSchemaSchema.parse({ ...base, id: '44444444-4444-4444-8444-444444444444', scope: 'noteType', selector: 'meeting' })] satisfies MetadataSchema[];
    expect(matchingMetadataSchemas({ folderId: base.id, properties: { type: 'meeting' } }, schemas)).toHaveLength(1);
    expect(inspectMetadata(applyMetadataDefaults('# Note', schemas)).values.status).toBe('Draft');
    expect(inspectMetadata(applyMetadataDefaults('---\nstatus: Done\n---\n# Note', schemas)).values.status).toBe('Done');
  });
});
