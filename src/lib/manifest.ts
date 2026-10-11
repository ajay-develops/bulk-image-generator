import { strFromU8, unzipSync } from 'fflate';

import { WORD_KEY, clean, type Word, type WordState } from './types';

/** The file is not something the generator can read words from. The message is shown as is. */
export class ImportError extends Error {}

const EXPECTED = 'Choose the zip you get from "Export zip" in the content editor.';
const KEPT = new Set(['unchanged', 'edited', 'added']);

/**
 * Reads manifest.json from the editor's export zip and keeps the words that
 * are in the app: unchanged, edited or added, in the editor's own order
 * (level, letter, word).
 */
export function parseEditorZip(bytes: Uint8Array): Word[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name === 'manifest.json' });
  } catch {
    throw new ImportError(`That file is not a zip. ${EXPECTED}`);
  }
  if (!files['manifest.json']) throw new ImportError(`That zip has no word list in it. ${EXPECTED}`);

  let manifest: { format?: unknown; version?: unknown; words?: unknown };
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new ImportError(`The word list in that zip cannot be read. ${EXPECTED}`);
  }
  if (!manifest || manifest.format !== 'zema-content-export') {
    throw new ImportError(`That zip is not from the content editor. ${EXPECTED}`);
  }
  if (manifest.version !== 5) {
    throw new ImportError(`That zip is export version ${String(manifest.version)}; this app reads version 5. ${EXPECTED}`);
  }
  if (!Array.isArray(manifest.words)) throw new ImportError(`That zip has no word list in it. ${EXPECTED}`);

  const words: Word[] = [];
  for (const raw of manifest.words as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object' || !KEPT.has(String(raw.status))) continue;
    const key = String(raw.key);
    if (!WORD_KEY.test(key)) throw new ImportError(`The word list has a word this app does not understand ("${key.slice(0, 40)}"). ${EXPECTED}`);
    words.push({
      key,
      id: typeof raw.id === 'string' ? raw.id : `vocab-geez-${key}`,
      level: Number(raw.level) || 0,
      lesson: Number(raw.lesson) || 0,
      order: Number(raw.order) || 0,
      fidel: clean(raw.fidel),
      index: Number(raw.index) || 1,
      glyph: clean(raw.glyph),
      meaning: clean(raw.meaning),
      romanization: clean(raw.romanization),
      hasPicture: raw.image != null,
    });
  }
  return words;
}

/** True when the word's spelling or meaning differs from what its picture was chosen for. */
export function wordChanged(word: Word, state: WordState | undefined): boolean {
  const made = state?.madeFor;
  if (!made) return false;
  return clean(made.glyph) !== clean(word.glyph) || clean(made.meaning) !== clean(word.meaning);
}
