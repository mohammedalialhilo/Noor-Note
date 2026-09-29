/** A small expression interpreter. It never invokes note data as code. */
export type FormulaValue = string | number | boolean | null;
export interface FormulaContext { properties: Readonly<Record<string, unknown>>; fields?: Readonly<Record<string, unknown>> }
export interface FormulaProgram { evaluate(context: FormulaContext): FormulaValue }

type Token = { kind: 'number' | 'string' | 'name' | 'symbol' | 'end'; text: string; position: number };
type Node =
  | { kind: 'literal'; value: FormulaValue }
  | { kind: 'name'; name: string }
  | { kind: 'unary'; operator: string; right: Node }
  | { kind: 'binary'; operator: string; left: Node; right: Node }
  | { kind: 'conditional'; condition: Node; yes: Node; no: Node }
  | { kind: 'call'; name: string; args: Node[] };

const MAX_SOURCE = 500;
const MAX_TOKENS = 256;
const MAX_DEPTH = 40;
const MAX_STEPS = 2048;
const MAX_STRING = 4000;
const binaryPrecedence: Readonly<Record<string, number>> = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };
const functionNames = new Set(['if', 'coalesce', 'prop', 'upper', 'lower', 'trim', 'concat', 'contains', 'startsWith', 'endsWith', 'length', 'daysBetween', 'addDays', 'round', 'abs', 'min', 'max']);
const functionArity: Readonly<Record<string, readonly [number, number]>> = { if: [3, 3], coalesce: [1, 16], prop: [1, 1], upper: [1, 1], lower: [1, 1], trim: [1, 1], concat: [1, 16], contains: [2, 2], startsWith: [2, 2], endsWith: [2, 2], length: [1, 1], daysBetween: [2, 2], addDays: [2, 2], round: [1, 2], abs: [1, 1], min: [1, 16], max: [1, 16] };
const reservedNames = new Set(['true', 'false', 'null', 'undefined', 'constructor', '__proto__', 'prototype']);

function tokenize(source: string): Token[] {
  if (!source.trim() || source.length > MAX_SOURCE) throw new Error(`Formula must be 1–${MAX_SOURCE} characters`);
  const result: Token[] = [];
  let position = 0;
  while (position < source.length) {
    if (/\s/u.test(source[position]!)) { position++; continue; }
    const rest = source.slice(position);
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u);
    const name = rest.match(/^[A-Za-z_][A-Za-z_0-9]*/u);
    const symbol = rest.match(/^(?:\?\?|&&|\|\||==|!=|<=|>=|[()+\-*/%!,?:<>])/u);
    if (number) { result.push({ kind: 'number', text: number[0], position }); position += number[0].length; }
    else if (name) { result.push({ kind: 'name', text: name[0], position }); position += name[0].length; }
    else if (source[position] === '"' || source[position] === "'") {
      const quote = source[position]!;
      let end = position + 1;
      while (end < source.length && source[end] !== quote) { if (source[end] === '\\') end++; end++; }
      if (end >= source.length) throw new Error(`Unterminated string at ${position + 1}`);
      result.push({ kind: 'string', text: source.slice(position, end + 1), position });
      position = end + 1;
    } else if (symbol) { result.push({ kind: 'symbol', text: symbol[0], position }); position += symbol[0].length; }
    else throw new Error(`Unexpected character at ${position + 1}`);
    if (result.length > MAX_TOKENS) throw new Error('Formula has too many tokens');
  }
  result.push({ kind: 'end', text: '', position });
  return result;
}

