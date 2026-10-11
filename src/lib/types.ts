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
export type Slot = { id: string; seed: number; subject: string; createdAt: string };

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
};

export type StateMap = Record<string, WordState>;

/** Every picture the app ships is this size and format. */
export const PICTURE = { width: 1152, height: 768, quality: 82 } as const;

export const WORD_KEY = /^l\d+-o\d(-w[2-9])?$/;
export const SLOT_ID = /^[a-f0-9]{12}$/;

export const emptyState = (): WordState => ({ slots: [null, null, null], selected: null });

/** Text is compared the way the editor stores it. */
export const clean = (text: unknown): string => (typeof text === 'string' ? text.normalize('NFC').trim() : '');
