import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { Level } from '../data/levels';
import { DB } from '../data/tables';
import { grade, resultMatches, runAgainstFixtures } from '../engine/grade';
import { progress } from '../engine/progress';
import type { ResultTable, Scalar } from '../kql';
import { isTouchDevice } from '../game/virtualInput';
import { KQL_LANGUAGE_ID, registerKql, setCompletionScope } from './kqlLanguage';
import { monaco, type Monaco } from './monaco';

(self as unknown as { MonacoEnvironment: Monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

const MAX_DISPLAY_ROWS = 100;

type TabName = 'brief' | 'query' | 'result';

/** Everything you need to write the level solutions without a physical keyboard. */
const KEYPAD: Array<{ label: string; text: string }> = [
  { label: '\u21b5 |', text: '\n| ' },
  { label: 'where', text: 'where ' },
  { label: 'project', text: 'project ' },
  { label: 'summarize', text: 'summarize ' },
  { label: 'count()', text: 'count()' },
  { label: 'by', text: 'by ' },
  { label: 'take', text: 'take ' },
  { label: 'top', text: 'top ' },
  { label: 'sort by', text: 'sort by ' },
  { label: 'desc', text: 'desc' },
  { label: 'avg()', text: 'avg()' },
  { label: 'dcount()', text: 'dcount()' },
  { label: '==', text: ' == ' },
  { label: '!=', text: ' != ' },
  { label: '>', text: ' > ' },
  { label: '=', text: ' = ' },
  { label: 'and', text: ' and ' },
  { label: '""', text: '""' },
  { label: ',', text: ', ' },
];

let root: HTMLDivElement | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let model: Monaco.editor.ITextModel | null = null;
let resolveOpen: ((solved: boolean) => void) | null = null;
let activeLevel: Level | null = null;
let solvedThisSession = false;
let liveTimer = 0;

const el = <T extends HTMLElement>(selector: string): T => root!.querySelector(selector) as T;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Turns `backticked` fragments in mission text into styled code spans, safely. */
function withInlineCode(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function buildOverlay() {
  root = document.createElement('div');
  root.className = 'terminal-overlay';
  root.hidden = true;
  root.innerHTML = `
    <div class="terminal-panel" role="dialog" aria-modal="true" aria-label="KQL terminal">
      <header class="terminal-head">
        <div>
          <span class="mission-badge"></span>
          <h2 class="mission-name"></h2>
        </div>
        <button class="ghost-btn close-btn" type="button">Close (Esc)</button>
      </header>
      <nav class="terminal-tabs" role="tablist">
        <button class="tab-btn" type="button" data-tab="brief">Brief</button>
        <button class="tab-btn" type="button" data-tab="query">Query</button>
        <button class="tab-btn" type="button" data-tab="result">Result</button>
      </nav>
      <div class="terminal-body tab-brief">
        <aside class="brief-pane">
          <p class="mission-brief"></p>
          <div class="objective-box"><strong>Objective</strong><span class="objective-text"></span></div>
          <div class="checklist-pane">
            <strong>Checks</strong>
            <ul class="checklist"></ul>
          </div>
          <div class="schema-pane"></div>
          <div class="hint-pane">
            <button class="ghost-btn hint-btn" type="button">Reveal a hint (-25 XP)</button>
            <ol class="hint-list"></ol>
          </div>
          <p class="reference-note"></p>
        </aside>
        <section class="work-pane">
          <div class="editor-host"></div>
          <div class="kql-keypad"></div>
          <div class="action-bar">
            <button class="primary-btn run-btn" type="button">Run<span class="shortcut">&nbsp;<kbd>Ctrl</kbd>+<kbd>Enter</kbd></span></button>
            <button class="ghost-btn reset-btn" type="button">Reset</button>
            <button class="ghost-btn solution-btn" type="button">Show solution</button>
            <button class="primary-btn continue-btn" type="button" hidden>Continue &rarr;</button>
          </div>
          <div class="status-line" role="status"></div>
          <div class="clue-box" hidden>
            <span class="clue-tag">Evidence recovered</span>
            <p class="clue-text"></p>
          </div>
          <div class="result-pane"></div>
        </section>
      </div>
    </div>`;
  document.body.appendChild(root);

  el('.close-btn').addEventListener('click', () => close());
  el('.run-btn').addEventListener('click', () => run());
  el('.reset-btn').addEventListener('click', () => {
    if (activeLevel) editor?.setValue(activeLevel.starter);
    editor?.focus();
  });
  el('.solution-btn').addEventListener('click', () => {
    if (!activeLevel) return;
    editor?.setValue(activeLevel.solution);
    progress.useHint(activeLevel.id);
    setStatus('Solution loaded. Run it to see what it does, then try to explain it out loud.', 'info');
  });
  el('.hint-btn').addEventListener('click', () => revealHint());
  el('.continue-btn').addEventListener('click', () => close());

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
    button.addEventListener('click', () => setTab(button.dataset.tab as TabName));
  }

  const keypad = el('.kql-keypad');
  for (const key of KEYPAD) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keypad-btn';
    button.textContent = key.label;
    // pointerdown, so the editor never loses focus to the button
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      editor?.trigger('keypad', 'type', { text: key.text });
      editor?.focus();
    });
    keypad.appendChild(button);
  }

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
}

