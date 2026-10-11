import { describe, expect, it } from 'vitest';

import type { CardView } from './actions';
import { createLimiter, jobsFor, runQueue, visibleWords, type Job } from './bulk';
import type { Slot, WordState } from './types';

const filled: Slot = { id: 'aaaaaaaaaaaa', seed: 1, subject: 'x', createdAt: '2026-10-11T00:00:00.000Z' };
const card = (key: string, slots: WordState['slots'], over: Partial<CardView> = {}): CardView => ({
  key, id: `vocab-geez-${key}`, level: 1, lesson: 1, order: 1, fidel: 'ሀ', index: 1, glyph: 'ሀ', meaning: 'm', romanization: 'r',
  hasPicture: false, subject: 'm', changed: false, state: { slots, selected: null }, ...over,
});
const words = [
  card('a', [null, null, null]),
  card('b', [filled, null, null], { state: { slots: [filled, null, null], selected: 0 } }),
  card('c', [null, null, null], { hasPicture: true }),
];
const tenJobs: Job[] = Array.from({ length: 10 }, (_, i) => ({ key: `w${i}`, slot: 0 }));
const tick = () => new Promise<void>((r) => setTimeout(r, 2));

describe('bulk', () => {
  it('filters: needs picture, no choice yet, all', () => {
    expect(visibleWords(words, 'needs').map((w) => w.key)).toEqual(['a', 'b']);
    expect(visibleWords(words, 'unchosen').map((w) => w.key)).toEqual(['a', 'c']);
    expect(visibleWords(words, 'all')).toHaveLength(3);
  });

  it('lists every empty slot in word order', () => {
    expect(jobsFor([card('a', [filled, null, null]), card('b', [null, null, null])])).toEqual([
      { key: 'a', slot: 1 }, { key: 'a', slot: 2 }, { key: 'b', slot: 0 }, { key: 'b', slot: 1 }, { key: 'b', slot: 2 },
    ]);
  });

  it('never runs more than three at once', async () => {
    let running = 0, peak = 0;
    await runQueue(tenJobs, async () => { peak = Math.max(peak, ++running); await tick(); running--; }).done;
    expect(peak).toBe(3);
  });

  it('stop lets the running ones finish and starts no more', async () => {
    const started: string[] = [], finished: string[] = [];
    const q = runQueue(tenJobs, async (j) => { started.push(j.key); await tick(); finished.push(j.key); });
    q.stop();
    await q.done;
    expect(started).toHaveLength(3);
    expect(finished).toHaveLength(3);
  });

  it('carries on after one job fails', async () => {
    let ran = 0;
    await runQueue(tenJobs, async (j) => { ran++; if (j.key === 'w2') throw new Error('x'); }).done;
    expect(ran).toBe(10);
  });

  it('finishes at once with nothing to do', async () => {
    await expect(runQueue([], async () => undefined).done).resolves.toEqual({ made: 0, failed: 0, notRun: 0 });
  });

  it('skips a job that is no longer wanted when its turn comes', async () => {
    const ran: string[] = [];
    const result = await runQueue(tenJobs, async (j) => { ran.push(j.key); }, { wanted: (j) => j.key !== 'w7' }).done;
    expect(ran).not.toContain('w7');
    expect(result).toEqual({ made: 9, failed: 0, notRun: 1 });
  });

  it('reports how many were made, failed and never run', async () => {
    const q = runQueue(tenJobs, async (j) => (j.key === 'w1' ? 'failed' : 'made'));
    expect(await q.done).toEqual({ made: 9, failed: 1, notRun: 0 });
    const stopped = runQueue(tenJobs, async () => { await tick(); });
    stopped.stop();
    expect(await stopped.done).toEqual({ made: 3, failed: 0, notRun: 7 });
  });

  it('gives up after six busy answers in a row', async () => {
    let asked = 0;
    const result = await runQueue(Array.from({ length: 40 }, (_, i) => ({ key: `w${i}`, slot: 0 as const })), async () => { asked++; return 'busy'; }, { width: 1 }).done;
    expect(asked).toBe(6);
    expect(result).toEqual({ made: 0, failed: 6, notRun: 34 });
  });

  it('a picture that works resets the busy count', async () => {
    let n = 0;
    const result = await runQueue(tenJobs, async () => (++n % 3 === 0 ? 'made' : 'busy'), { width: 1 }).done;
    expect(result.notRun).toBe(0);
  });

  it('stops at once on a problem that would fail every picture', async () => {
    let asked = 0;
    const result = await runQueue(tenJobs, async () => { asked++; return 'fatal'; }, { width: 1 }).done;
    expect(asked).toBe(1);
    expect(result).toEqual({ made: 0, failed: 1, notRun: 9 });
  });
});

describe('createLimiter', () => {
  it('never lets more than three run at once, however many are asked for', async () => {
    const limit = createLimiter(3);
    let running = 0, peak = 0;
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => limit(async () => {
      peak = Math.max(peak, ++running); await tick(); running--; return i;
    })));
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('carries on after one of them throws', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(limit(async () => 'ok')).resolves.toBe('ok');
  });
});
