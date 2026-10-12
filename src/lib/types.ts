/** A word as the content editor exported it. Only what the generator needs. */
export type Word = {
  /** `l2-o1` for a letter's first word, `l2-o1-w2`… for the others. */
  key: string;
  /** The app's id: `vocab-geez-<key>`. */
  id: string;
  /** "Level N" as the editor shows it. */
  level: number;
  /** The app's internal lesson number (keys use it). */
  lesson: number;
  order: number;
  /** The letter this word teaches. */
  fidel: string;
  /** 1 for the letter's first word, 2… after that. */
  index: number;
  glyph: string;
  meaning: string;
  romanization: string;
  /** Whether the editor already has a picture for it. */
  hasPicture: boolean;
};

/** One generated picture. The file is data/images/<key>/<id>.webp. */
export type Slot = {
  id: string;
  seed: number;
  subject: string;
  createdAt: string;
  /** How crisp the picture is (see sharpness); null when it is too plain to tell. Missing on older pictures. */
  sharp?: number | null;
};

/** Below this a picture looks soft at full size. The app's own pictures sit around 0.66. */
export const SOFT = 0.45;

export type SlotIndex = 0 | 1 | 2;

export type WordState = {
  /** What to draw, as typed. Missing means "not edited yet". */
  subject?: string;
  slots: [Slot | null, Slot | null, Slot | null];
  /** Which slot was chosen, or null. */
  selected: SlotIndex | null;
  selectedAt?: string;
  /** When this choice last went out in a zip. */
  exportedAt?: string;
  /** The word as it was when the picture was chosen. */
  madeFor?: { glyph: string; meaning: string };
  /**
   * The word as it was when its description or first picture was made. A
   * word's key can be reused: if a word is deleted for good and another takes
   * its place, this is how the pictures are known to be for the old one.
   */
  drawnFor?: { glyph: string; meaning: string };
};

export type StateMap = Record<string, WordState>;

/** Every picture the app ships is this size and format. */
export const PICTURE = { width: 1152, height: 768, quality: 82 } as const;

/**
 * The size asked of the picture service. Not the app's own size on purpose:
 * asked for 1152×768 the service answers with a soft, blurred picture, while
 * at the sizes the model was trained on it is sharp. 1216×832 is the nearest
 * of those to the app's 3:2 shape; toPicture then trims about ten rows off the
 * top and bottom and scales it to 1152×768.
 */
export const REQUEST = { width: 1216, height: 832 } as const;

export const WORD_KEY = /^l\d+-o\d(-w[2-9])?$/;
export const SLOT_ID = /^[a-f0-9]{12}$/;

export const emptyState = (): WordState => ({ slots: [null, null, null], selected: null });

/** Text is compared the way the editor stores it. */
export const clean = (text: unknown): string => (typeof text === 'string' ? text.normalize('NFC').trim() : '');

/**
 * True when the word's spelling or meaning is not what its pictures are for:
 * what it said when one was chosen, or failing that, when they were drawn.
 */
export function wordChanged(word: Word, state: WordState | undefined): boolean {
  const was = state?.madeFor ?? state?.drawnFor;
  if (!was) return false;
  return clean(was.glyph) !== clean(word.glyph) || clean(was.meaning) !== clean(word.meaning);
}
