import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';

import { chooseSlot, exportZip, generateSlot, getAppState, importWords, readPicture, saveSubject } from './actions';
import { GenerateError } from './nvidia';
import { imagePath } from './store';

function entry(key: string, over: Record<string, unknown> = {}) {
  const m = /^l(\d+)-o(\d)(?:-w(\d))?$/.exec(key)!;
  return {
    id: `vocab-geez-${key}`, key, level: Number(m[1]), lesson: Number(m[1]), order: Number(m[2]), index: m[3] ? Number(m[3]) : 1,
    fidel: 'ለ', status: 'unchanged', glyph: 'ለሚን', meaning: 'lemon', romanization: 'lemin', image: null, audio: null, ...over,
  };
}
const zipWith = (over: Record<string, Record<string, unknown>> = {}) =>
  zipSync({
    'manifest.json': strToU8(JSON.stringify({
      format: 'zema-content-export', version: 5,
      words: [entry('l1-o6-w2', { glyph: 'ህበይ', meaning: 'monkey', ...over['l1-o6-w2'] }), entry('l2-o1', over['l2-o1'])],
    })),
  });
const zip = zipWith();

/** Stands in for the picture service: a small square PNG, not the app's size. */
const fakeGenerate = async () => ({
  image: await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).png().toBuffer(),
  seed: 5,
});
const cardOf = async (key: string) => (await getAppState()).words.find((w) => w.key === key)!;

beforeEach(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'big-actions-'));
});

