import { LEVELS } from '../data/levels';

const STORAGE_KEY = 'kqlquest.progress.v1';

export interface Progress {
  solved: string[];
  shards: number;
  xp: number;
  hintsUsed: Record<string, number>;
}

const empty = (): Progress => ({ solved: [], shards: 0, xp: 0, hintsUsed: {} });

let state: Progress = load();

function load(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      solved: Array.isArray(parsed.solved) ? parsed.solved : [],
      shards: typeof parsed.shards === 'number' ? parsed.shards : 0,
      xp: typeof parsed.xp === 'number' ? parsed.xp : 0,
      hintsUsed: parsed.hintsUsed ?? {},
    };
  } catch {
    return empty();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing or a blocked storage partition: progress just will not survive a reload.
  }
}

export const progress = {
  get current(): Readonly<Progress> {
    return state;
  },

  isSolved(levelId: string) {
    return state.solved.includes(levelId);
  },

  solve(levelId: string, xp: number) {
    if (state.solved.includes(levelId)) return false;
    state.solved.push(levelId);
    const penalty = (state.hintsUsed[levelId] ?? 0) * 25;
    state.xp += Math.max(50, xp - penalty);
    persist();
    return true;
  },

  useHint(levelId: string) {
    state.hintsUsed[levelId] = (state.hintsUsed[levelId] ?? 0) + 1;
    persist();
    return state.hintsUsed[levelId];
  },

  hintsUsed(levelId: string) {
    return state.hintsUsed[levelId] ?? 0;
  },

  collectShard() {
    state.shards += 1;
    persist();
  },

  isWorldUnlocked(world: number) {
    if (world <= 1) return true;
    const previous = LEVELS.filter((l) => l.world === world - 1);
    return previous.every((l) => state.solved.includes(l.id));
  },

  reset() {
    state = empty();
    persist();
  },
};
