import { DB } from '../data/tables';
import { monaco, type Monaco } from './monaco';

export const KQL_LANGUAGE_ID = 'kql';

const OPERATORS = [
  'where',
  'project',
  'project-away',
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
  'by',
  'asc',
  'desc',
  'and',
  'or',
  'not',
  'let',
  'contains',
  'has',
  'startswith',
  'endswith',
  'in',
  'between',
];

const FUNCTIONS = [
  'count',
  'countif',
  'sum',
  'avg',
  'min',
  'max',
  'dcount',
  'ago',
  'now',
  'bin',
  'tolower',
  'toupper',
  'strlen',
  'strcat',
  'substring',
  'isempty',
  'isnotempty',
  'isnull',
  'isnotnull',
  'toint',
  'todouble',
  'tostring',
  'iff',
  'coalesce',
  'startofday',
  'hourofday',
  'round',
  'abs',
];

/** Tables the current mission is about, so completions stay relevant. */
let scopedTables: string[] = Object.keys(DB);

export function setCompletionScope(tables: string[]) {
  scopedTables = tables.length ? tables : Object.keys(DB);
}

let registered = false;

export function registerKql() {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: KQL_LANGUAGE_ID });

  monaco.languages.setMonarchTokensProvider(KQL_LANGUAGE_ID, {
    ignoreCase: true,
    keywords: OPERATORS,
    functions: FUNCTIONS,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\d+(\.\d+)?(ms|sec|min|hr|[dhms])\b/, 'number.timespan'],
        [/\d+(\.\d+)?/, 'number'],
        [/\|/, 'delimiter.pipe'],
        [
          /[a-zA-Z_][\w]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@functions': 'predefined',
              '@default': 'identifier',
            },
          },
        ],
        [/[=!<>~]+/, 'operator'],
        [/[-+*/%]/, 'operator'],
        [/[(),;]/, 'delimiter'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration(KQL_LANGUAGE_ID, {
    comments: { lineComment: '//' },
    brackets: [['(', ')']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  monaco.editor.defineTheme('kql-quest', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '7dd3fc', fontStyle: 'bold' },
      { token: 'predefined', foreground: 'c4b5fd' },
      { token: 'string', foreground: 'fcd34d' },
      { token: 'number', foreground: '86efac' },
      { token: 'number.timespan', foreground: '86efac' },
      { token: 'delimiter.pipe', foreground: 'f472b6', fontStyle: 'bold' },
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'e2e8f0' },
    ],
    colors: {
      'editor.background': '#0b1220',
      'editor.lineHighlightBackground': '#15213a',
      'editorLineNumber.foreground': '#334155',
      'editorCursor.foreground': '#22d3ee',
    },
  });

  monaco.languages.registerCompletionItemProvider(KQL_LANGUAGE_ID, {
    triggerCharacters: ['|', ' ', '.'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: Monaco.languages.CompletionItem[] = [];

      for (const name of scopedTables) {
        suggestions.push({
          label: name,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: name,
          detail: DB[name]?.description ?? 'Table',
          range,
        });
      }

      for (const op of OPERATORS) {
        suggestions.push({
          label: op,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: op,
          detail: 'operator',
          range,
        });
      }

      for (const fn of FUNCTIONS) {
        suggestions.push({
          label: `${fn}()`,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${fn}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'function',
          range,
        });
      }

      const seen = new Set<string>();
      for (const name of scopedTables) {
        for (const column of DB[name]?.columns ?? []) {
          if (seen.has(column.name)) continue;
          seen.add(column.name);
          suggestions.push({
            label: column.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: column.name,
            detail: `${name} · ${column.type}`,
            range,
          });
        }
      }

      return { suggestions };
    },
  });
}
