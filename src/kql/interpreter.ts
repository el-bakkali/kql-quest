import type { Expr, NamedExpr, Query, SortKey } from './ast';
import { parse } from './parser';
import { KqlError, type ColType, type Column, type Database, type ResultTable, type Row, type Scalar } from './types';

export interface RunOptions {
  /** Fixed clock so `now()` / `ago()` stay deterministic across sessions. */
  now?: Date;
  maxRows?: number;
}

const AGGREGATES = new Set(['count', 'countif', 'sum', 'sumif', 'avg', 'min', 'max', 'dcount']);

interface Ctx {
  now: Date;
  vars: Map<string, Scalar>;
}

export function runQuery(text: string, db: Database, opts: RunOptions = {}): ResultTable {
  const query = parse(text);
  return execute(query, db, opts);
}

function execute(query: Query, db: Database, opts: RunOptions): ResultTable {
  const ctx: Ctx = { now: opts.now ?? new Date(), vars: new Map() };
  const maxRows = opts.maxRows ?? 5000;

  for (const binding of query.lets) {
    ctx.vars.set(binding.name.toLowerCase(), evalExpr(binding.expr, {}, ctx));
  }

  const table = lookupTable(db, query.source.name);
  if (!table) {
    const known = Object.values(db).map((t) => t.name).join(', ');
    throw new KqlError(
      `Unknown table "${query.source.name}". Available tables: ${known}.`,
      query.source.start,
      query.source.end,
    );
  }

  let columns: Column[] = table.columns.map((c) => ({ ...c }));
  let rows: Row[] = table.rows.map((r) => ({ ...r }));

  for (const stage of query.stages) {
    switch (stage.t) {
      case 'where':
        rows = rows.filter((row) => truthy(evalExpr(stage.pred, row, ctx)));
        break;

      case 'search': {
        const needle = stage.term.toLowerCase();
        rows = rows.filter((row) =>
          Object.values(row).some((v) => stringify(v).toLowerCase().includes(needle)),
        );
        break;
      }

      case 'project': {
        rows = rows.map((row) => {
          const out: Row = {};
          for (const col of stage.cols) out[col.name] = evalExpr(col.expr, row, ctx);
          return out;
        });
        columns = deriveColumns(stage.cols.map((c) => c.name), rows, columns);
        break;
      }

      case 'project-away': {
        const drop = new Set(stage.names.map((n) => n.toLowerCase()));
        columns = columns.filter((c) => !drop.has(c.name.toLowerCase()));
        rows = rows.map((row) => {
          const out: Row = {};
          for (const col of columns) out[col.name] = row[col.name] ?? null;
          return out;
        });
        break;
      }

      case 'extend': {
        rows = rows.map((row) => {
          const out: Row = { ...row };
          for (const col of stage.cols) out[col.name] = evalExpr(col.expr, out, ctx);
          return out;
        });
        const names = columns.map((c) => c.name);
        for (const col of stage.cols) {
          if (!names.some((n) => n.toLowerCase() === col.name.toLowerCase())) names.push(col.name);
        }
        columns = deriveColumns(names, rows, columns);
        break;
      }

      case 'summarize': {
        const result = summarize(stage.aggs, stage.by, rows, ctx);
        rows = result.rows;
        columns = deriveColumns(result.names, rows, columns);
        break;
      }

      case 'count':
        rows = [{ Count: rows.length }];
        columns = [{ name: 'Count', type: 'long' }];
        break;

      case 'distinct': {
        const seen = new Set<string>();
        const out: Row[] = [];
        for (const row of rows) {
          const picked: Row = {};
          for (const name of stage.names) picked[name] = readColumn(row, name);
          const key = stage.names.map((n) => canonical(picked[n])).join('\u0001');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(picked);
        }
        rows = out;
        columns = deriveColumns(stage.names, rows, columns);
        break;
      }

      case 'sort':
        rows = sortRows(rows, stage.keys, ctx);
        break;

      case 'top':
        rows = sortRows(rows, stage.keys, ctx).slice(0, stage.n);
        break;

      case 'take':
        rows = rows.slice(0, stage.n);
        break;

      case 'render':
        break;
    }
  }

  const truncated = rows.length > maxRows;
  return { columns, rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
}

function lookupTable(db: Database, name: string) {
  const direct = db[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  return Object.values(db).find((t) => t.name.toLowerCase() === lower);
}

function deriveColumns(names: string[], rows: Row[], previous: Column[]): Column[] {
  return names.map((name) => {
    const prior = previous.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const sample = rows.slice(0, 50).map((r) => r[name] ?? null);
    const inferred = inferType(sample);
    return { name, type: inferred === 'string' && prior ? prior.type : inferred };
  });
}

function inferType(values: Scalar[]): ColType {
  for (const value of values) {
    if (value === null) continue;
    if (value instanceof Date) return 'datetime';
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number') return Number.isInteger(value) ? 'long' : 'real';
    return 'string';
  }
  return 'string';
}

function summarize(aggs: NamedExpr[], by: NamedExpr[], rows: Row[], ctx: Ctx) {
  const groups = new Map<string, { keyValues: Row; members: Row[] }>();

  if (by.length === 0) {
    groups.set('', { keyValues: {}, members: rows });
  } else {
    for (const row of rows) {
      const keyValues: Row = {};
      for (const key of by) keyValues[key.name] = evalExpr(key.expr, row, ctx);
      const hash = by.map((k) => canonical(keyValues[k.name])).join('\u0001');
      let group = groups.get(hash);
      if (!group) {
        group = { keyValues, members: [] };
        groups.set(hash, group);
      }
      group.members.push(row);
    }
  }

  const out: Row[] = [];
  for (const group of groups.values()) {
    const row: Row = { ...group.keyValues };
    for (const agg of aggs) row[agg.name] = applyAggregate(agg.expr, group.members, ctx);
    out.push(row);
  }

  return { rows: out, names: [...by.map((b) => b.name), ...aggs.map((a) => a.name)] };
}

function applyAggregate(expr: Expr, members: Row[], ctx: Ctx): Scalar {
  if (expr.t !== 'call' || !AGGREGATES.has(expr.name)) {
    throw new KqlError(
      `"summarize" needs an aggregate such as count(), sum(), avg(), min(), max() or dcount().`,
      expr.t === 'call' ? expr.start : 0,
      expr.t === 'call' ? expr.end : 0,
    );
  }

  const values = () =>
    members
      .map((row) => evalExpr(expr.args[0], row, ctx))
      .filter((v): v is Exclude<Scalar, null> => v !== null);

  switch (expr.name) {
    case 'count':
      return members.length;
    case 'countif':
      return members.filter((row) => truthy(evalExpr(expr.args[0], row, ctx))).length;
    case 'dcount':
      return new Set(values().map(canonical)).size;
    case 'sum':
      return round(values().reduce<number>((acc, v) => acc + numeric(v), 0));
    case 'sumif':
      return round(
        members
          .filter((row) => truthy(evalExpr(expr.args[1], row, ctx)))
          .reduce<number>((acc, row) => acc + numeric(evalExpr(expr.args[0], row, ctx)), 0),
      );
    case 'avg': {
      const list = values();
      if (!list.length) return null;
      return round(list.reduce<number>((acc, v) => acc + numeric(v), 0) / list.length);
    }
    case 'min':
    case 'max': {
      const list = values();
      if (!list.length) return null;
      let best = list[0];
      for (const value of list.slice(1)) {
        const order = compareValues(value, best);
        if (expr.name === 'min' ? order < 0 : order > 0) best = value;
      }
      return best;
    }
    default:
      throw new KqlError(`Unsupported aggregate "${expr.name}".`, expr.start, expr.end);
  }
}

function sortRows(rows: Row[], keys: SortKey[], ctx: Ctx): Row[] {
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const left = evalExpr(key.expr, a, ctx);
      const right = evalExpr(key.expr, b, ctx);
      if (left === null && right === null) continue;
      if (left === null) return 1;
      if (right === null) return -1;
      const order = compareValues(left, right);
      if (order !== 0) return key.desc ? -order : order;
    }
    return 0;
  });
}

