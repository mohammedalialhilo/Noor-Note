import { describe, expect, it } from 'vitest';
import { applyTemplateProperties, configuredTemplateId, isTemplateNote, localDateStamp, renderTemplate, templateBody, templateSettingsSchema, validateTemplateSettings } from '../src';

const now = new Date(2026, 8, 23, 14, 7);
const context = { title: 'Plan', filename: 'Plan.md', folder: '/Projects', selection: 'selected', clipboard: 'copied', now, properties: { status: 'Open', priority: 3 } };

describe('template engine', () => {
  it('renders every built-in variable using local date and note context', () => {
    expect(localDateStamp(now)).toBe('2026-09-23');
    expect(renderTemplate('{{date}} {{time}} {{title}} {{filename}} {{folder}} {{selection}} {{clipboard}} {{year}} {{month}} {{day}}', context))
      .toBe('2026-09-23 14:07 Plan Plan.md /Projects selected copied 2026 09 23');
  });

  it('evaluates bounded functions without executing JavaScript', () => {
    expect(renderTemplate('{{dateFormat("yyyy/MM/dd HH:mm")}} {{upper(title)}} {{lower("ABC")}} {{trim("  x  ")}} {{titleCase("hello world")}} {{property("status")}} {{if(eq(property("status"), "Open"), "Do", "Done")}}', context))
      .toBe('2026/09/23 14:07 PLAN abc x Hello World Open Do');
    expect(renderTemplate('{{if(and(true, not(false)), "yes", "no")}} {{contains(title, "la")}}', context)).toBe('yes true');
    expect(() => renderTemplate('{{constructor.constructor("return 1")()}}', context)).toThrow();
    expect(() => renderTemplate('{{property("__proto__")}}', context)).toThrow();
    expect(() => renderTemplate('{{unknown}}', context)).toThrow('Unknown template variable');
    expect(() => renderTemplate('{{dateFormat("yyyy<script>")}}', context)).toThrow();
  });

  it('merges template properties without replacing existing fields or comments', () => {
    const source = '---\nstatus: Done\nowner: Ali\n---\n# {{title}}';
    const target = '---\n# Keep this comment\nstatus: Open\n---\nBody';
    const merged = applyTemplateProperties(target, renderTemplate(source, context));
    expect(merged).toContain('# Keep this comment');
    expect(merged).toContain('status: Open');
    expect(merged).toContain('owner: Ali');
    expect(merged).toContain('Body');
    expect(templateBody(source)).toBe('# {{title}}');
    expect(applyTemplateProperties(target, 'No YAML')).toBe(target);
  });

  it('resolves nested folder, Base, and daily rules in priority order', () => {
    const [templateFolderId, projectId, childId, baseId, defaultId, folderId, dailyId, baseTemplateId] = Array.from({ length: 8 }, () => crypto.randomUUID()) as [string, string, string, string, string, string, string, string];
    const folders = [{ id: templateFolderId, parentId: null }, { id: projectId, parentId: null }, { id: childId, parentId: projectId }];
    const notes = [defaultId, folderId, dailyId, baseTemplateId].map((id) => ({ id, folderId: templateFolderId }));
    const settings = templateSettingsSchema.parse({ folderId: templateFolderId, defaultTemplateId: defaultId, dailyTemplateId: dailyId, folderTemplates: { [projectId]: folderId }, baseTemplates: { [baseId]: baseTemplateId } });
    expect(isTemplateNote(notes[0]!, folders, templateFolderId)).toBe(true);
    expect(configuredTemplateId(settings, childId, folders)).toBe(folderId);
    expect(configuredTemplateId(settings, null, folders)).toBe(defaultId);
    expect(configuredTemplateId(settings, childId, folders, { baseId })).toBe(baseTemplateId);
    expect(configuredTemplateId(settings, childId, folders, { daily: true })).toBe(dailyId);
    expect(validateTemplateSettings(settings, notes, folders, [baseId])).toEqual(settings);
    expect(() => validateTemplateSettings({ ...settings, defaultTemplateId: crypto.randomUUID() }, notes, folders, [baseId])).toThrow();
  });
});
