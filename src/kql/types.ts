export type Scalar = string | number | boolean | Date | null;

export type ColType = 'string' | 'long' | 'real' | 'bool' | 'datetime';

export interface Column {
  name: string;
  type: ColType;
}

export interface Row {
  [column: string]: Scalar;
}

export interface Table {
  name: string;
  description: string;
  columns: Column[];
  rows: Row[];
}

export interface ResultTable {
  columns: Column[];
  rows: Row[];
  /** Rows were capped by the row limit; the real result set is larger. */
  truncated: boolean;
}

export type Database = Record<string, Table>;

/** A parse/eval failure carrying source offsets so the editor can underline it. */
export class KqlError extends Error {
  constructor(
    message: string,
    public start = 0,
    public end = 0,
  ) {
    super(message);
    this.name = 'KqlError';
  }
}
