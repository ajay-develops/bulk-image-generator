import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ImportError, parseEditorZip, wordChanged } from './manifest';
import { emptyState, type Word } from './types';

function entry(key: string, over: Record<string, unknown> = {}) {
  const m = /^l(\d+)-o(\d)(?:-w(\d))?$/.exec(key);
  return {
    id: `vocab-geez-${key}`,
    key,
    level: m ? Number(m[1]) : 0,
    lesson: m ? Number(m[1]) : 0,
    order: m ? Number(m[2]) : 0,
    index: m?.[3] ? Number(m[3]) : 1,
    fidel: 'ለ',
    status: 'unchanged',
    glyph: 'ለሚን',
    meaning: 'lemon',
    romanization: 'lemin',
    image: null,
    audio: null,
    ...over,
  };
}

function editorZip(words: unknown[], over: Record<string, unknown> = {}) {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'zema-content-export', version: 5, words, ...over })),
    'CHANGES.txt': strToU8('x'),
  });
}

const base: Word = {
  key: 'l1-o1', id: 'vocab-geez-l1-o1', level: 1, lesson: 1, order: 1, fidel: 'ሀ', index: 1,
  glyph: 'ሀ', meaning: 'umbrella', romanization: 'ha', hasPicture: false,
};

describe('parseEditorZip', () => {
  it('keeps kept words in manifest order and drops deleted ones', () => {
    const words = parseEditorZip(editorZip([
      entry('l2-o1', { status: 'unchanged', image: { source: 'original', file: '/seed/images/x.webp' } }),
      entry('l1-o6-w2', { status: 'added', image: null }),
      entry('l3-o1', { status: 'deleted' }),
      entry('l4-o1', { status: 'edited', image: { source: 'new', url: 'https://x', filename: 'a.webp' } }),
    ]));
    expect(words.map((w) => w.key)).toEqual(['l2-o1', 'l1-o6-w2', 'l4-o1']);
    expect(words.map((w) => w.hasPicture)).toEqual([true, false, true]);
    expect(words[1]).toMatchObject({ id: 'vocab-geez-l1-o6-w2', level: 1, lesson: 1, order: 6, index: 2 });
  });

  it('trims and normalises the text', () => {
    const [word] = parseEditorZip(editorZip([entry('l2-o1', { meaning: '  lemon ', glyph: 'ለሚን'.normalize('NFD') })]));
    expect(word.meaning).toBe('lemon');
    expect(word.glyph).toBe('ለሚን'.normalize('NFC'));
  });

  it.each([
    ['not a zip', new Uint8Array([1, 2, 3])],
    ['a zip without manifest.json', zipSync({ 'a.txt': strToU8('x') })],
    ['the generator’s own zip', zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'zema-pictures', version: 1, pictures: [] })) })],
    ['an older export', editorZip([], { version: 4 })],
    ['a manifest that is not JSON', zipSync({ 'manifest.json': strToU8('{nope') })],
    ['a manifest without words', zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'zema-content-export', version: 5 })) })],
    ['a word with a bad key', editorZip([entry('../etc', { status: 'unchanged' })])],
  ])('refuses %s', (_name, bytes) => {
    expect(() => parseEditorZip(bytes)).toThrow(ImportError);
  });

  it('says what it expected', () => {
    expect(() => parseEditorZip(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/Export zip.*content editor/i);
  });
});

describe('wordChanged', () => {
  it('flags a word whose spelling or meaning changed since its picture was chosen', () => {
    const word = { ...base, glyph: 'ሀ', meaning: 'umbrella' };
    expect(wordChanged(word, undefined)).toBe(false);
    expect(wordChanged(word, { ...emptyState(), madeFor: { glyph: 'ሀ', meaning: 'umbrella' } })).toBe(false);
    expect(wordChanged(word, { ...emptyState(), madeFor: { glyph: 'ሀ', meaning: 'parachute' } })).toBe(true);
    expect(wordChanged(word, { ...emptyState(), madeFor: { glyph: 'ለ', meaning: 'umbrella' } })).toBe(true);
  });
});
