import type { CardView } from './actions';
import type { SlotIndex } from './types';

export type Job = { key: string; slot: SlotIndex };
export type Filter = 'needs' | 'unchosen' | 'all';

/** needs: the editor has no picture for it. unchosen: nothing picked here yet. */
export function visibleWords(words: CardView[], filter: Filter): CardView[] {
  if (filter === 'needs') return words.filter((w) => !w.hasPicture);
  if (filter === 'unchosen') return words.filter((w) => w.state.selected === null);
  return words;
}

/** Every empty slot of the given words, in order. */
export function jobsFor(words: CardView[]): Job[] {
  return words.flatMap((w) => ([0, 1, 2] as const).filter((i) => !w.state.slots[i]).map((slot) => ({ key: w.key, slot })));
}

/**
 * Runs jobs a few at a time. stop() lets the ones already running finish and
 * starts no more. A job that throws does not stop the others.
 */
export function runQueue(jobs: Job[], run: (job: Job) => Promise<void>, width = 3): { done: Promise<void>; stop: () => void } {
  const waiting = [...jobs];
  let stopped = false;
  const worker = async () => {
    for (let job = waiting.shift(); job; job = stopped ? undefined : waiting.shift()) {
      await run(job).catch(() => undefined);
    }
  };
  // Workers take their first job before stop() can be called, so a stop right away still lets `width` jobs run.
  const done = Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker)).then(() => undefined);
  return { done, stop: () => { stopped = true; } };
}
