import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildExport, exportKeys } from './export';
import type { StateMap, Word } from './types';

const w = (key: string, glyph: string, meaning: string): Word => ({
  key, id: `vocab-geez-${key}`, level: 1, lesson: 1, order: 1, fidel: 'ሀ', index: 1, glyph, meaning, romanization: 'x', hasPicture: false,
});
const words = [w('l1-o6-w2', 'ህበይ', 'monkey'), w('l2-o1', 'ለሚን', 'lemon'), w('l3-o1', 'ሐ', 'none chosen')];
const slot = (id: string, subject: string) => ({ id, seed: 1, subject, createdAt: '2026-10-10T00:00:00.000Z' });
const state: StateMap = {
  'l1-o6-w2': { slots: [slot('aaaaaaaaaaaa', 'a cute cartoon monkey sitting'), null, null], selected: 0, selectedAt: '2026-10-10T10:00:00.000Z', madeFor: { glyph: 'ህበይ', meaning: 'monkey' } },
  'l2-o1': { slots: [slot('cccccccccccc', 'other'), slot('bbbbbbbbbbbb', 'a lemon'), null], selected: 1, selectedAt: '2026-10-10T10:00:00.000Z', madeFor: { glyph: 'ለሚን', meaning: 'lemon' } },
  'l3-o1': { slots: [slot('dddddddddddd', 'x'), null, null], selected: null },
  'l9-o1': { slots: [slot('eeeeeeeeeeee', 'gone'), null, null], selected: 0, selectedAt: '2026-10-10T10:00:00.000Z' },
};
const readImage = async (key: string, id: string) => strToU8(`${key}/${id}`);

describe('export', () => {
  it('carries one chosen picture per word, named by key', async () => {
    const { zip, keys } = await buildExport(words, state, 'all', readImage, '2026-10-11T00:00:00.000Z');
    const files = unzipSync(zip);
    expect(keys).toEqual(['l1-o6-w2', 'l2-o1']);
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'pictures/l1-o6-w2.webp', 'pictures/l2-o1.webp']);
    expect(files['pictures/l2-o1.webp']).toEqual(await readImage('l2-o1', 'bbbbbbbbbbbb'));
    expect(JSON.parse(strFromU8(files['manifest.json']))).toEqual({
      format: 'zema-pictures', version: 1, exportedAt: '2026-10-11T00:00:00.000Z',
      pictures: [
        { key: 'l1-o6-w2', id: 'vocab-geez-l1-o6-w2', file: 'pictures/l1-o6-w2.webp', glyph: 'ህበይ', meaning: 'monkey', subject: 'a cute cartoon monkey sitting' },
        { key: 'l2-o1', id: 'vocab-geez-l2-o1', file: 'pictures/l2-o1.webp', glyph: 'ለሚን', meaning: 'lemon', subject: 'a lemon' },
      ],
    });
  });

  it('leaves out words with no choice', () => {
    expect(exportKeys(words, { ...state, 'l2-o1': { ...state['l2-o1'], selected: null } }, 'all')).toEqual(['l1-o6-w2']);
  });

  it('leaves out a word the editor no longer has, though its state is still on disk', () => {
    expect(exportKeys(words.filter((x) => x.key !== 'l2-o1'), state, 'all')).toEqual(['l1-o6-w2']);
    expect(exportKeys(words, state, 'all')).not.toContain('l9-o1');
  });

  it('changed scope carries only choices made since they last went out', () => {
    const s = structuredClone(state);
    s['l1-o6-w2'].selectedAt = '2026-10-10T10:00:00.000Z'; s['l1-o6-w2'].exportedAt = '2026-10-10T11:00:00.000Z';
    s['l2-o1'].selectedAt = '2026-10-10T12:00:00.000Z'; s['l2-o1'].exportedAt = '2026-10-10T11:00:00.000Z';
    expect(exportKeys(words, s, 'changed')).toEqual(['l2-o1']);
    delete s['l2-o1'].exportedAt;
    expect(exportKeys(words, s, 'changed')).toEqual(['l2-o1']);
  });

  it('uses the glyph and meaning the picture was made for', async () => {
    const s = structuredClone(state);
    s['l2-o1'].madeFor = { glyph: 'ለሚን', meaning: 'lime' };
    const { zip } = await buildExport(words, s, 'all', readImage);
    expect(JSON.parse(strFromU8(unzipSync(zip)['manifest.json'])).pictures[1].meaning).toBe('lime');
  });
});
