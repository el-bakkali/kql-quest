export const TILE = 32;
export const ROWS = 17;
export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = ROWS * TILE;

export interface TerrainSpan {
  from: number;
  to: number;
  /** Tile row of the walkable surface, or null for a bottomless pit. */
  top: number | null;
}

export interface WorldDef {
  id: number;
  columns: number;
  terrain: TerrainSpan[];
  platforms: Array<{ x: number; y: number; w: number }>;
  terminals: Array<{ x: number; levelId: string }>;
  shards: Array<{ x: number; y: number }>;
  drones: Array<{ x: number; y: number; range: number }>;
  spikes: Array<{ x: number; w: number }>;
  gateX: number;
  startX: number;
}

export function groundTopAt(def: WorldDef, column: number): number | null {
  const span = def.terrain.find((s) => column >= s.from && column <= s.to);
  return span ? span.top : null;
}

export const WORLD_DEFS: Record<number, WorldDef> = {
  1: {
    id: 1,
    columns: 100,
    terrain: [
      { from: 0, to: 13, top: 13 },
      { from: 14, to: 16, top: null },
      { from: 17, to: 30, top: 13 },
      { from: 31, to: 33, top: null },
      { from: 34, to: 46, top: 11 },
      { from: 47, to: 49, top: null },
      { from: 50, to: 62, top: 13 },
      { from: 63, to: 65, top: null },
      { from: 66, to: 78, top: 12 },
      { from: 79, to: 81, top: null },
      { from: 82, to: 99, top: 13 },
    ],
    platforms: [
      { x: 20, y: 9, w: 3 },
      { x: 40, y: 8, w: 3 },
      { x: 55, y: 9, w: 3 },
      { x: 72, y: 8, w: 3 },
      { x: 88, y: 9, w: 3 },
    ],
    terminals: [
      { x: 10, levelId: 'first-light' },
      { x: 27, levelId: 'bad-logins' },
      { x: 42, levelId: 'trim-the-noise' },
      { x: 74, levelId: 'head-count' },
    ],
    shards: [
      { x: 21, y: 8 },
      { x: 41, y: 7 },
      { x: 56, y: 8 },
      { x: 73, y: 7 },
      { x: 89, y: 8 },
      { x: 32, y: 11 },
      { x: 64, y: 11 },
    ],
    drones: [
      { x: 22, y: 11, range: 5 },
      { x: 38, y: 9, range: 4 },
      { x: 57, y: 11, range: 5 },
      { x: 86, y: 11, range: 6 },
    ],
    spikes: [
      { x: 52, w: 2 },
      { x: 68, w: 2 },
    ],
    gateX: 96,
    startX: 3,
  },
  2: {
    id: 2,
    columns: 110,
    terrain: [
      { from: 0, to: 11, top: 13 },
      { from: 12, to: 14, top: null },
      { from: 15, to: 24, top: 12 },
      { from: 25, to: 28, top: null },
      { from: 29, to: 40, top: 10 },
      { from: 41, to: 43, top: null },
      { from: 44, to: 56, top: 12 },
      { from: 57, to: 60, top: null },
      { from: 61, to: 72, top: 9 },
      { from: 73, to: 75, top: null },
      { from: 76, to: 90, top: 12 },
      { from: 91, to: 93, top: null },
      { from: 94, to: 109, top: 13 },
    ],
    platforms: [
      { x: 17, y: 9, w: 3 },
      { x: 26, y: 10, w: 2 },
      { x: 33, y: 7, w: 3 },
      { x: 58, y: 11, w: 2 },
      { x: 64, y: 6, w: 3 },
      { x: 80, y: 9, w: 3 },
      { x: 97, y: 9, w: 3 },
    ],
    terminals: [
      { x: 8, levelId: 'usual-suspects' },
      { x: 34, levelId: 'hot-metal' },
      { x: 50, levelId: 'fleet-census' },
      { x: 84, levelId: 'top-talkers' },
    ],
    shards: [
      { x: 18, y: 8 },
      { x: 34, y: 6 },
      { x: 59, y: 10 },
      { x: 65, y: 5 },
      { x: 81, y: 8 },
      { x: 98, y: 8 },
      { x: 46, y: 10 },
      { x: 70, y: 7 },
    ],
    drones: [
      { x: 20, y: 10, range: 4 },
      { x: 36, y: 8, range: 5 },
      { x: 52, y: 10, range: 5 },
      { x: 66, y: 7, range: 6 },
      { x: 88, y: 10, range: 5 },
    ],
    spikes: [
      { x: 22, w: 2 },
      { x: 47, w: 2 },
      { x: 86, w: 2 },
    ],
    gateX: 105,
    startX: 3,
  },
};
