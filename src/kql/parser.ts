import type { Expr, NamedExpr, Query, SortKey, Stage } from './ast';
import { tokenize, type Token } from './tokenizer';
import { KqlError } from './types';

const WORD_COMPARISONS = new Set([
  'contains',
  'contains_cs',
  '!contains',
  'has',
  'has_cs',
  '!has',
  'startswith',
  '!startswith',
  'endswith',
  '!endswith',
  'in',
  'in~',
  '!in',
  '!in~',
  'matches',
]);

const STAGE_KEYWORDS = new Set([
  'where',
  'filter',
  'project',
  'extend',
  'summarize',
  'count',
  'take',
  'limit',
  'top',
  'sort',
  'order',
  'distinct',
  'search',
  'render',
]);

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private atWord(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'ident' && token.text.toLowerCase() === word;
  }

  private atOp(op: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'op' && token.text === op;
  }

  private eatOp(op: string): boolean {
    if (this.atOp(op)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private eatWord(word: string): boolean {
    if (this.atWord(word)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectOp(op: string): Token {
    if (!this.atOp(op)) this.fail(`Expected "${op}".`);
    return this.next();
  }

  private expectIdent(what: string): Token {
    const token = this.peek();
    if (token.kind !== 'ident') this.fail(`Expected ${what}.`);
    return this.next();
  }

  private fail(message: string): never {
    const token = this.peek();
    const found = token.kind === 'eof' ? 'end of query' : `"${token.text}"`;
    throw new KqlError(`${message} Found ${found}.`, token.start, token.end);
  }

  parseQuery(): Query {
    const lets: NamedExpr[] = [];
    while (this.atWord('let')) {
      this.next();
      const name = this.expectIdent('a variable name').text;
      this.expectOp('=');
      const expr = this.parseExpr();
      this.eatOp(';');
      lets.push({ name, expr });
    }

    const sourceToken = this.peek();
    if (sourceToken.kind !== 'ident') {
      this.fail('A query must start with a table name.');
    }
    this.next();
    const source = { name: sourceToken.text, start: sourceToken.start, end: sourceToken.end };

    const stages: Stage[] = [];
    while (this.eatOp('|')) {
      stages.push(this.parseStage());
    }

    if (this.peek().kind !== 'eof') {
      this.fail('Expected "|" before the next operator.');
    }

    return { lets, source, stages };
  }

  private parseStage(): Stage {
    const token = this.peek();
    if (token.kind !== 'ident') this.fail('Expected an operator after "|".');
    const keyword = token.text.toLowerCase();

    if (!STAGE_KEYWORDS.has(keyword)) {
      throw new KqlError(
        `Unknown operator "${token.text}". This game supports: ${[...STAGE_KEYWORDS].join(', ')}.`,
        token.start,
        token.end,
      );
    }
    this.next();

    switch (keyword) {
      case 'where':
      case 'filter':
        return { t: 'where', pred: this.parseExpr() };

      case 'project': {
        if (this.atOp('-') && this.atWord('away', 1)) {
          this.next();
          this.next();
          return { t: 'project-away', names: this.parseNameList() };
        }
        return { t: 'project', cols: this.parseNamedList() };
      }

      case 'extend':
        return { t: 'extend', cols: this.parseNamedList() };

      case 'summarize': {
        const aggs: NamedExpr[] = [];
        if (!this.atWord('by')) {
          aggs.push(...this.parseNamedList());
        }
        const by: NamedExpr[] = this.eatWord('by') ? this.parseNamedList() : [];
        return { t: 'summarize', aggs, by };
      }

      case 'count':
        return { t: 'count' };

      case 'take':
      case 'limit': {
        const n = this.peek();
        if (n.kind !== 'number') this.fail('Expected a row count.');
        this.next();
        return { t: 'take', n: Number(n.value) };
      }

      case 'top': {
        const n = this.peek();
        if (n.kind !== 'number') this.fail('Expected a row count.');
        this.next();
        if (!this.eatWord('by')) this.fail('Expected "by" after "top N".');
        return { t: 'top', n: Number(n.value), keys: this.parseSortKeys() };
      }

      case 'sort':
      case 'order': {
        if (!this.eatWord('by')) this.fail(`Expected "by" after "${keyword}".`);
        return { t: 'sort', keys: this.parseSortKeys() };
      }

      case 'distinct':
        return { t: 'distinct', names: this.parseNameList() };

      case 'search': {
        const term = this.peek();
        if (term.kind !== 'string') this.fail('Expected a quoted search term.');
        this.next();
        return { t: 'search', term: String(term.value) };
      }

      default: {
        // render: accepted and ignored, so pasted queries still run.
        while (this.peek().kind !== 'eof' && !this.atOp('|')) this.next();
        return { t: 'render' };
      }
    }
  }

  private parseSortKeys(): SortKey[] {
    const keys: SortKey[] = [];
    do {
      const expr = this.parseExpr();
      let desc = true;
      if (this.eatWord('asc')) desc = false;
      else if (this.eatWord('desc')) desc = true;
      this.eatWord('nulls');
      this.eatWord('first');
      this.eatWord('last');
      keys.push({ expr, desc });
    } while (this.eatOp(','));
    return keys;
  }

  private parseNameList(): string[] {
    const names: string[] = [];
    do {
      names.push(this.expectIdent('a column name').text);
    } while (this.eatOp(','));
    return names;
  }

  private parseNamedList(): NamedExpr[] {
    const items: NamedExpr[] = [];
    do {
      if (this.peek().kind === 'ident' && this.atOp('=', 1)) {
        const name = this.next().text;
        this.next();
        items.push({ name, expr: this.parseExpr() });
      } else {
        const expr = this.parseExpr();
        items.push({ name: defaultName(expr), expr });
      }
    } while (this.eatOp(','));
    return items;
  }

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.atWord('or')) {
      const token = this.next();
      const right = this.parseAnd();
      left = { t: 'bin', op: 'or', l: left, r: right, start: token.start, end: token.end };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseComparison();
    while (this.atWord('and')) {
      const token = this.next();
      const right = this.parseComparison();
      left = { t: 'bin', op: 'and', l: left, r: right, start: token.start, end: token.end };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    for (;;) {
      const token = this.peek();
      const text = token.text.toLowerCase();
      const isSymbolic =
        token.kind === 'op' && ['==', '!=', '<', '<=', '>', '>=', '=~', '!~'].includes(token.text);
      const isWord =
        (token.kind === 'ident' || token.kind === 'op') && WORD_COMPARISONS.has(text);
      if (!isSymbolic && !isWord) return left;

      this.next();
      const right = text === 'in' || text === 'in~' || text === '!in' || text === '!in~'
        ? this.parseList()
        : this.parseAdditive();
      left = {
        t: 'bin',
        op: isSymbolic ? token.text : text,
        l: left,
        r: right,
        start: token.start,
        end: token.end,
      };
    }
  }

  private parseList(): Expr {
    this.expectOp('(');
    const items: Expr[] = [];
    if (!this.atOp(')')) {
      do {
        items.push(this.parseExpr());
      } while (this.eatOp(','));
    }
    this.expectOp(')');
    return { t: 'list', items };
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.atOp('+') || this.atOp('-')) {
      const token = this.next();
      const right = this.parseMultiplicative();
      left = { t: 'bin', op: token.text, l: left, r: right, start: token.start, end: token.end };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.atOp('*') || this.atOp('/') || this.atOp('%')) {
      const token = this.next();
      const right = this.parseUnary();
      left = { t: 'bin', op: token.text, l: left, r: right, start: token.start, end: token.end };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.atOp('-')) {
      this.next();
      return { t: 'un', op: '-', e: this.parseUnary() };
    }
    if (this.atWord('not')) {
      this.next();
      return { t: 'un', op: 'not', e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.peek();

    if (token.kind === 'number') {
      this.next();
      return { t: 'lit', value: Number(token.value) };
    }
    if (token.kind === 'string') {
      this.next();
      return { t: 'lit', value: String(token.value) };
    }
    if (token.kind === 'timespan') {
      this.next();
      return { t: 'timespan', ms: Number(token.value) };
    }
    if (this.atOp('(')) {
      this.next();
      const inner = this.parseExpr();
      this.expectOp(')');
      return inner;
    }
    if (token.kind === 'ident') {
      const lower = token.text.toLowerCase();
      if (lower === 'true' || lower === 'false') {
        this.next();
        return { t: 'lit', value: lower === 'true' };
      }
      if (lower === 'null') {
        this.next();
        return { t: 'lit', value: null };
      }
      this.next();
      if (this.atOp('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.atOp(')')) {
          do {
            args.push(this.parseExpr());
          } while (this.eatOp(','));
        }
        const close = this.expectOp(')');
        return { t: 'call', name: lower, args, start: token.start, end: close.end };
      }
      return { t: 'col', name: token.text, start: token.start, end: token.end };
    }

    this.fail('Expected a value, column or function.');
  }
}

function defaultName(expr: Expr): string {
  if (expr.t === 'col') return expr.name;
  if (expr.t === 'call') {
    const arg = expr.args[0];
    const suffix = arg && arg.t === 'col' ? arg.name : '';
    return `${expr.name}_${suffix}`;
  }
  return 'Column1';
}

export function parse(text: string): Query {
  const trimmed = text.trim();
  if (!trimmed) throw new KqlError('Write a query to run.', 0, 0);
  return new Parser(tokenize(text)).parseQuery();
}
