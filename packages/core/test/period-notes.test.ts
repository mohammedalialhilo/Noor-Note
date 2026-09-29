import { describe, expect, it } from 'vitest';
import { formatPeriodDate, markPeriodMarkdown, matchesPeriod, periodKey, periodNotesSettingsSchema, periodStart, shiftPeriod, validatePeriodRule, vaultSettingsSchema } from '../src';

describe('period notes', () => {
  it('uses ISO weeks across year boundaries and calendar-safe period shifts', () => {
    expect(periodKey('weekly', new Date(2025, 11, 29))).toBe('2026-W01');
    expect(periodKey('weekly', new Date(2027, 0, 1))).toBe('2026-W53');
    expect(periodStart('weekly', new Date(2026, 0, 1)).getDate()).toBe(29);
    expect(periodKey('quarterly', new Date(2026, 11, 30))).toBe('2026-Q4');
    expect(periodKey('monthly', shiftPeriod('monthly', new Date(2028, 0, 31), 1))).toBe('2028-02');
    expect(periodKey('daily', shiftPeriod('daily', new Date(2028, 1, 28), 1))).toBe('2028-02-29');
    expect(periodKey('yearly', shiftPeriod('yearly', new Date(2026, 8, 1), -1))).toBe('2025');
  });

  it('formats literal text, validates distinct safe filenames, and keeps old vault settings loadable', () => {
    expect(formatPeriodDate('weekly', new Date(2025, 11, 29), 'GGGG-[W]WW')).toBe('2026-W01');
    const defaults = periodNotesSettingsSchema.parse({});
    for (const kind of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const) expect(validatePeriodRule(kind, defaults[kind])).toEqual(defaults[kind]);
    expect(vaultSettingsSchema.parse({}).periodNotes).toEqual(defaults);
    expect(() => validatePeriodRule('daily', { ...defaults.daily, filenameFormat: 'yyyy' })).toThrow(/distinct/);
    expect(() => validatePeriodRule('monthly', { ...defaults.monthly, filenameFormat: 'yyyy/MM' })).toThrow(/safe/);
    expect(() => formatPeriodDate('daily', new Date(), 'yyyy-foo')).toThrow(/Unknown/);
    expect(() => formatPeriodDate('weekly', new Date(), 'GGGG-[W')).toThrow(/Unclosed/);
  });

  it('stores a stable period identity in portable YAML without replacing template content', () => {
    const markdown = markPeriodMarkdown('---\nstatus: Open\n---\n# Plan', 'monthly', new Date(2026, 8, 24));
    expect(markdown).toContain('status: Open');
    expect(markdown).toContain('noor_period_kind: monthly');
    expect(markdown).toContain('noor_period_key: 2026-09');
    expect(markdown).toContain('# Plan');
    expect(matchesPeriod({ noor_period_kind: 'monthly', noor_period_key: '2026-09' }, 'monthly', new Date(2026, 8, 1))).toBe(true);
  });
});