function readColumn(row: Row, name: string): Scalar {
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  const match = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return match ? row[match] : null;
}

function evalExpr(expr: Expr, row: Row, ctx: Ctx): Scalar {
  switch (expr.t) {
    case 'lit':
      return expr.value;
    case 'timespan':
      return expr.ms;
    case 'list':
      throw new KqlError('A list is only valid on the right side of "in".');
    case 'col': {
      if (expr.name in row) return row[expr.name];
      const lower = expr.name.toLowerCase();
      const match = Object.keys(row).find((k) => k.toLowerCase() === lower);
      if (match) return row[match];
      if (ctx.vars.has(lower)) return ctx.vars.get(lower)!;
      const known = Object.keys(row).join(', ');
      throw new KqlError(
        `Unknown column "${expr.name}".${known ? ` Available: ${known}.` : ''}`,
        expr.start,
        expr.end,
      );
    }
    case 'un': {
      const value = evalExpr(expr.e, row, ctx);
      if (expr.op === '-') return value === null ? null : -numeric(value);
      return !truthy(value);
    }
    case 'bin':
      return evalBinary(expr, row, ctx);
    case 'call':
      return evalCall(expr, row, ctx);
  }
}

function evalBinary(
  expr: Extract<Expr, { t: 'bin' }>,
  row: Row,
  ctx: Ctx,
): Scalar {
  const op = expr.op;

  if (op === 'and') return truthy(evalExpr(expr.l, row, ctx)) && truthy(evalExpr(expr.r, row, ctx));
  if (op === 'or') return truthy(evalExpr(expr.l, row, ctx)) || truthy(evalExpr(expr.r, row, ctx));

  const left = evalExpr(expr.l, row, ctx);

  if (op === 'in' || op === 'in~' || op === '!in' || op === '!in~') {
    if (expr.r.t !== 'list') throw new KqlError('"in" expects a parenthesised list.', expr.start, expr.end);
    const insensitive = op.endsWith('~');
    const hit = expr.r.items.some((item) => {
      const candidate = evalExpr(item, row, ctx);
      return insensitive
        ? stringify(left).toLowerCase() === stringify(candidate).toLowerCase()
        : looseEquals(left, candidate);
    });
    return op.startsWith('!') ? !hit : hit;
  }

  const right = evalExpr(expr.r, row, ctx);

  switch (op) {
    case '+': {
      if (left instanceof Date) return new Date(left.getTime() + numeric(right));
      if (typeof left === 'string' || typeof right === 'string') return stringify(left) + stringify(right);
      return round(numeric(left) + numeric(right));
    }
    case '-': {
      if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
      if (left instanceof Date) return new Date(left.getTime() - numeric(right));
      return round(numeric(left) - numeric(right));
    }
    case '*':
      return round(numeric(left) * numeric(right));
    case '/': {
      const divisor = numeric(right);
      return divisor === 0 ? null : round(numeric(left) / divisor);
    }
    case '%':
      return numeric(left) % numeric(right);
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '=~':
      return stringify(left).toLowerCase() === stringify(right).toLowerCase();
    case '!~':
      return stringify(left).toLowerCase() !== stringify(right).toLowerCase();
    case '<':
      return nullableCompare(left, right, (o) => o < 0);
    case '<=':
      return nullableCompare(left, right, (o) => o <= 0);
    case '>':
      return nullableCompare(left, right, (o) => o > 0);
    case '>=':
      return nullableCompare(left, right, (o) => o >= 0);
    case 'contains':
      return stringify(left).toLowerCase().includes(stringify(right).toLowerCase());
    case 'contains_cs':
      return stringify(left).includes(stringify(right));
    case '!contains':
      return !stringify(left).toLowerCase().includes(stringify(right).toLowerCase());
    case 'startswith':
      return stringify(left).toLowerCase().startsWith(stringify(right).toLowerCase());
    case '!startswith':
      return !stringify(left).toLowerCase().startsWith(stringify(right).toLowerCase());
    case 'endswith':
      return stringify(left).toLowerCase().endsWith(stringify(right).toLowerCase());
    case '!endswith':
      return !stringify(left).toLowerCase().endsWith(stringify(right).toLowerCase());
    case 'has':
      return hasWord(stringify(left), stringify(right), false);
    case 'has_cs':
      return hasWord(stringify(left), stringify(right), true);
    case '!has':
      return !hasWord(stringify(left), stringify(right), false);
    case 'matches':
      return new RegExp(stringify(right), 'i').test(stringify(left));
    default:
      throw new KqlError(`Unsupported operator "${op}".`, expr.start, expr.end);
  }
}

