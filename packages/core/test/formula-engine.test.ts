import { describe, expect, it } from 'vitest';
import { compileFormula, type FormulaContext } from '../src';

const context: FormulaContext = { properties: { price: 12.5, quantity: 4, completed: false, name: 'noor note', priority: 'High', start: '2026-02-26', end: '2026-03-02', empty: null, 'Unit price': 5 }, fields: { title: 'Invoice' } };
const calculate = (expression: string, input = context) => compileFormula(expression).evaluate(input);

describe('safe formula interpreter', () => {
  it('handles arithmetic, precedence, unary operators, and finite results', () => {
    expect(calculate('price * quantity')).toBe(50);
    expect(calculate('(price + 2.5) * 2 - 5 % 2')).toBe(29);
    expect(calculate('-quantity + +price')).toBe(8.5);
    expect(calculate('1 / 0')).toBeNull();
    expect(calculate('1e308 * 1e308')).toBeNull();
  });

  it('supports comparison, boolean operators, and lazy conditional branches', () => {
    expect(calculate('completed ? "Done" : "Open"')).toBe('Open');
    expect(calculate('if(priority == "High", 3, 1)')).toBe(3);
    expect(calculate('price > 10 && !completed')).toBe(true);
    expect(calculate('price < 10 || quantity >= 4')).toBe(true);
    expect(calculate('false && (1 / 0 > 0)')).toBe(false);
    expect(calculate('true ? 1 : 1 / 0')).toBe(1);
    expect(calculate('if(false, 1 / 0, 7)')).toBe(7);
    expect(calculate('empty == null')).toBe(true);
  });

  it('handles null, missing values, property references, and built-in fields', () => {
    expect(calculate('missing ?? 9')).toBe(9);
    expect(calculate('coalesce(empty, missing, 7)')).toBe(7);
    expect(calculate('prop("Unit price") * quantity')).toBe(20);
    expect(calculate('title')).toBe('Invoice');
    expect(calculate('missing + 1')).toBeNull();
    expect(calculate('prop("missing")')).toBeNull();
  });

  it('supports bounded string and date helpers', () => {
    expect(calculate('upper(name)')).toBe('NOOR NOTE');
    expect(calculate('lower("ABC")')).toBe('abc');
    expect(calculate('trim("  memo  ")')).toBe('memo');
    expect(calculate('concat(upper(name), " ", quantity)')).toBe('NOOR NOTE 4');
    expect(calculate('contains(name, "note") && startsWith(name, "noor") && endsWith(name, "note")')).toBe(true);
    expect(calculate('length("A😀")')).toBe(2);
    expect(calculate('daysBetween(start, end)')).toBe(4);
    expect(calculate('addDays(start, 4)')).toBe('2026-03-02');
    expect(calculate('round(price / 3, 2)')).toBe(4.17);
    expect(calculate('abs(-5) + min(3, 2) + max(1, 4)')).toBe(11);
    expect(calculate('daysBetween("2026-02-30", end)')).toBeNull();
    expect(calculate('addDays(start, 1e20)')).toBeNull();
    expect(calculate('daysBetween("2026-03-01T23:00:00-05:00", "2026-03-03T04:00:00Z")')).toBe(1);
  });

  it('rejects code syntax, unknown functions, member access, and excessive input', () => {
    for (const source of ['window.alert(1)', 'constructor("return 1")()', 'price.__proto__', 'price["constructor"]', 'import("x")', 'Math.random()', 'price = 0', 'if(true, 1)', '1; 2', 'a'.repeat(501), '('.repeat(41) + '1' + ')'.repeat(41), '1+'.repeat(130) + '1']) {
      expect(() => compileFormula(source)).toThrow();
    }
  });

  it('treats malicious property content as inert data', () => {
    const input: FormulaContext = { properties: JSON.parse('{"price":"globalThis.hacked = true","__proto__":{"admin":true},"constructor":"attack","nested":{"run":"danger"}}') as Record<string, unknown> };
    expect(calculate('price', input)).toBe('globalThis.hacked = true');
    expect(calculate('price * 2', input)).toBeNull();
    expect(calculate('nested', input)).toBeNull();
    expect(calculate('prop("__proto__")', input)).toBeNull();
    expect(() => compileFormula('__proto__')).toThrow();
    expect((globalThis as { hacked?: boolean }).hacked).toBeUndefined();
    expect(calculate('upper(price)', { properties: { price: 'x'.repeat(10_000) } })).toHaveLength(4000);
  });
});