describe('actions', () => {
  it('imports words and reports them with their starting description', async () => {
    const app = await importWords(zip);
    expect(app.words.map((w) => w.key)).toEqual(['l1-o6-w2', 'l2-o1']);
    expect(app.words[0]).toMatchObject({ subject: 'a cute cartoon monkey sitting', changed: false });
    expect(app.words[0].state).toEqual({ slots: [null, null, null], selected: null });
    expect(app.words[1].subject).toBe('lemon');
  });

  it('leaves the words alone when the zip is refused', async () => {
    await importWords(zip);
    await expect(importWords(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ status: 400 });
    expect((await getAppState()).words).toHaveLength(2);
  });

  it('keeps pictures and choices across a re-import and flags a changed word', async () => {
    await importWords(zip);
    await generateSlot('l2-o1', 0, fakeGenerate);
    await chooseSlot('l2-o1', 0);
    const app = await importWords(zipWith({ 'l2-o1': { meaning: 'lime' } }));
    const card = app.words.find((w) => w.key === 'l2-o1')!;
    expect(card.state.selected).toBe(0);
    expect(card.changed).toBe(true);
  });

  it('generates a 1152x768 picture into the slot and saves the description used', async () => {
    await importWords(zip);
    await saveSubject('l2-o1', 'a yellow lemon');
    const { state } = await generateSlot('l2-o1', 1, fakeGenerate);
    expect(state.slots[1]).toMatchObject({ subject: 'a yellow lemon', seed: 5 });
    const meta = await sharp(imagePath('l2-o1', state.slots[1]!.id)).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1152, 768, 'webp']);
    expect((await readPicture('l2-o1', state.slots[1]!.id)).length).toBeGreaterThan(100);
  });

  it('passes the description to the picture service', async () => {
    await importWords(zip);
    let asked = '';
    await generateSlot('l1-o6-w2', 0, async (subject) => { asked = subject; return fakeGenerate(); });
    expect(asked).toBe('a cute cartoon monkey sitting');
  });

  it('refuses to generate from a blank description', async () => {
    await importWords(zip);
    await saveSubject('l2-o1', '   ');
    await expect(generateSlot('l2-o1', 0, fakeGenerate)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/what to draw/i) });
  });

  it('leaves the slot as it was when generating fails', async () => {
    await importWords(zip);
    await generateSlot('l2-o1', 0, fakeGenerate);
    const before = (await cardOf('l2-o1')).state;
    await expect(generateSlot('l2-o1', 0, async () => { throw new GenerateError('busy', 'busy'); }))
      .rejects.toMatchObject({ status: 502, kind: 'busy' });
    expect((await cardOf('l2-o1')).state).toEqual(before);
  });

  it.each(['../x', 'l2-o1/..', 'nope', 'l2-o1-w1'])('answers 404 for the key %s', async (key) => {
    await importWords(zip);
    await expect(saveSubject(key, 'x')).rejects.toMatchObject({ status: 404 });
    await expect(readPicture(key, 'aaaaaaaaaaaa')).rejects.toMatchObject({ status: 404 });
  });

  it.each(['../../state', 'AAAAAAAAAAAA', 'short'])('answers 404 for the picture id %s', async (id) => {
    await expect(readPicture('l2-o1', id)).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for a word that was not imported', async () => {
    await importWords(zip);
    await expect(chooseSlot('l9-o1', 0)).rejects.toMatchObject({ status: 404 });
  });

  it('answers 400 for choosing an empty slot', async () => {
    await importWords(zip);
    await expect(chooseSlot('l2-o1', 2)).rejects.toMatchObject({ status: 400 });
  });

  it('stamps what went out, so a changed export is then empty', async () => {
    await importWords(zip);
    await generateSlot('l2-o1', 0, fakeGenerate);
    await chooseSlot('l2-o1', 0);
    const first = await exportZip('changed');
    expect(first.filename).toMatch(/^zema-pictures-\d{4}-\d\d-\d\d-\d\d-\d\d\.zip$/);
    const files = unzipSync(first.zip);
    expect(Object.keys(files)).toContain('pictures/l2-o1.webp');
    expect(JSON.parse(strFromU8(files['manifest.json'])).pictures[0]).toMatchObject({ key: 'l2-o1', glyph: 'ለሚን', meaning: 'lemon' });
    await expect(exportZip('changed')).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/nothing/i) });
    expect(Object.keys(unzipSync((await exportZip('all')).zip))).toContain('pictures/l2-o1.webp');
  });

  it('counts a new choice as changed again', async () => {
    await importWords(zip);
    await generateSlot('l2-o1', 0, fakeGenerate);
    await generateSlot('l2-o1', 1, fakeGenerate);
    await chooseSlot('l2-o1', 0);
    await exportZip('all');
    await new Promise((r) => setTimeout(r, 5));
    await chooseSlot('l2-o1', 1);
    expect(Object.keys(unzipSync((await exportZip('changed')).zip))).toContain('pictures/l2-o1.webp');
  });

  it('answers 409 when the chosen picture is not the one in that slot any more', async () => {
    await importWords(zip);
    const first = (await generateSlot('l2-o1', 0, fakeGenerate)).state.slots[0]!.id;
    await generateSlot('l2-o1', 0, fakeGenerate);
    await expect(chooseSlot('l2-o1', 0, first)).rejects.toMatchObject({ status: 409 });
    expect((await cardOf('l2-o1')).state.selected).toBeNull();
  });

  it('exports the rest when one picture file is gone, and does not mark that word as exported', async () => {
    await importWords(zip);
    for (const key of ['l2-o1', 'l1-o6-w2']) { await generateSlot(key, 0, fakeGenerate); await chooseSlot(key, 0); }
    rmSync(imagePath('l2-o1', (await cardOf('l2-o1')).state.slots[0]!.id));
    const out = await exportZip('all');
    expect(out.missing).toEqual(['ለሚን (lemon)']);
    expect(Object.keys(unzipSync(out.zip)).sort()).toEqual(['manifest.json', 'pictures/l1-o6-w2.webp']);
    expect((await cardOf('l2-o1')).state.exportedAt).toBeUndefined();
    expect((await cardOf('l1-o6-w2')).state.exportedAt).toBeTruthy();
  });

  it('refuses an export when every chosen picture file is gone', async () => {
    await importWords(zip);
    await generateSlot('l2-o1', 0, fakeGenerate);
    await chooseSlot('l2-o1', 0);
    rmSync(imagePath('l2-o1', (await cardOf('l2-o1')).state.slots[0]!.id));
    await expect(exportZip('all')).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/missing/i) });
  });

  it('remembers which word the pictures were drawn for, and flags a different word that takes the key', async () => {
    await importWords(zip);
    await generateSlot('l2-o1', 0, fakeGenerate);
    expect((await cardOf('l2-o1')).changed).toBe(false);
    const app = await importWords(zipWith({ 'l2-o1': { glyph: 'ለውዝ', meaning: 'almond' } }));
    expect(app.words.find((w) => w.key === 'l2-o1')!.changed).toBe(true);
    // Choosing one says "this picture is for the word as it is now".
    await chooseSlot('l2-o1', 0);
    expect((await cardOf('l2-o1')).changed).toBe(false);
  });

  it('remembers the word a description was written for', async () => {
    await importWords(zip);
    await saveSubject('l2-o1', 'a yellow lemon');
    const app = await importWords(zipWith({ 'l2-o1': { glyph: 'ለውዝ', meaning: 'almond' } }));
    expect(app.words.find((w) => w.key === 'l2-o1')!.changed).toBe(true);
  });

  it('starting again from empty slots is for the word as it is now', async () => {
    await importWords(zip);
    await saveSubject('l2-o1', 'a yellow lemon');
    await importWords(zipWith({ 'l2-o1': { glyph: 'ለውዝ', meaning: 'almond' } }));
    await generateSlot('l2-o1', 0, fakeGenerate);
    expect((await cardOf('l2-o1')).changed).toBe(false);
  });
});
