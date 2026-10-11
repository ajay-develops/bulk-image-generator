import { strToU8, zipSync, type Zippable } from 'fflate';

import type { StateMap, Word } from './types';

export type ExportScope = 'all' | 'changed';

/**
 * The words an export of this scope would carry, in word order: those with a
 * choice, and for `changed` only the choices made since they last went out.
 * A word the editor no longer has is never exported, whatever is on disk.
 */
export function exportKeys(words: Word[], state: StateMap, scope: ExportScope): string[] {
  return words
    .filter((word) => {
      const s = state[word.key];
      if (!s || s.selected === null || !s.slots[s.selected]) return false;
      if (scope === 'all') return true;
      return !s.exportedAt || (s.selectedAt ?? '') > s.exportedAt;
    })
    .map((word) => word.key);
}

/**
 * The zip the content editor's "Import pictures" reads:
 *
 *   manifest.json            which picture is for which word
 *   pictures/<key>.webp      the chosen picture
 *
 * `glyph` and `meaning` are the word as it was when the picture was chosen,
 * so the editor can tell when the word has changed since.
 */
export async function buildExport(
  words: Word[],
  state: StateMap,
  scope: ExportScope,
  readImage: (key: string, id: string) => Promise<Uint8Array>,
  now: string = new Date().toISOString(),
): Promise<{ zip: Uint8Array; keys: string[] }> {
  const keys = new Set(exportKeys(words, state, scope));
  const files: Zippable = {};
  const pictures: Record<string, string>[] = [];
  for (const word of words) {
    if (!keys.has(word.key)) continue;
    const s = state[word.key];
    const slot = s.slots[s.selected!]!;
    const file = `pictures/${word.key}.webp`;
    // WebP is already compressed; deflating it again only costs time.
    files[file] = [await readImage(word.key, slot.id), { level: 0 }];
    pictures.push({
      key: word.key,
      id: word.id,
      file,
      glyph: s.madeFor?.glyph ?? word.glyph,
      meaning: s.madeFor?.meaning ?? word.meaning,
      subject: slot.subject,
    });
  }
  const manifest = { format: 'zema-pictures', version: 1, exportedAt: now, pictures };
  return {
    zip: zipSync({ 'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`), ...files }),
    keys: [...keys],
  };
}
