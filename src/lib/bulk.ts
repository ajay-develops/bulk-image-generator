import type { CardView } from './actions';
import type { SlotIndex } from './types';

export type Job = { key: string; slot: SlotIndex; /** Redraw the picture that is there, keeping a choice of it. */ sharpen?: boolean };
export type Filter = 'needs' | 'unchosen' | 'all';

/**
 * needs: the editor has no picture for it. unchosen: nothing picked here yet.
 * `keep` holds cards that stay in view although they no longer match: a card
 * chosen under "No choice yet" would otherwise vanish from under the finger,
 * with no way to undo the tap.
 */
export function visibleWords(words: CardView[], filter: Filter, keep?: ReadonlySet<string>): CardView[] {
  if (filter === 'all') return words;
  const matches = filter === 'needs' ? (w: CardView) => !w.hasPicture : (w: CardView) => w.state.selected === null;
  return words.filter((w) => matches(w) || keep?.has(w.key));
}

/** The server's words, with the descriptions being typed or saved here left as they are on screen. */
export function mergeAdopted(mine: CardView[], theirs: CardView[], typing: ReadonlySet<string>): CardView[] {
  const typed = new Map(mine.filter((w) => typing.has(w.key)).map((w) => [w.key, w.subject]));
  return theirs.map((w) => (typed.has(w.key) ? { ...w, subject: typed.get(w.key)! } : w));
}

/** Every empty slot of the given words, in order. */
export function jobsFor(words: CardView[]): Job[] {
  return words.flatMap((w) => ([0, 1, 2] as const).filter((i) => !w.state.slots[i]).map((slot) => ({ key: w.key, slot })));
}

/** How one job ended. `busy`: the service would not take it. `fatal`: every other job would fail the same way. */
export type Outcome = 'made' | 'failed' | 'busy' | 'fatal';
export type RunResult = { made: number; failed: number; notRun: number };

/** A run that keeps being told "busy" is stopped, so it does not hammer the service for an hour. */
const BUSY_LIMIT = 6;

/**
 * Runs jobs a few at a time and says how it went.
 *
 * - stop() lets the ones already running finish and starts no more.
 * - `wanted` is asked when a job's turn comes; a job no longer wanted is left
 *   alone (its slot was filled by hand since the run began).
 * - A job that throws counts as failed and does not stop the others.
 * - Six busy answers in a row, or one fatal one, stop the run.
 */
export function runQueue(
  jobs: Job[],
  run: (job: Job) => Promise<Outcome | void>,
  options: { width?: number; wanted?: (job: Job) => boolean } = {},
): { done: Promise<RunResult>; stop: () => void } {
  const waiting = [...jobs];
  const result: RunResult = { made: 0, failed: 0, notRun: 0 };
  let stopped = false;
  let busyInARow = 0;
  const worker = async () => {
    for (let job = waiting.shift(); job; job = stopped ? undefined : waiting.shift()) {
      if (options.wanted && !options.wanted(job)) {
        result.notRun += 1;
        continue;
      }
      const outcome = await run(job).then((o) => o ?? 'made', () => 'failed' as const);
      if (outcome === 'made') {
        result.made += 1;
        busyInARow = 0;
      } else {
        result.failed += 1;
        if (outcome === 'busy') busyInARow += 1;
        if (outcome === 'fatal' || busyInARow >= BUSY_LIMIT) stopped = true;
      }
    }
  };
  // Workers take their first job before stop() can be called, so a stop right away still lets `width` jobs run.
  const width = Math.min(options.width ?? 3, jobs.length);
  const done = Promise.all(Array.from({ length: width }, worker)).then(() => {
    result.notRun += waiting.length;
    return result;
  });
  return { done, stop: () => { stopped = true; } };
}

/**
 * Lets at most `width` things run at once, however many are asked for. Every
 * request to the picture service goes through one of these, so pressing
 * Generate on five cards asks for three pictures at a time, not fifteen.
 */
export function createLimiter(width: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    running -= 1;
    waiting.shift()?.();
  };
  return async (task) => {
    if (running >= width) await new Promise<void>((go) => waiting.push(go));
    running += 1;
    try {
      return await task();
    } finally {
      next();
    }
  };
}
