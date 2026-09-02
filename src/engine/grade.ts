import type { Level } from '../data/levels';
import { DB, SIM_NOW } from '../data/tables';
import { compareResults, KqlError, ordersMatter, runQuery, type ResultTable } from '../kql';

export interface QueryFailure {
  message: string;
  start: number;
  end: number;
}

export type GradeStatus = 'solved' | 'wrong' | 'error';

export interface GradeResult {
  status: GradeStatus;
  message: string;
  result?: ResultTable;
  failure?: QueryFailure;
}

const expectedCache = new Map<string, ResultTable>();

export function runAgainstFixtures(text: string): { result?: ResultTable; failure?: QueryFailure } {
  try {
    return { result: runQuery(text, DB, { now: SIM_NOW }) };
  } catch (error) {
    if (error instanceof KqlError) {
      return { failure: { message: error.message, start: error.start, end: error.end } };
    }
    return { failure: { message: (error as Error).message, start: 0, end: 0 } };
  }
}

/** The expected answer is produced by running the level's own solution through this engine. */
export function expectedFor(level: Level): ResultTable {
  const cached = expectedCache.get(level.id);
  if (cached) return cached;
  const computed = runQuery(level.solution, DB, { now: SIM_NOW });
  expectedCache.set(level.id, computed);
  return computed;
}

export function grade(level: Level, text: string): GradeResult {
  const { result, failure } = runAgainstFixtures(text);
  if (!result) {
    return { status: 'error', message: failure!.message, failure };
  }
  for (const requirement of level.requires) {
    if (!requirement.pattern.test(text)) {
      return { status: 'wrong', message: requirement.message, result };
    }
  }

  const expected = expectedFor(level);
  const verdict = compareResults(result, expected, ordersMatter(level.solution));

  return verdict.ok
    ? { status: 'solved', message: 'Query matched. Barrier down.', result }
    : { status: 'wrong', message: verdict.reason ?? 'That is not the expected result.', result };
}

/** Used by the live checklist, which reports progress without grading the attempt. */
export function resultMatches(level: Level, result: ResultTable): boolean {
  return compareResults(result, expectedFor(level), ordersMatter(level.solution)).ok;
}