function evalCall(expr: Extract<Expr, { t: 'call' }>, row: Row, ctx: Ctx): Scalar {
  const arg = (i: number) => evalExpr(expr.args[i], row, ctx);
  const need = (n: number) => {
    if (expr.args.length < n) {
      throw new KqlError(`"${expr.name}()" needs ${n} argument(s).`, expr.start, expr.end);
    }
  };

  switch (expr.name) {
    case 'now':
      return ctx.now;
    case 'ago':
      need(1);
      return new Date(ctx.now.getTime() - numeric(arg(0)));
    case 'bin':
    case 'floor': {
      need(2);
      const value = arg(0);
      const size = numeric(arg(1));
      if (size === 0) return value;
      if (value instanceof Date) return new Date(Math.floor(value.getTime() / size) * size);
      return round(Math.floor(numeric(value) / size) * size);
    }
    case 'startofday': {
      need(1);
      const d = asDate(arg(0));
      return d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null;
    }
    case 'hourofday': {
      need(1);
      const d = asDate(arg(0));
      return d ? d.getUTCHours() : null;
    }
    case 'tolower':
      return stringify(arg(0)).toLowerCase();
    case 'toupper':
      return stringify(arg(0)).toUpperCase();
    case 'strlen':
      return stringify(arg(0)).length;
    case 'strcat':
      return expr.args.map((_, i) => stringify(arg(i))).join('');
    case 'substring': {
      need(2);
      const text = stringify(arg(0));
      const start = numeric(arg(1));
      return expr.args.length > 2 ? text.substr(start, numeric(arg(2))) : text.substring(start);
    }
    case 'isempty':
      return arg(0) === null || stringify(arg(0)) === '';
    case 'isnotempty':
      return !(arg(0) === null || stringify(arg(0)) === '');
    case 'isnull':
      return arg(0) === null;
    case 'isnotnull':
      return arg(0) !== null;
    case 'toint':
    case 'tolong':
      return Math.trunc(numeric(arg(0)));
    case 'todouble':
    case 'toreal':
      return numeric(arg(0));
    case 'tostring':
      return stringify(arg(0));
    case 'abs':
      return Math.abs(numeric(arg(0)));
    case 'round': {
      const digits = expr.args.length > 1 ? numeric(arg(1)) : 0;
      const factor = 10 ** digits;
      return Math.round(numeric(arg(0)) * factor) / factor;
    }
    case 'iff':
    case 'iif':
      need(3);
      return truthy(arg(0)) ? arg(1) : arg(2);
    case 'coalesce': {
      for (let i = 0; i < expr.args.length; i++) {
        const value = arg(i);
        if (value !== null && stringify(value) !== '') return value;
      }
      return null;
    }
    default:
      if (AGGREGATES.has(expr.name)) {
        throw new KqlError(
          `"${expr.name}()" is an aggregate — use it inside "summarize".`,
          expr.start,
          expr.end,
        );
      }
      throw new KqlError(`Unknown function "${expr.name}()".`, expr.start, expr.end);
  }
}

