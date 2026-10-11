import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import carriedOver from '../../seed/subjects.json';
import { clean, emptyState, type Slot, type SlotIndex, type StateMap, type Word, type WordState } from './types';

/**
 * Everything generated lives in one folder, outside anything the dev server
 * watches, so writing a picture can never reload the page.
 *
 *   words.json                 the words last imported from the editor
 *   state.json                 per word: description, three slots, the choice
 *   images/<key>/<id>.webp     the pictures
 */
export function dataDir(): string {
  return resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? './data');
}

export function imagePath(key: string, id: string): string {
  return join(/* turbopackIgnore: true */ dataDir(), 'images', key, `${id}.webp`);
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ dataDir(), name), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

/** Written beside the real file and renamed over it, so a reader never sees half a file. */
async function writeJson(name: string, value: unknown): Promise<void> {
  const file = join(/* turbopackIgnore: true */ dataDir(), name);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, file);
}

export async function readWords(): Promise<Word[]> {
  return readJson<Word[]>('words.json', []);
}

export async function writeWords(words: Word[]): Promise<void> {
  await writeJson('words.json', words);
}

export async function readState(): Promise<StateMap> {
  return readJson<StateMap>('state.json', {});
}

// One writer at a time. Three pictures finishing together each read, change
// and write the same file; without this the last one would undo the others.
let queue: Promise<unknown> = Promise.resolve();

/** Runs fn on the word's current state and saves the result. */
export async function updateWord(key: string, fn: (state: WordState) => void): Promise<WordState> {
  const run = async () => {
    const all = await readState();
    const state = all[key] ?? emptyState();
    fn(state);
    all[key] = state;
    await writeJson('state.json', all);
    return state;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

const SUBJECTS = carriedOver as Record<string, string>;

/** What the "what to draw" box starts with: saved text, else the carried-over description, else the meaning. */
export function startingSubject(word: Word, state: WordState | undefined): string {
  return state?.subject ?? SUBJECTS[word.key] ?? word.meaning;
}

/** Puts a new picture in a slot. Clears the choice if that slot was the chosen one. */
export async function fillSlot(key: string, index: SlotIndex, slot: Slot): Promise<{ state: WordState; replaced: string | null }> {
  let replaced: string | null = null;
  const state = await updateWord(key, (s) => {
    replaced = s.slots[index]?.id ?? null;
    s.slots[index] = slot;
    if (s.selected === index) {
      s.selected = null;
      delete s.selectedAt;
      delete s.madeFor;
    }
  });
  if (replaced) await rm(imagePath(key, replaced), { force: true });
  return { state, replaced };
}

/** Chooses a slot, or clears the choice with null. */
export async function choose(key: string, index: SlotIndex | null, word: Word): Promise<WordState> {
  return updateWord(key, (s) => {
    if (index === null) {
      s.selected = null;
      delete s.selectedAt;
      delete s.madeFor;
      return;
    }
    if (!s.slots[index]) throw new Error('There is no picture in that slot.');
    s.selected = index;
    s.selectedAt = new Date().toISOString();
    s.madeFor = { glyph: clean(word.glyph), meaning: clean(word.meaning) };
  });
}
