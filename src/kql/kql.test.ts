import { describe, expect, it } from 'vitest';
import { LEVELS } from '../data/levels';
import { DB, SIM_NOW } from '../data/tables';
import { grade } from '../engine/grade';
import { KqlError, runQuery } from './index';

const run = (text: string) => runQuery(text, DB, { now: SIM_NOW });

describe('pipeline operators', () => {
  it('takes a fixed number of rows', () => {
    expect(run('Heartbeat | take 5').rows).toHaveLength(5);
  });

  it('filters with where', () => {
    const result = run('SigninLogs | where ResultType != 0');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((r) => r.ResultType !== 0)).toBe(true);
  });

  it('projects only the requested columns, in order', () => {
    const result = run('SigninLogs | project TimeGenerated, UserPrincipalName, IPAddress');
    expect(result.columns.map((c) => c.name)).toEqual([
      'TimeGenerated',
      'UserPrincipalName',
      'IPAddress',
    ]);
  });

  it('counts into a single Count column', () => {
    const result = run('SecurityEvent | where EventID == 4625 | count');
    expect(result.columns.map((c) => c.name)).toEqual(['Count']);
    expect(result.rows[0].Count).toBe(
      DB.SecurityEvent.rows.filter((r) => r.EventID === 4625).length,
    );
  });

  it('summarizes and sorts descending', () => {
    const result = run(
      'SigninLogs | where ResultType != 0 | summarize FailedAttempts = count() by UserPrincipalName | sort by FailedAttempts desc',
    );
    const counts = result.rows.map((r) => Number(r.FailedAttempts));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('filters on an aggregate produced by summarize', () => {
    const result = run(
      'Perf | where CounterName == "% Processor Time" | summarize AvgCpu = avg(CounterValue) by Computer | where AvgCpu > 80',
    );
    expect(result.rows.map((r) => r.Computer).sort()).toEqual(['SQL-01', 'WEB-02']);
  });

  it('counts distinct values with dcount', () => {
    const result = run('Heartbeat | summarize Machines = dcount(Computer) by OSType');
    const windows = result.rows.find((r) => r.OSType === 'Windows');
    expect(windows?.Machines).toBe(5);
  });

  it('ranks and slices with top', () => {
    const result = run(
      'SigninLogs | where ResultType != 0 | summarize Attempts = count() by IPAddress | top 3 by Attempts',
    );
    expect(result.rows).toHaveLength(3);
  });

  it('supports let bindings', () => {
    const withLet = run('let threshold = 4625;\nSecurityEvent | where EventID == threshold | count');
    const inline = run('SecurityEvent | where EventID == 4625 | count');
    expect(withLet.rows[0].Count).toBe(inline.rows[0].Count);
  });

  it('resolves ago() against the frozen clock', () => {
    const result = run('SigninLogs | where TimeGenerated > ago(1d)');
    const cutoff = SIM_NOW.getTime() - 86_400_000;
    expect(result.rows.every((r) => (r.TimeGenerated as Date).getTime() > cutoff)).toBe(true);
  });

  it('reports unknown columns with a position', () => {
    expect(() => run('Heartbeat | where Nope == 1')).toThrowError(KqlError);
  });

  it('rejects unknown tables', () => {
    expect(() => run('NotATable | count')).toThrowError(/Unknown table/);
  });
});

describe('level integrity', () => {
  it.each(LEVELS.map((level) => [level.id, level] as const))(
    '"%s" is solved by its own reference solution',
    (_id, level) => {
      const outcome = grade(level, level.solution);
      expect(outcome.status, outcome.message).toBe('solved');
    },
  );

  it.each(LEVELS.map((level) => [level.id, level] as const))(
    '"%s" produces a non-empty expected result',
    (_id, level) => {
      expect(runQuery(level.solution, DB, { now: SIM_NOW }).rows.length).toBeGreaterThan(0);
    },
  );

  it('does not accept the starter query as a solution', () => {
    for (const level of LEVELS) {
      expect(grade(level, level.starter).status).not.toBe('solved');
    }
  });
});