function parseString(token: Token): string {
  if (token.text.startsWith('"')) {
    try { return JSON.parse(token.text) as string; } catch { throw new Error(`Invalid string at ${token.position + 1}`); }
  }
  return token.text.slice(1, -1).replace(/\\(['\\nrt])/gu, (_, escaped: string) => ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[escaped] ?? escaped);
}

function parse(source: string): Node {
  const tokens = tokenize(source);
  let cursor = 0;
  const peek = () => tokens[cursor]!;
  const take = () => tokens[cursor++]!;
  const expect = (symbol: string) => { if (peek().text !== symbol) throw new Error(`Expected “${symbol}” at ${peek().position + 1}`); take(); };
  const expression = (minimum = 0, depth = 0): Node => {
    if (depth > MAX_DEPTH) throw new Error('Formula is too deeply nested');
    let left: Node;
    const token = take();
    if (token.kind === 'number') {
      const value = Number(token.text);
      if (!Number.isFinite(value)) throw new Error('Number is outside the supported range');
      left = { kind: 'literal', value };
    } else if (token.kind === 'string') left = { kind: 'literal', value: parseString(token) };
    else if (token.kind === 'name') {
      if (token.text === 'true' || token.text === 'false' || token.text === 'null') left = { kind: 'literal', value: token.text === 'null' ? null : token.text === 'true' };
      else if (peek().text === '(') {
        if (!functionNames.has(token.text)) throw new Error(`Unknown function: ${token.text}`);
        take(); const args: Node[] = [];
        if (peek().text !== ')') { args.push(expression(0, depth + 1)); while (peek().text === ',') { take(); args.push(expression(0, depth + 1)); if (args.length > 16) throw new Error('Too many function arguments'); } }
        expect(')');
        const [minimum, maximum] = functionArity[token.text]!;
        if (args.length < minimum || args.length > maximum) throw new Error(`${token.text} needs ${minimum === maximum ? minimum : `${minimum}–${maximum}`} arguments`);
        left = { kind: 'call', name: token.text, args };
      } else {
        if (reservedNames.has(token.text)) throw new Error(`Reserved name: ${token.text}`);
        left = { kind: 'name', name: token.text };
      }
    } else if (token.text === '(') { left = expression(0, depth + 1); expect(')'); }
    else if (token.text === '-' || token.text === '+' || token.text === '!') left = { kind: 'unary', operator: token.text, right: expression(8, depth + 1) };
    else throw new Error(`Expected a value at ${token.position + 1}`);

    while (true) {
      const next = peek();
      if (next.text === '?' && minimum <= 0) {
        take(); const yes = expression(0, depth + 1); expect(':'); const no = expression(0, depth + 1);
        left = { kind: 'conditional', condition: left, yes, no }; continue;
      }
      const precedence = binaryPrecedence[next.text];
      if (precedence === undefined || precedence < minimum) break;
      take(); left = { kind: 'binary', operator: next.text, left, right: expression(precedence + 1, depth + 1) };
    }
    return left;
  };
  const root = expression();
  if (peek().kind !== 'end') throw new Error(`Unexpected token at ${peek().position + 1}`);
  return root;
}

function primitive(value: unknown): FormulaValue {
  if (typeof value === 'string') return value.length <= MAX_STRING ? value : value.slice(0, MAX_STRING);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'boolean' ? value : null;
}
function number(value: FormulaValue): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function string(value: FormulaValue): string | null { return typeof value === 'string' ? value : null; }
function truth(value: FormulaValue): boolean { return value === true || typeof value === 'number' && value !== 0 || typeof value === 'string' && value.length > 0; }
function finite(value: number): FormulaValue { return Number.isFinite(value) ? value : null; }
function date(value: FormulaValue): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(value)) return null;
  const day = value.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return time;
}
function safeString(value: string): FormulaValue { return value.length <= MAX_STRING ? value : value.slice(0, MAX_STRING); }

function evaluate(root: Node, context: FormulaContext): FormulaValue {
  let steps = 0;
  const run = (node: Node): FormulaValue => {
    if (++steps > MAX_STEPS) throw new Error('Formula exceeded its work limit');
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'name') {
      if (Object.hasOwn(context.properties, node.name)) return primitive(context.properties[node.name]);
      return context.fields && Object.hasOwn(context.fields, node.name) ? primitive(context.fields[node.name]) : null;
    }
    if (node.kind === 'unary') {
      const right = run(node.right);
      if (node.operator === '!') return !truth(right);
      const numeric = number(right);
      return numeric === null ? null : finite(node.operator === '-' ? -numeric : numeric);
    }
    if (node.kind === 'conditional') return run(truth(run(node.condition)) ? node.yes : node.no);
    if (node.kind === 'binary') {
      const left = run(node.left);
      if (node.operator === '??') return left === null ? run(node.right) : left;
      if (node.operator === '&&') return truth(left) ? truth(run(node.right)) : false;
      if (node.operator === '||') return truth(left) ? true : truth(run(node.right));
      const right = run(node.right);
      if (node.operator === '==' || node.operator === '!=') return node.operator === '==' ? left === right : left !== right;
      if (['<', '<=', '>', '>='].includes(node.operator)) {
        if (left === null || right === null || typeof left !== typeof right || typeof left === 'boolean') return false;
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        return node.operator === '<' ? comparison < 0 : node.operator === '<=' ? comparison <= 0 : node.operator === '>' ? comparison > 0 : comparison >= 0;
      }
      const a = number(left), b = number(right);
      if (a === null || b === null) return null;
      switch (node.operator) {
        case '+': return finite(a + b); case '-': return finite(a - b); case '*': return finite(a * b);
        case '/': return b === 0 ? null : finite(a / b); case '%': return b === 0 ? null : finite(a % b);
        default: return null;
      }
    }
    if (node.name === 'if') { if (node.args.length !== 3) throw new Error('if needs three arguments'); return run(truth(run(node.args[0]!)) ? node.args[1]! : node.args[2]!); }
    if (node.name === 'coalesce') { for (const arg of node.args) { const value = run(arg); if (value !== null) return value; } return null; }
    if (node.name === 'prop') {
      if (node.args.length !== 1) throw new Error('prop needs one argument');
      const key = string(run(node.args[0]!));
      return key && !reservedNames.has(key) && Object.hasOwn(context.properties, key) ? primitive(context.properties[key]) : null;
    }
    const args = node.args.map(run);
    const first = args[0], second = args[1];
    switch (node.name) {
      case 'upper': return args.length === 1 && string(first ?? null) !== null ? safeString(String(first).toUpperCase()) : null;
      case 'lower': return args.length === 1 && string(first ?? null) !== null ? safeString(String(first).toLowerCase()) : null;
      case 'trim': return args.length === 1 && string(first ?? null) !== null ? String(first).trim() : null;
      case 'concat': return args.every((value) => value !== null) ? safeString(args.map(String).join('')) : null;
      case 'contains': return args.length === 2 && typeof first === 'string' && typeof second === 'string' ? first.includes(second) : null;
      case 'startsWith': return args.length === 2 && typeof first === 'string' && typeof second === 'string' ? first.startsWith(second) : null;
      case 'endsWith': return args.length === 2 && typeof first === 'string' && typeof second === 'string' ? first.endsWith(second) : null;
      case 'length': return args.length === 1 && typeof first === 'string' ? [...first].length : null;
      case 'daysBetween': { const a = date(first ?? null), b = date(second ?? null); return args.length === 2 && a !== null && b !== null ? Math.round((b - a) / 86_400_000) : null; }
      case 'addDays': { const start = date(first ?? null), count = number(second ?? null); const result = start !== null && count !== null ? start + count * 86_400_000 : NaN; return Number.isInteger(count) && Number.isFinite(result) && Math.abs(result) <= 8.64e15 ? new Date(result).toISOString().slice(0, 10) : null; }
      case 'round': { const value = number(first ?? null), digits = args.length === 2 ? number(second ?? null) : 0; const factor = digits !== null ? 10 ** digits : Infinity; return value !== null && digits !== null && Number.isInteger(digits) && digits >= 0 && digits <= 10 ? finite(Math.round(value * factor) / factor) : null; }
      case 'abs': return args.length === 1 && number(first ?? null) !== null ? Math.abs(first as number) : null;
      case 'min': case 'max': { const values = args.map(number); return values.length && values.every((value) => value !== null) ? finite(node.name === 'min' ? Math.min(...values as number[]) : Math.max(...values as number[])) : null; }
      default: throw new Error('Unknown formula function');
    }
  };
  return primitive(run(root));
}

export function compileFormula(source: string): FormulaProgram {
  const root = parse(source);
  return { evaluate: (context) => evaluate(root, context) };
}