function ensureEditor() {
  if (editor) return;
  registerKql();
  model = monaco.editor.createModel('', KQL_LANGUAGE_ID);
  editor = monaco.editor.create(el('.editor-host'), {
    model,
    theme: 'kql-quest',
    // 16px keeps iOS from zooming the page when the editor takes focus.
    fontSize: isTouchDevice() ? 16 : 15,
    lineHeight: isTouchDevice() ? 26 : 24,
    fontFamily: 'Cascadia Code, Consolas, monospace',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    padding: { top: 12, bottom: 12 },
    automaticLayout: true,
    tabSize: 2,
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run());
  editor.onDidChangeModelContent(() => {
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(updateLive, 320);
  });
}

/** Flexbox-Froggy style feedback: the checks tick over as you type. */
function renderChecklist(level: Level, text: string, matched: boolean | null) {
  const list = el<HTMLUListElement>('.checklist');
  list.innerHTML = '';

  const items: Array<{ label: string; done: boolean }> = level.requires.map((requirement) => ({
    label: requirement.message.replace(/^Use /, 'Uses ').replace(/\.$/, ''),
    done: requirement.pattern.test(text),
  }));
  items.push({ label: 'Result matches the expected answer', done: matched === true });

  for (const item of items) {
    const li = document.createElement('li');
    li.className = item.done ? 'done' : '';
    const mark = document.createElement('span');
    mark.className = 'check-mark';
    mark.textContent = item.done ? '\u2713' : '\u25cb';
    const label = document.createElement('span');
    label.innerHTML = withInlineCode(item.label);
    li.append(mark, label);
    list.appendChild(li);
  }
}

function updateLive() {
  if (!activeLevel || !editor || root?.hidden) return;
  const text = editor.getValue();
  const { result } = runAgainstFixtures(text);
  if (result) renderResult(result);
  renderChecklist(activeLevel, text, result ? resultMatches(activeLevel, result) : null);
}

function renderSchema(level: Level) {
  const host = el('.schema-pane');
  host.innerHTML = '<strong>Schema</strong>';

  for (const tableName of level.tables) {
    const table = DB[tableName];
    if (!table) continue;

    const block = document.createElement('div');
    block.className = 'schema-table';

    const title = document.createElement('div');
    title.className = 'schema-title';
    title.textContent = `${table.name}  ·  ${table.rows.length} rows`;
    block.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'schema-desc';
    desc.textContent = table.description;
    block.appendChild(desc);

    const list = document.createElement('div');
    list.className = 'schema-cols';
    for (const column of table.columns) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'col-chip';
      chip.title = `Insert ${column.name}`;
      chip.innerHTML = `${escapeHtml(column.name)}<span>${escapeHtml(column.type)}</span>`;
      chip.addEventListener('click', () => {
        editor?.trigger('schema', 'type', { text: column.name });
        editor?.focus();
      });
      list.appendChild(chip);
    }
    block.appendChild(list);
    host.appendChild(block);
  }
}

function renderHints(level: Level) {
  const list = el<HTMLOListElement>('.hint-list');
  list.innerHTML = '';
  const used = Math.min(progress.hintsUsed(level.id), level.hints.length);
  for (let i = 0; i < used; i++) {
    const item = document.createElement('li');
    item.innerHTML = withInlineCode(level.hints[i]);
    list.appendChild(item);
  }
  const button = el<HTMLButtonElement>('.hint-btn');
  button.disabled = used >= level.hints.length;
  button.textContent = used >= level.hints.length ? 'No hints left' : 'Reveal a hint (-25 XP)';
}

function revealHint() {
  if (!activeLevel) return;
  const used = progress.hintsUsed(activeLevel.id);
  if (used >= activeLevel.hints.length) return;
  progress.useHint(activeLevel.id);
  renderHints(activeLevel);
}

function setStatus(message: string, tone: 'info' | 'good' | 'bad') {
  const line = el('.status-line');
  line.innerHTML = withInlineCode(message);
  line.className = `status-line ${tone}`;
}

