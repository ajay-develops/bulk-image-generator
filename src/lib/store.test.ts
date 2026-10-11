import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { choose, dataDir, fillSlot, imagePath, readState, readWords, startingSubject, updateWord, writeWords } from './store';
import { emptyState, type Slot, type Word } from './types';

const word: Word = {
  key: 'l1-o1', id: 'vocab-geez-l1-o1', level: 1, lesson: 1, order: 1, fidel: 'ሀ', index: 1,
  glyph: 'ሀ', meaning: 'sun', romanization: 'ha', hasPicture: false,
};
const slot = (id: string): Slot => ({ id, seed: 1, subject: 'x', createdAt: '2026-10-11T00:00:00.000Z' });

beforeEach(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'big-store-'));
});

describe('store', () => {
  it('starts empty', async () => {
    expect(await readWords()).toEqual([]);
    expect(await readState()).toEqual({});
  });

  it('keeps the words it is given', async () => {
    await writeWords([word]);
    expect(await readWords()).toEqual([word]);
  });

  it('does not lose updates when twenty writes land together', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      updateWord(`l1-o${(i % 7) + 1}`, (s) => { s.subject = `${s.subject ?? ''}x`; })));
    const state = await readState();
    expect(Object.values(state).reduce((n, s) => n + s.subject!.length, 0)).toBe(20);
  });

  it('leaves a readable file and no temporary ones', async () => {
    await updateWord('l1-o1', (s) => { s.subject = 'a'; });
    expect(readdirSync(dataDir()).filter((f) => f.includes('.tmp'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(dataDir(), 'state.json'), 'utf8'))['l1-o1'].subject).toBe('a');
  });

  it('keeps going after an update throws', async () => {
    await expect(updateWord('l1-o1', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await updateWord('l1-o1', (s) => { s.subject = 'after'; });
    expect((await readState())['l1-o1'].subject).toBe('after');
  });

  it('clears the choice when the chosen slot is redone, and removes the old file', async () => {
    const old = imagePath('l1-o1', 'aaaaaaaaaaaa');
    mkdirSync(dirname(old), { recursive: true });
    writeFileSync(old, 'x');
    await fillSlot('l1-o1', 0, slot('aaaaaaaaaaaa'));
    await fillSlot('l1-o1', 1, slot('bbbbbbbbbbbb'));
    await choose('l1-o1', 0, word);
    const { state, replaced } = await fillSlot('l1-o1', 0, slot('cccccccccccc'));
    expect(replaced).toBe('aaaaaaaaaaaa');
    expect(state.selected).toBeNull();
    expect(state.slots[0]?.id).toBe('cccccccccccc');
    expect(existsSync(old)).toBe(false);
  });

  it('keeps the choice when another slot is redone', async () => {
    await fillSlot('l1-o1', 0, slot('aaaaaaaaaaaa'));
    await choose('l1-o1', 0, word);
    expect((await fillSlot('l1-o1', 2, slot('dddddddddddd'))).state.selected).toBe(0);
  });

  it('refuses to choose an empty slot', async () => {
    await expect(choose('l1-o1', 2, word)).rejects.toThrow(/no picture/i);
  });

  it('records what the word said when it was chosen', async () => {
    await fillSlot('l1-o1', 0, slot('aaaaaaaaaaaa'));
    const s = await choose('l1-o1', 0, { ...word, glyph: 'ሀ', meaning: 'sun' });
    expect(s.madeFor).toEqual({ glyph: 'ሀ', meaning: 'sun' });
    expect(s.selectedAt).toBeTruthy();
  });

  it('clears the choice', async () => {
    await fillSlot('l1-o1', 0, slot('aaaaaaaaaaaa'));
    await choose('l1-o1', 0, word);
    expect((await choose('l1-o1', null, word)).selected).toBeNull();
  });

  it('starts the description from saved text, then the carried-over one, then the meaning', () => {
    expect(startingSubject({ ...word, key: 'l1-o6-w2' }, undefined)).toBe('a cute cartoon monkey sitting');
    expect(startingSubject({ ...word, key: 'l9-o9', meaning: 'spoon' }, undefined)).toBe('spoon');
    expect(startingSubject(word, { ...emptyState(), subject: 'mine' })).toBe('mine');
  });
});
