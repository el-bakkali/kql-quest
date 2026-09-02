import { KqlError } from './types';

export type TokenKind = 'ident' | 'number' | 'string' | 'timespan' | 'op' | 'eof';

export interface Token {
  kind: TokenKind;
  text: string;
  /** Numeric value for `number`, milliseconds for `timespan`, unquoted body for `string`. */
  value?: string | number;
  start: number;
  end: number;
}

const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '=~',
  '!~',
  '<',
  '>',
  '=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  '[',
  ']',
  ',',
  '|',
  ';',
  '.',
];

const TIMESPAN_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
};

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (c === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const start = i;
      const quote = c;
      i++;
      let body = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          const esc = input[i + 1];
          body += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          i += 2;
          continue;
        }
        body += input[i++];
      }
      if (i >= input.length) {
        throw new KqlError('Unterminated string literal.', start, input.length);
      }
      i++;
      tokens.push({ kind: 'string', text: input.slice(start, i), value: body, start, end: i });
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(input[i + 1] ?? ''))) {
      const start = i;
      while (i < input.length && isDigit(input[i])) i++;
      if (input[i] === '.' && isDigit(input[i + 1] ?? '')) {
        i++;
        while (i < input.length && isDigit(input[i])) i++;
      }
      const numberText = input.slice(start, i);

      // A unit suffix glued to the number makes this a timespan: 30m, 1d, 500ms.
      let unitEnd = i;
      while (unitEnd < input.length && /[A-Za-z]/.test(input[unitEnd])) unitEnd++;
      const unit = input.slice(i, unitEnd);
      if (unit && TIMESPAN_UNITS[unit.toLowerCase()] !== undefined) {
        const ms = Number(numberText) * TIMESPAN_UNITS[unit.toLowerCase()];
        tokens.push({
          kind: 'timespan',
          text: input.slice(start, unitEnd),
          value: ms,
          start,
          end: unitEnd,
        });
        i = unitEnd;
        continue;
      }

      tokens.push({
        kind: 'number',
        text: numberText,
        value: Number(numberText),
        start,
        end: i,
      });
      continue;
    }

    // Negated word operators: !contains, !has, !in, !startswith ...
    if (c === '!' && isIdentStart(input[i + 1] ?? '')) {
      const start = i;
      i++;
      while (i < input.length && isIdentPart(input[i])) i++;
      const text = input.slice(start, i);
      tokens.push({ kind: 'op', text: text.toLowerCase(), start, end: i });
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < input.length && isIdentPart(input[i])) i++;
      let text = input.slice(start, i);
      // `in~` / `!in~` / `has_cs` style suffixes
      if (input[i] === '~' && /^(in|has|contains|startswith|endswith)$/i.test(text)) {
        i++;
        text = input.slice(start, i);
      }
      tokens.push({ kind: 'ident', text, start, end: i });
      continue;
    }

    const op = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (op) {
      tokens.push({ kind: 'op', text: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }

    throw new KqlError(`Unexpected character "${c}".`, i, i + 1);
  }

  tokens.push({ kind: 'eof', text: '', start: input.length, end: input.length });
  return tokens;
}