function hasWord(haystack: string, needle: string, caseSensitive: boolean): boolean {
  const source = caseSensitive ? haystack : haystack.toLowerCase();
  const term = caseSensitive ? needle : needle.toLowerCase();
  if (!term) return false;
  return source.split(/[^A-Za-z0-9]+/).includes(term);
}

function nullableCompare(a: Scalar, b: Scalar, test: (order: number) => boolean): boolean {
  if (a === null || b === null) return false;
  return test(compareValues(a, b));
}

export function compareValues(a: Scalar, b: Scalar): number {
  if (a instanceof Date || b instanceof Date) {
    const left = a instanceof Date ? a.getTime() : numeric(a);
    const right = b instanceof Date ? b.getTime() : numeric(b);
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const left = numeric(a);
    const right = numeric(b);
    if (Number.isNaN(left) || Number.isNaN(right)) {
      return stringify(a).localeCompare(stringify(b));
    }
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  return stringify(a).localeCompare(stringify(b));
}

function looseEquals(a: Scalar, b: Scalar): boolean {
  if (a === null || b === null) return a === b;
  if (a instanceof Date || b instanceof Date) return compareValues(a, b) === 0;
  if (typeof a === typeof b) return a === b;
  if (typeof a === 'number' || typeof b === 'number') return numeric(a) === numeric(b);
  return stringify(a) === stringify(b);
}

function truthy(value: Scalar): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value instanceof Date) return true;
  return value.length > 0;
}

function numeric(value: Scalar): number {
  if (value === null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  return Number(value);
}

function stringify(value: Scalar): string {
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asDate(value: Scalar): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Avoids float dust like 83.33000000000001 leaking into result comparisons. */
function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
}

export function canonical(value: Scalar): string {
  if (value === null) return '\u2205';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return String(round(value));
  return String(value);
}