function setTab(tab: TabName) {
  const body = el('.terminal-body');
  body.classList.remove('tab-brief', 'tab-query', 'tab-result');
  body.classList.add(`tab-${tab}`);
  for (const button of Array.from(root!.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  if (tab === 'query') editor?.layout();
}

function formatCell(value: Scalar): string {
  if (value === null) return '\u2205';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('.000Z', 'Z');
  if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6);
  return String(value);
}

function renderResult(result: ResultTable | undefined) {
  const host = el('.result-pane');
  host.innerHTML = '';
  if (!result) return;

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} · ${result.columns.length} column${result.columns.length === 1 ? '' : 's'}`;
  host.appendChild(meta);

  const wrapper = document.createElement('div');
  wrapper.className = 'result-scroll';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of result.columns) {
    const th = document.createElement('th');
    th.textContent = column.name;
    const type = document.createElement('span');
    type.textContent = column.type;
    th.appendChild(type);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of result.rows.slice(0, MAX_DISPLAY_ROWS)) {
    const tr = document.createElement('tr');
    for (const column of result.columns) {
      const td = document.createElement('td');
      const value = row[column.name] ?? null;
      td.textContent = formatCell(value);
      if (value === null) td.className = 'null-cell';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);
  host.appendChild(wrapper);

  if (result.rows.length > MAX_DISPLAY_ROWS) {
    const note = document.createElement('div');
    note.className = 'result-meta';
    note.textContent = `Showing the first ${MAX_DISPLAY_ROWS} rows.`;
    host.appendChild(note);
  }
}

function markError(failure?: { start: number; end: number; message: string }) {
  if (!model) return;
  if (!failure) {
    monaco.editor.setModelMarkers(model, 'kql', []);
    return;
  }
  const start = model.getPositionAt(failure.start);
  const end = model.getPositionAt(Math.max(failure.end, failure.start + 1));
  monaco.editor.setModelMarkers(model, 'kql', [
    {
      severity: monaco.MarkerSeverity.Error,
      message: failure.message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    },
  ]);
}

function run() {
  if (!activeLevel || !editor) return;
  const text = editor.getValue();
  const outcome = grade(activeLevel, text);

  renderResult(outcome.result);
  markError(outcome.status === 'error' ? outcome.failure : undefined);
  renderChecklist(
    activeLevel,
    text,
    outcome.result ? resultMatches(activeLevel, outcome.result) : null,
  );

  if (outcome.status === 'solved') {
    solvedThisSession = true;
    setStatus(`Solved \u2014 ${outcome.message}`, 'good');
    revealClue(activeLevel);
    el<HTMLButtonElement>('.continue-btn').hidden = false;
    el<HTMLButtonElement>('.continue-btn').focus();
    root!.classList.add('solved');
    setTab('result');
  } else {
    setStatus(outcome.message, 'bad');
    if (outcome.status === 'wrong') setTab('result');
  }
}

function revealClue(level: Level) {
  const box = el<HTMLDivElement>('.clue-box');
  el('.clue-text').textContent = level.clue;
  box.hidden = false;
}

function close() {
  if (!root) return;
  root.hidden = true;
  root.classList.remove('solved');
  const done = solvedThisSession;
  activeLevel = null;
  resolveOpen?.(done);
  resolveOpen = null;
}

export function openTerminal(level: Level, missionIndex: number, missionTotal: number): Promise<boolean> {
  if (!root) buildOverlay();
  ensureEditor();

  activeLevel = level;
  solvedThisSession = false;
  setCompletionScope(level.tables);

  el('.mission-badge').textContent = `World ${level.world} · Mission ${missionIndex} of ${missionTotal} · ${level.xp} XP`;
  el('.mission-name').textContent = level.name;
  el('.mission-brief').innerHTML = withInlineCode(level.brief);
  el('.objective-text').innerHTML = withInlineCode(level.objective);
  el('.reference-note').textContent = `Reading: ${level.reference}`;
  el<HTMLButtonElement>('.continue-btn').hidden = true;
  el<HTMLDivElement>('.clue-box').hidden = true;

  renderSchema(level);
  renderHints(level);
  renderResult(undefined);
  renderChecklist(level, level.starter, null);
  markError(undefined);

  const alreadySolved = progress.isSolved(level.id);
  setStatus(
    alreadySolved
      ? 'You already cleared this terminal. Feel free to experiment.'
      : 'Write your query, then run it. Wrong answers cost nothing.',
    'info',
  );

  root!.hidden = false;
  setTab('brief');
  editor!.setValue(level.starter);
  editor!.layout();
  if (!isTouchDevice()) editor!.focus();
  editor!.setPosition(editor!.getModel()!.getFullModelRange().getEndPosition());
  el('.brief-pane').scrollTop = 0;

  return new Promise<boolean>((resolve) => {
    resolveOpen = resolve;
  });
}
