import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildExport, exportKeys, type ExportScope } from './export';
import { ImportError, parseEditorZip, wordChanged } from './manifest';
import { GenerateError, generatePicture, type GenerateKind } from './nvidia';
import { toPicture } from './picture';
import { StaleChoice, choose, fillSlot, imagePath, noteDrawnFor, readState, readWords, startingSubject, updateWord, writeWords } from './store';
import { SLOT_ID, WORD_KEY, emptyState, type SlotIndex, type Word, type WordState } from './types';

/** A word as the screen shows it. */
export type CardView = Word & {
  state: WordState;
  /** What the "what to draw" box holds. */
  subject: string;
  /** The word's spelling or meaning changed since its picture was chosen. */
  changed: boolean;
};

export type AppState = { words: CardView[]; hasKey: boolean };

/** Something the person at the screen can be told. The routes turn it into a response. */
export class ActionError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502, readonly kind?: GenerateKind) {
    super(message);
  }
}

const SUBJECT_LIMIT = 600;

export async function getAppState(): Promise<AppState> {
  const [words, state] = await Promise.all([readWords(), readState()]);
  return {
    words: words.map((word) => ({
      ...word,
      state: state[word.key] ?? emptyState(),
      subject: startingSubject(word, state[word.key]),
      changed: wordChanged(word, state[word.key]),
    })),
    hasKey: Boolean(process.env.NVIDIA_API_KEY),
  };
}

/** Replaces the word list with the editor's. Pictures and choices already made are kept. */
export async function importWords(zip: Uint8Array): Promise<AppState> {
  let words: Word[];
  try {
    words = parseEditorZip(zip);
  } catch (error) {
    if (error instanceof ImportError) throw new ActionError(error.message, 400);
    throw error;
  }
  await writeWords(words);
  return getAppState();
}

async function findWord(key: string): Promise<Word> {
  if (!WORD_KEY.test(key)) throw new ActionError('Unknown word.', 404);
  const word = (await readWords()).find((w) => w.key === key);
  if (!word) throw new ActionError('Unknown word.', 404);
  return word;
}

export async function saveSubject(key: string, subject: string): Promise<WordState> {
  const word = await findWord(key);
  if (typeof subject !== 'string') throw new ActionError('Invalid description.', 400);
  return updateWord(key, (s) => {
    noteDrawnFor(s, word);
    s.subject = subject.slice(0, SUBJECT_LIMIT);
  });
}

export async function chooseSlot(key: string, index: SlotIndex | null, id?: string): Promise<WordState> {
  const word = await findWord(key);
  if (index !== null && ![0, 1, 2].includes(index)) throw new ActionError('Invalid choice.', 400);
  try {
    return await choose(key, index, word, typeof id === 'string' ? id : undefined);
  } catch (error) {
    if (error instanceof StaleChoice) throw new ActionError(error.message, 409);
    throw new ActionError(error instanceof Error ? error.message : 'Could not save the choice.', 400);
  }
}

/** Makes one picture for one slot. On any failure the slot is left exactly as it was. */
export async function generateSlot(
  key: string,
  index: SlotIndex,
  generate: typeof generatePicture = generatePicture,
): Promise<{ state: WordState }> {
  const word = await findWord(key);
  if (![0, 1, 2].includes(index)) throw new ActionError('Invalid slot.', 400);
  const subject = startingSubject(word, (await readState())[key]).trim();
  if (!subject) throw new ActionError('Write what to draw first.', 400);

  let made: { image: Buffer; seed: number };
  try {
    made = await generate(subject);
  } catch (error) {
    if (error instanceof GenerateError) throw new ActionError(error.message, 502, error.kind);
    throw error;
  }
  let picture: Buffer;
  try {
    picture = await toPicture(made.image);
  } catch {
    throw new ActionError('The picture service sent something that is not a picture. Try again.', 502, 'failed');
  }

  const id = randomBytes(6).toString('hex');
  const file = imagePath(key, id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, picture);
  const { state } = await fillSlot(key, index, { id, seed: made.seed, subject, createdAt: new Date().toISOString() }, word);
  return { state };
}

export async function readPicture(key: string, id: string): Promise<Buffer> {
  if (!WORD_KEY.test(key) || !SLOT_ID.test(id)) throw new ActionError('Not found.', 404);
  try {
    return await readFile(imagePath(key, id));
  } catch {
    throw new ActionError('Not found.', 404);
  }
}

/**
 * Builds the zip for the editor and stamps what went out. A chosen picture
 * whose file is gone is left out and named in `missing`, not stamped.
 */
export async function exportZip(scope: ExportScope): Promise<{ zip: Uint8Array; filename: string; missing: string[] }> {
  // Taken before reading: a choice made while the zip is being built is then
  // newer than the stamp, and goes out with the next "changed" export.
  const now = new Date().toISOString();
  const [words, state] = await Promise.all([readWords(), readState()]);
  if (!exportKeys(words, state, scope).length) {
    throw new ActionError(scope === 'changed' ? 'Nothing has changed since the last export.' : 'Nothing is chosen yet, so there is nothing to export.', 400);
  }
  const built = await buildExport(words, state, scope, readPicture, now);
  const missing = built.missing.map((key) => {
    const word = words.find((w) => w.key === key)!;
    return `${word.glyph} (${word.meaning})`;
  });
  if (!built.keys.length) {
    throw new ActionError(`The picture files are missing for: ${missing.join(', ')}. Press Redo on them and choose again.`, 400);
  }
  for (const key of built.keys) {
    await updateWord(key, (s) => {
      s.exportedAt = now;
    });
  }
  // Named by this Mac's clock, so the newest zip in Downloads is easy to spot.
  const d = new Date(now);
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}-${two(d.getMinutes())}`;
  return { zip: built.zip, filename: `zema-pictures-${stamp}.zip`, missing };
}
