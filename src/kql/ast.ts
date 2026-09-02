import type { Scalar } from './types';

export type Expr =
  | { t: 'lit'; value: Scalar }
  | { t: 'timespan'; ms: number }
  | { t: 'col'; name: string; start: number; end: number }
  | { t: 'bin'; op: string; l: Expr; r: Expr; start: number; end: number }
  | { t: 'un'; op: string; e: Expr }
  | { t: 'call'; name: string; args: Expr[]; start: number; end: number }
  | { t: 'list'; items: Expr[] };

export interface NamedExpr {
  name: string;
  expr: Expr;
}

export interface SortKey {
  expr: Expr;
  desc: boolean;
}

export type Stage =
  | { t: 'where'; pred: Expr }
  | { t: 'project'; cols: NamedExpr[] }
  | { t: 'project-away'; names: string[] }
  | { t: 'extend'; cols: NamedExpr[] }
  | { t: 'summarize'; aggs: NamedExpr[]; by: NamedExpr[] }
  | { t: 'count' }
  | { t: 'take'; n: number }
  | { t: 'top'; n: number; keys: SortKey[] }
  | { t: 'sort'; keys: SortKey[] }
  | { t: 'distinct'; names: string[] }
  | { t: 'search'; term: string }
  | { t: 'render' };

export interface Query {
  lets: NamedExpr[];
  source: { name: string; start: number; end: number };
  stages: Stage[];
}
