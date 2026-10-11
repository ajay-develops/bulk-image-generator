# Bulk Image Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local app that imports the content editor's words, generates three pictures per word, lets the developer pick one, and exports a zip the editor imports with one button.

**Architecture:** A Next.js app whose server side is a handful of small pure modules (manifest parsing, a JSON state store, a picture normaliser, an NVIDIA client, a zip builder) behind thin route handlers. The page is one client component tree that holds all state and only ever changes it from fetch responses. The editor gains a pure planning function and one dialog that reuses its existing upload and save paths.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, pnpm, sharp, fflate, vitest. NVIDIA hosted `black-forest-labs/flux.1-dev`.

**Spec:** `docs/superpowers/specs/2026-10-11-bulk-image-generator-design.md`

**Two repositories.** Tasks 1–7 are in `/Users/ajay/Projects/zemafidelat/bulk-image-generator`. Tasks 8–9 are in `/Users/ajay/Projects/zemafidelat/zema-content-editor`.

## Global Constraints

- Every generated picture is exactly **1152×768 WebP, quality 82**, flattened onto white.
- NVIDIA request: `width 1152`, `height 768`, `steps 30`, `cfg_scale 3.5`, `mode "base"`, endpoint `https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev`.
- The generator serves on `0.0.0.0:3210`. Day-to-day use is `pnpm start` (production build).
- Everything generated lives under `data/` (overridable with `DATA_DIR`), git-ignored. Nothing generated is written under `public/`, `src/` or `.next/`.
- `NVIDIA_API_KEY` is read from `.env.local` only. The repo is public: no key, no `data/`, no `.env.local` is ever committed.
- The page never reloads or navigates: no `router.refresh()`, no `<form>` submission, no `window.location` assignment; every button is `type="button"`.
- A word key matches `^l\d+-o\d(-w[2-9])?$`. Any route given a key or picture id that does not match its pattern answers 404 before touching the disk.
- The editor's export format is not changed. The editor `.env.local` points at the **live** database: never run the editor's `check:concurrency`, and do not write to the editor's data from scripts.
- Match the editor's conventions in the generator: route handlers take `ctx: RouteContext<'…'>` and `await ctx.params`; plain CSS in `globals.css`; plain-words comments.

## Review Focus

1. **A zip that is not the editor's export** (the generator's own zip, a photo, an old export version): refused with a message saying what was expected, and `words.json` untouched. Test in Task 1.
2. **A word that left the editor after its picture was chosen**: its state stays on disk, but it is not exported. Test in Task 4.
3. **Redoing or failing the slot that is currently selected**: the choice is cleared, so a zip can never carry a picture the developer did not see. Test in Task 2.
4. **A blank "what to draw" box**: generating is refused with a message, not sent as the style line alone. Test in Task 5.
5. **A pictures zip whose manifest names a file that is not in the zip, or the same key twice**: the editor lists it as skipped and imports the rest. Test in Task 8.

---

### Task 1: Project, types and words import

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/lib/types.ts`, `src/lib/manifest.ts`
- Test: `src/lib/manifest.test.ts`

**Interfaces:**
- Produces, in `src/lib/types.ts`:

```ts
export type Word = {
  key: string; id: string; level: number; lesson: number; order: number;
  fidel: string; index: number; glyph: string; meaning: string;
  romanization: string; hasPicture: boolean;
};
export type Slot = { id: string; seed: number; subject: string; createdAt: string };
export type WordState = {
  subject?: string;
  slots: [Slot | null, Slot | null, Slot | null];
  selected: 0 | 1 | 2 | null;
  selectedAt?: string;
  exportedAt?: string;
  madeFor?: { glyph: string; meaning: string };
};
export type StateMap = Record<string, WordState>;
export const PICTURE = { width: 1152, height: 768, quality: 82 } as const;
export const WORD_KEY = /^l\d+-o\d(-w[2-9])?$/;
export const SLOT_ID = /^[a-f0-9]{12}$/;
export const emptyState = (): WordState => ({ slots: [null, null, null], selected: null });
```

- Produces, in `src/lib/manifest.ts`:

```ts
export class ImportError extends Error {}
/** Reads manifest.json from the editor's export zip. Throws ImportError. */
export function parseEditorZip(bytes: Uint8Array): Word[];
/** True when the word's spelling or meaning differs from what its picture was chosen for. */
export function wordChanged(word: Word, state: WordState | undefined): boolean;
```

- [ ] **Step 1: Create the project files**

`package.json` scripts: `"dev": "next dev -H 0.0.0.0 -p 3210"`, `"start": "next build && next start -H 0.0.0.0 -p 3210"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`. Dependencies: `next ^16.3.5`, `react ^19.3.0`, `react-dom ^19.3.0`, `sharp ^0.35.4`, `fflate ^0.8.3`. Dev: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `vitest`. `tsconfig.json` with the `@/*` → `src/*` path, as the editor has. `.gitignore`: `node_modules`, `.next`, `.env*` with `!.env.example`, `data`, `*.tsbuildinfo`, `next-env.d.ts`, `.DS_Store`. `.env.example`: `NVIDIA_API_KEY=` with a comment naming build.nvidia.com as where to get one.

Run: `pnpm install`
Expected: installs without errors.

- [ ] **Step 2: Write the failing tests** in `src/lib/manifest.test.ts`

Build fixture zips in the test with `zipSync` from fflate. A helper `editorZip(words, overrides?)` writes `manifest.json` as `{ format: 'zema-content-export', version: 5, words }`.

```ts
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

it.each([
  ['not a zip', new Uint8Array([1, 2, 3])],
  ['a zip without manifest.json', zipSync({ 'a.txt': strToU8('x') })],
  ['the generator’s own zip', zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'zema-pictures', version: 1, pictures: [] })) })],
  ['an older export', editorZip([], { version: 4 })],
  ['a word with a bad key', editorZip([entry('../etc', { status: 'unchanged' })])],
])('refuses %s', (_name, bytes) => {
  expect(() => parseEditorZip(bytes)).toThrow(ImportError);
});

it('says what it expected', () => {
  expect(() => parseEditorZip(zipSync({ 'a.txt': strToU8('x') })))
    .toThrow(/Export zip.*content editor/i);
});

it('flags a word whose spelling or meaning changed since its picture was chosen', () => {
  const word = { ...base, glyph: 'ሀ', meaning: 'umbrella' };
  expect(wordChanged(word, undefined)).toBe(false);
  expect(wordChanged(word, { ...emptyState(), madeFor: { glyph: 'ሀ', meaning: 'umbrella' } })).toBe(false);
  expect(wordChanged(word, { ...emptyState(), madeFor: { glyph: 'ሀ', meaning: 'parachute' } })).toBe(true);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test src/lib/manifest.test.ts`
Expected: FAIL, `parseEditorZip` is not defined.

- [ ] **Step 4: Implement `src/lib/types.ts` and `src/lib/manifest.ts`**

Kept statuses are `unchanged`, `edited`, `added`. Accept manifest `version` 5 only. `hasPicture` is `entry.image != null`. Text fields are NFC-normalised and trimmed, the same in `wordChanged`.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test src/lib/manifest.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Project setup and reading the editor's export"
```

---

### Task 2: State store

**Files:**
- Create: `src/lib/store.ts`, `seed/subjects.json`
- Test: `src/lib/store.test.ts`

**Interfaces:**
- Consumes: `Word`, `WordState`, `StateMap`, `Slot`, `emptyState` from Task 1.
- Produces, in `src/lib/store.ts`:

```ts
export function dataDir(): string;                       // process.env.DATA_DIR ?? './data', resolved
export function imagePath(key: string, id: string): string;   // <data>/images/<key>/<id>.webp
export async function readWords(): Promise<Word[]>;      // [] when nothing imported yet
export async function writeWords(words: Word[]): Promise<void>;
export async function readState(): Promise<StateMap>;
/** Serialised: runs fn on the word's current state and saves the result atomically. */
export async function updateWord(key: string, fn: (state: WordState) => void): Promise<WordState>;
/** What the "what to draw" box starts with: saved text, else the carried-over description, else the meaning. */
export function startingSubject(word: Word, state: WordState | undefined): string;
/** Puts a new picture in a slot. Clears the choice if that slot was the chosen one. Returns the id it replaced, if any. */
export async function fillSlot(key: string, index: 0 | 1 | 2, slot: Slot): Promise<{ state: WordState; replaced: string | null }>;
/** Chooses a slot (or null to clear). Throws if the slot is empty. Records selectedAt and madeFor. */
export async function choose(key: string, index: 0 | 1 | 2 | null, word: Word): Promise<WordState>;
```

- [ ] **Step 1: Create `seed/subjects.json`**

Copy the `SUBJECTS` object from `../zema-content-editor/scripts/generate-pictures.ts` (the `const SUBJECTS: Record<string, string> = { … }` literal) into `seed/subjects.json` as plain JSON, leaving out the empty `l16-o7-w0` entry.

Run: `node -e "const s=require('./seed/subjects.json');console.log(Object.keys(s).length, Object.values(s).every(v=>v.length>3))"`
Expected: a count above 80, then `true`.

- [ ] **Step 2: Write the failing tests** in `src/lib/store.test.ts`

Each test sets `process.env.DATA_DIR` to a fresh `mkdtemp` directory.

```ts
it('starts empty', async () => {
  expect(await readWords()).toEqual([]);
  expect(await readState()).toEqual({});
});

it('does not lose updates when twenty writes land together', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    updateWord(`l1-o${(i % 7) + 1}`, (s) => { s.subject = `${s.subject ?? ''}x`; })));
  const state = await readState();
  expect(Object.values(state).reduce((n, s) => n + s.subject!.length, 0)).toBe(20);
});

it('leaves a readable file if a write is interrupted', async () => {
  await updateWord('l1-o1', (s) => { s.subject = 'a' });
  expect(readdirSync(dataDir()).filter((f) => f.includes('.tmp'))).toEqual([]);
  expect(JSON.parse(readFileSync(join(dataDir(), 'state.json'), 'utf8'))['l1-o1'].subject).toBe('a');
});

it('clears the choice when the chosen slot is redone', async () => {
  await fillSlot('l1-o1', 0, slot('aaaaaaaaaaaa'));
  await fillSlot('l1-o1', 1, slot('bbbbbbbbbbbb'));
  await choose('l1-o1', 0, word);
  const { state, replaced } = await fillSlot('l1-o1', 0, slot('cccccccccccc'));
  expect(replaced).toBe('aaaaaaaaaaaa');
  expect(state.selected).toBeNull();
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

it('starts the description from saved text, then the carried-over one, then the meaning', () => {
  expect(startingSubject({ ...word, key: 'l1-o6-w2' }, undefined)).toBe('a cute cartoon monkey sitting');
  expect(startingSubject({ ...word, key: 'l9-o9', meaning: 'spoon' }, undefined)).toBe('spoon');
  expect(startingSubject(word, { ...emptyState(), subject: 'mine' })).toBe('mine');
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test src/lib/store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `src/lib/store.ts`**

One module-level promise chain serialises every write. Each write goes to `state.json.<random>.tmp` in the same directory, then `rename`. `fillSlot` deletes the replaced picture file after the state is saved.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test src/lib/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "State store: words, slots and the choice, safe under concurrent writes"
```

---

### Task 3: Picture normaliser and NVIDIA client

**Files:**
- Create: `src/lib/picture.ts`, `src/lib/nvidia.ts`
- Test: `src/lib/picture.test.ts`, `src/lib/nvidia.test.ts`

**Interfaces:**
- Consumes: `PICTURE` from Task 1.
- Produces:

```ts
// picture.ts
/** Any image in, the app's picture out: 1152×768 WebP on white. */
export async function toPicture(input: Buffer): Promise<Buffer>;

// nvidia.ts
export const STYLE: string;   // the style line, copied verbatim from the old script
export class GenerateError extends Error {
  constructor(message: string, readonly kind: 'no-key' | 'rejected-key' | 'filtered' | 'busy' | 'failed');
}
export async function generatePicture(
  subject: string,
  options?: { fetch?: typeof fetch; seed?: number; wait?: (ms: number) => Promise<void>; apiKey?: string },
): Promise<{ image: Buffer; seed: number }>;
```

- [ ] **Step 1: Write the failing tests**

`picture.test.ts`:

```ts
it.each([[1152, 768], [1024, 1024], [600, 400], [2000, 900]])('turns %ix%i into 1152x768 webp', async (width, height) => {
  const input = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const meta = await sharp(await toPicture(input)).metadata();
  expect([meta.width, meta.height, meta.format, meta.hasAlpha]).toEqual([1152, 768, 'webp', false]);
});

it('puts transparent areas on white', async () => {
  const input = await sharp({ create: { width: 1152, height: 768, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const { data } = await sharp(await toPicture(input)).raw().toBuffer({ resolveWithObject: true });
  expect([data[0], data[1], data[2]].every((v) => v > 250)).toBe(true);
});
```

`nvidia.test.ts`, with a stub `fetch` that returns queued responses and a `wait` that resolves at once:

```ts
it('sends the description, the style line and the app’s size', async () => {
  const calls = stub([ok('AAAA')]);
  await generatePicture('a red umbrella', { fetch: calls.fetch, seed: 7, apiKey: 'k', wait });
  const body = JSON.parse(calls.requests[0].body);
  expect(body).toMatchObject({ width: 1152, height: 768, steps: 30, cfg_scale: 3.5, mode: 'base', seed: 7 });
  expect(body.prompt).toBe(`a red umbrella, ${STYLE}`);
  expect(calls.requests[0].headers.Authorization).toBe('Bearer k');
});

it('retries when the service is busy, then succeeds', async () => {
  const calls = stub([status(429), status(503), ok('AAAA')]);
  await expect(generatePicture('x', { fetch: calls.fetch, apiKey: 'k', wait })).resolves.toBeTruthy();
  expect(calls.requests).toHaveLength(3);
});

it('tries another seed when a picture is filtered', async () => {
  const calls = stub([filtered(), ok('AAAA')]);
  const out = await generatePicture('x', { fetch: calls.fetch, seed: 10, apiKey: 'k', wait });
  expect(out.seed).not.toBe(10);
});

it.each([
  ['no-key', [], undefined],
  ['rejected-key', [status(401)], 'k'],
  ['busy', [status(429), status(429), status(429), status(429)], 'k'],
  ['filtered', [filtered(), filtered(), filtered(), filtered()], 'k'],
  ['failed', [status(400)], 'k'],
])('fails as %s', async (kind, responses, apiKey) => {
  const calls = stub(responses);
  await expect(generatePicture('x', { fetch: calls.fetch, apiKey, wait })).rejects.toMatchObject({ kind });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/lib/picture.test.ts src/lib/nvidia.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules**

`toPicture`: `rotate()`, `resize(1152, 768, { fit: 'cover' })`, `flatten({ background: '#ffffff' })`, `webp({ quality: 82 })`. `generatePicture`: at most four attempts, wait `5000 * attempt` ms on 429 and 5xx, a 120-second timeout per request, 401 and 403 are `rejected-key` with no retry. A successful response is `artifacts[0]` with `finishReason === 'SUCCESS'` and a `base64` field, as in the old script. `apiKey` defaults to `process.env.NVIDIA_API_KEY`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test src/lib/picture.test.ts src/lib/nvidia.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Picture normaliser and NVIDIA client"
```

---

### Task 4: Export zip

**Files:**
- Create: `src/lib/export.ts`
- Test: `src/lib/export.test.ts`

**Interfaces:**
- Consumes: `Word`, `StateMap` from Task 1.
- Produces:

```ts
export type ExportScope = 'all' | 'changed';
/** The word keys an export of this scope would carry, in word order. */
export function exportKeys(words: Word[], state: StateMap, scope: ExportScope): string[];
export async function buildExport(
  words: Word[], state: StateMap, scope: ExportScope,
  readImage: (key: string, id: string) => Promise<Uint8Array>,
  now?: string,
): Promise<{ zip: Uint8Array; keys: string[] }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
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
  expect(exportKeys(words.filter((w) => w.key !== 'l2-o1'), state, 'all')).toEqual(['l1-o6-w2']);
});

it('changed scope carries only choices made since they last went out', () => {
  const s = structuredClone(state);
  s['l1-o6-w2'].selectedAt = '2026-10-10T10:00:00.000Z'; s['l1-o6-w2'].exportedAt = '2026-10-10T11:00:00.000Z';
  s['l2-o1'].selectedAt = '2026-10-10T12:00:00.000Z';    s['l2-o1'].exportedAt = '2026-10-10T11:00:00.000Z';
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/lib/export.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/export.ts`**

Pictures are stored in the zip uncompressed (WebP does not shrink); the manifest is deflated. `subject` is the chosen slot's own `subject`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test src/lib/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Export zip of the chosen pictures"
```

---

### Task 5: API routes

**Files:**
- Create: `src/app/api/state/route.ts`, `src/app/api/import/route.ts`, `src/app/api/words/[key]/route.ts`, `src/app/api/words/[key]/generate/route.ts`, `src/app/api/images/[key]/[id]/route.ts`, `src/app/api/export/route.ts`
- Create: `src/lib/actions.ts`
- Test: `src/lib/actions.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces, in `src/lib/actions.ts` (the routes are one-line wrappers, so the behaviour is tested here without a server):

```ts
export type CardView = Word & { state: WordState; subject: string; changed: boolean };
export type AppState = { words: CardView[]; hasKey: boolean };
export class ActionError extends Error { constructor(message: string, readonly status: 400 | 404 | 502); }

export async function getAppState(): Promise<AppState>;
export async function importWords(zip: Uint8Array): Promise<AppState>;
export async function saveSubject(key: string, subject: string): Promise<WordState>;
export async function chooseSlot(key: string, index: 0 | 1 | 2 | null): Promise<WordState>;
export async function generateSlot(
  key: string, index: 0 | 1 | 2,
  generate?: typeof generatePicture,
): Promise<{ state: WordState }>;
export async function exportZip(scope: ExportScope): Promise<{ zip: Uint8Array; filename: string }>;
```

- Produces, as HTTP:

| Route | Body | Answers |
| --- | --- | --- |
| `GET /api/state` | | `AppState` |
| `POST /api/import` | the zip as the raw request body | `AppState`, or 400 `{ error }` |
| `PUT /api/words/[key]` | `{ subject?: string, selected?: 0\|1\|2\|null }` | `{ state }` |
| `POST /api/words/[key]/generate` | `{ slot: 0\|1\|2 }` | `{ state }`, or 502 `{ error, kind }` |
| `GET /api/images/[key]/[id]` | | the WebP, `Cache-Control: public, max-age=31536000, immutable` |
| `GET /api/export?scope=all\|changed` | | the zip as an attachment `zema-pictures-<yyyy-mm-dd-hh-mm>.zip` |

- [ ] **Step 1: Write the failing tests** in `src/lib/actions.test.ts`

Fresh `DATA_DIR` per test; `importWords(editorZip([...]))` to set up; a fake `generate` returning a small PNG.

```ts
it('imports words and reports them with their starting description', async () => {
  const app = await importWords(zip);
  expect(app.words.map((w) => w.key)).toEqual(['l1-o6-w2', 'l2-o1']);
  expect(app.words[0]).toMatchObject({ subject: 'a cute cartoon monkey sitting', changed: false });
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
  expect(state.slots[1]).toMatchObject({ subject: 'a yellow lemon' });
  const meta = await sharp(imagePath('l2-o1', state.slots[1]!.id)).metadata();
  expect([meta.width, meta.height, meta.format]).toEqual([1152, 768, 'webp']);
});

it('refuses to generate from a blank description', async () => {
  await importWords(zip);
  await saveSubject('l2-o1', '   ');
  await expect(generateSlot('l2-o1', 0, fakeGenerate)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/what to draw/i) });
});

it('leaves the slot as it was when generating fails', async () => {
  await importWords(zip);
  await generateSlot('l2-o1', 0, fakeGenerate);
  const before = (await getAppState()).words.find((w) => w.key === 'l2-o1')!.state;
  await expect(generateSlot('l2-o1', 0, async () => { throw new GenerateError('busy', 'busy'); })).rejects.toMatchObject({ status: 502 });
  expect((await getAppState()).words.find((w) => w.key === 'l2-o1')!.state).toEqual(before);
});

it.each(['../x', 'l2-o1/..', 'nope', 'l2-o1-w1'])('answers 404 for the key %s', async (key) => {
  await expect(saveSubject(key, 'x')).rejects.toMatchObject({ status: 404 });
});

it('answers 404 for a word that was not imported', async () => {
  await importWords(zip);
  await expect(chooseSlot('l9-o1', 0)).rejects.toMatchObject({ status: 404 });
});

it('stamps what went out, so a changed export is then empty', async () => {
  await importWords(zip);
  await generateSlot('l2-o1', 0, fakeGenerate);
  await chooseSlot('l2-o1', 0);
  expect(Object.keys(unzipSync((await exportZip('changed')).zip))).toContain('pictures/l2-o1.webp');
  await expect(exportZip('changed')).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/nothing/i) });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/lib/actions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/actions.ts`**

`generateSlot` reads the description with `startingSubject`, calls `generate`, runs the result through `toPicture`, writes the file, then `fillSlot`. The slot id is 12 hex characters from `crypto.randomBytes(6)`. `hasKey` is whether `NVIDIA_API_KEY` is set.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test src/lib/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the six route handlers**

Each exports `dynamic = 'force-dynamic'`, calls its action, and maps `ActionError` to `Response.json({ error }, { status })`. The generate route sets `maxDuration = 300` and adds the `GenerateError` `kind` to its 502 body. The images route checks `WORD_KEY` and `SLOT_ID` before reading and answers 404 for a missing file.

- [ ] **Step 6: Verify against a running server**

Run: `DATA_DIR=$(mktemp -d) pnpm dev` in the background, then:

```bash
curl -s localhost:3210/api/state
curl -s -o /dev/null -w '%{http_code}\n' localhost:3210/api/images/..%2Fx/aaaaaaaaaaaa
curl -s -o /dev/null -w '%{http_code}\n' -X POST --data-binary 'junk' localhost:3210/api/import
```

Expected: `{"words":[],"hasKey":…}`, then `404`, then `400`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "API: state, import, describe and choose, generate, pictures, export"
```

---

### Task 6: The screen

**Files:**
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/components/Generator.tsx`, `src/components/WordCard.tsx`, `src/components/TopBar.tsx`
- Create: `src/lib/client.ts`, `src/lib/bulk.ts`
- Test: `src/lib/bulk.test.ts`

**Interfaces:**
- Consumes: `AppState`, `CardView`, `WordState` from Task 5 and the HTTP routes.
- Produces:

```ts
// client.ts: every call returns parsed JSON or throws Error(message from { error })
export function loadState(): Promise<AppState>;
export function importZip(file: File): Promise<AppState>;
export function putWord(key: string, body: { subject?: string; selected?: 0 | 1 | 2 | null }): Promise<{ state: WordState }>;
export function generate(key: string, slot: 0 | 1 | 2): Promise<{ state: WordState }>;
export function imageUrl(key: string, id: string): string;
export function downloadExport(scope: 'all' | 'changed'): Promise<void>;   // fetch → blob → hidden <a download>

// bulk.ts
export type Job = { key: string; slot: 0 | 1 | 2 };
export type Filter = 'needs' | 'unchosen' | 'all';
export function visibleWords(words: CardView[], filter: Filter): CardView[];
/** Every empty slot of the given words, in order. */
export function jobsFor(words: CardView[]): Job[];
/** Runs jobs `width` at a time. stop() lets the running ones finish and starts no more. */
export function runQueue(jobs: Job[], run: (job: Job) => Promise<void>, width?: number): { done: Promise<void>; stop: () => void };
```

- [ ] **Step 1: Write the failing tests** in `src/lib/bulk.test.ts`

```ts
it('filters: needs picture, no choice yet, all', () => {
  expect(visibleWords(words, 'needs').map((w) => w.key)).toEqual(['a', 'b']);      // hasPicture false
  expect(visibleWords(words, 'unchosen').map((w) => w.key)).toEqual(['a', 'c']);   // selected null
  expect(visibleWords(words, 'all')).toHaveLength(3);
});

it('lists every empty slot in word order', () => {
  expect(jobsFor([card('a', [filled, null, null]), card('b', [null, null, null])])).toEqual([
    { key: 'a', slot: 1 }, { key: 'a', slot: 2 }, { key: 'b', slot: 0 }, { key: 'b', slot: 1 }, { key: 'b', slot: 2 },
  ]);
});

it('never runs more than three at once', async () => {
  let running = 0, peak = 0;
  await runQueue(tenJobs, async () => { peak = Math.max(peak, ++running); await tick(); running--; }).done;
  expect(peak).toBe(3);
});

it('stop lets the running ones finish and starts no more', async () => {
  const started: string[] = [], finished: string[] = [];
  const q = runQueue(tenJobs, async (j) => { started.push(j.key); await tick(); finished.push(j.key); });
  q.stop();
  await q.done;
  expect(started).toHaveLength(3);
  expect(finished).toHaveLength(3);
});

it('carries on after one job fails', async () => {
  let ran = 0;
  await runQueue(tenJobs, async (j) => { ran++; if (j.key === 'w2') throw new Error('x'); }).done;
  expect(ran).toBe(10);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/lib/bulk.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/bulk.ts` and `src/lib/client.ts`**

Default `width` is 3. `importZip` posts the file itself as the body.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test src/lib/bulk.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the components**

`page.tsx` is a server component that calls `getAppState()` and renders `<Generator initial={…} />`; it exports `dynamic = 'force-dynamic'`. `Generator` owns `words`, `filter`, per-slot status (`idle | busy | { error }` keyed `key:slot`) and the bulk run handle. All state changes come from fetch responses, merged by word key.

Behaviour, with the exact copy:

- Top bar: **Import words**, **Export zip** (a small menu: "All chosen pictures (N)" and "Changed since last export (N)"; disabled with nothing chosen), **Generate all missing** / **Stop**, the three filters **Needs picture** (default), **No choice yet**, **All**, and "N of M chosen" counted over the current filter.
- No key: a banner "NVIDIA_API_KEY is missing. Add it to .env.local and restart." and every generate control disabled.
- Nothing imported: "Press Export zip in the content editor, then Import words here."
- Words are grouped under "Level N" headings. A card shows the glyph, meaning, pronunciation, key, "Letter X", a "Has a picture in the editor" note when `hasPicture`, and a **Word changed** badge when `changed`.
- **What to draw**: a textarea. Saved 400 ms after typing stops and on blur. Never overwritten by a response while it has focus.
- Three slots, each `aspect-ratio: 3 / 2`. Empty: grey frame. Busy: spinner. Error: the message and **Retry**. Filled: the picture, a **Redo** button and an expand button.
- **Generate** runs the card's empty slots. It is hidden when all three are filled.
- Tapping a picture chooses it; tapping the chosen one clears the choice. Chosen: a 4 px accent border and a tick in the corner; the other two at 55% opacity. The tap is applied at once and rolled back with a toast if the save fails.
- Expand: a full-width overlay of that picture; tap or Escape closes it.
- Phone (under 640 px): one column, three slots still in a row, the top bar wraps to two rows and stays sticky.
- Every `<button>` has `type="button"`. There is no `<form>`.

- [ ] **Step 6: Verify in a browser, against the real service**

Copy `NVIDIA_API_KEY` from `../zema-content-editor/.env.local` into this project's `.env.local`. Run `pnpm start`. Get the words: with the editor running locally (`pnpm dev` there) or on the live site, log in and press **Export zip**.

Check each of these and note the result:

1. Import the editor's zip: words appear by level, the count matches the editor's "Needs picture" total of 123 under **Needs picture**.
2. In the console run `window.__marker = 1`. Press **Generate** on one card: three pictures arrive one by one.
3. Choose one; choose another; clear the choice. Reload: the choice and pictures are still there.
4. Scroll halfway down, press **Generate all missing**, let about ten pictures arrive, press **Stop**. `window.__marker` is still `1` and the scroll position did not move.
5. Redo the chosen slot: the choice clears.
6. Resize to 375 px wide: nothing overflows sideways, the top bar is usable.
7. **Export zip** → "All chosen pictures": a zip downloads and the page does not navigate.
8. `sips -g pixelWidth -g pixelHeight` on a picture from the zip reports 1152 and 768.

Expected: all eight hold. Fix anything that does not before committing.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "The screen: word cards, three pictures, choosing, bulk generate, export"
```

---

### Task 7: README and the public repository

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

Sections: what it is; the loop with the content editor (the six steps from the spec); setup (`pnpm install`, copy `.env.example` to `.env.local`, add the key); running (`pnpm start`, open `http://<this Mac's Tailscale name>:3210`); where things are kept (`data/`); the zip format; commands.

- [ ] **Step 2: Check nothing private is tracked**

Run: `git ls-files | grep -E '^(data/|\.env\.local)' ; git grep -n 'nvapi-' ; echo done`
Expected: only `done`.

- [ ] **Step 3: Run everything once more**

Run: `pnpm typecheck && pnpm test && pnpm exec next build`
Expected: no type errors, all tests pass, the build succeeds.

- [ ] **Step 4: Commit and publish**

```bash
git add -A && git commit -m "README"
gh repo create ajay-develops/bulk-image-generator --public --source . --push \
  --description "Generates word pictures for the Zema Fidelat content editor: three per word, pick one, export a zip."
```

Expected: the repository URL is printed and `git status -sb` shows `main...origin/main`.

---

### Task 8: Editor — reading and sorting a pictures zip

Repository: `/Users/ajay/Projects/zemafidelat/zema-content-editor`. Work on a branch `import-pictures`.

**Files:**
- Create: `src/lib/picture-import.ts`
- Modify: `scripts/check-logic.ts` (add cases at the end of `main`)

**Interfaces:**
- Consumes: `EffectiveWord`, `isKept` from `src/lib/effective.ts`.
- Produces:

```ts
export type PictureAction = 'add' | 'replace' | 'skip-changed' | 'skip-missing' | 'skip-broken';
export type PlannedPicture = {
  key: string;
  /** The word as the zip describes it, for the summary list. */
  glyph: string;
  meaning: string;
  action: PictureAction;
  /** Present for add and replace only. */
  bytes?: Uint8Array;
};
/** Throws Error with a plain-words message when the file is not a pictures zip. */
export function planPictureImport(zip: Uint8Array, words: EffectiveWord[]): PlannedPicture[];
```

Rules, first match wins: the manifest entry's file is not in the zip, or its key already appeared → `skip-broken`; no kept word with that key → `skip-missing`; the word's glyph or meaning (NFC, trimmed) differs from the entry's → `skip-changed`; the word has `imageUrl` → `replace`; otherwise `add`. Accepted manifest: `format: 'zema-pictures'`, `version: 1`.

- [ ] **Step 1: Write the failing checks** at the end of `main` in `scripts/check-logic.ts`

Use `allWords({})` for the words, and build zips with `zipSync`. Pick `withPicture` as the first kept word that has `imageUrl` and `without` as the first kept word that has none.

```ts
const pic = new Uint8Array([1, 2, 3]);
const pzip = (pictures: object[], files: Record<string, Uint8Array>) =>
  zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'zema-pictures', version: 1, pictures })), ...files });
const e = (w: { key: string; glyph: string; meaning: string }, over = {}) =>
  ({ key: w.key, file: `pictures/${w.key}.webp`, glyph: w.glyph, meaning: w.meaning, ...over });

const planned = planPictureImport(pzip(
  [e(without), e(withPicture), e(other, { meaning: 'something else' }), e({ key: 'l1-o1-w9', glyph: 'x', meaning: 'y' }),
   e(third), e(without)],
  { [`pictures/${without.key}.webp`]: pic, [`pictures/${withPicture.key}.webp`]: pic, [`pictures/${other.key}.webp`]: pic, 'pictures/l1-o1-w9.webp': pic },
), kept);
assert.deepEqual(planned.map((p) => p.action), ['add', 'replace', 'skip-changed', 'skip-missing', 'skip-broken', 'skip-broken']);
assert.deepEqual(planned[0].bytes, pic);
assert.equal(planned[2].bytes, undefined);

// A word that is archived or removed is not there to receive a picture.
assert.equal(planPictureImport(pzip([e(without)], { [`pictures/${without.key}.webp`]: pic }), kept.filter((w) => w.key !== without.key))[0].action, 'skip-missing');

// Not a pictures zip: the editor's own export, and a file that is not a zip.
assert.throws(() => planPictureImport(zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'zema-content-export', version: 5 })) }), kept), /bulk image generator/i);
assert.throws(() => planPictureImport(new Uint8Array([9, 9, 9]), kept), /bulk image generator/i);
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm check`
Expected: FAIL, `planPictureImport` is not exported.

- [ ] **Step 3: Implement `src/lib/picture-import.ts`**

No `server-only` import: the browser runs this. Unzip with `unzipSync` from fflate.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm check && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/picture-import.ts scripts/check-logic.ts
git commit -m "Import pictures: read a generator zip and sort each picture"
```

---

### Task 9: Editor — the Import pictures button

**Files:**
- Create: `src/components/PictureImport.tsx`
- Modify: `src/components/Editor.tsx` (the top bar, next to **Export zip**; pass `words`, `edits` and `api`)
- Modify: `src/app/globals.css`, `README.md`

**Interfaces:**
- Consumes: `planPictureImport`, `PlannedPicture` from Task 8; `EditorApi.uploadImage(slot, file, onStage)` and `EditorApi.save(slot, next)` from `Editor.tsx`, unchanged.
- Produces:

```tsx
export function PictureImport(props: {
  words: EffectiveWord[];
  /** The edits as they are right now, read when each picture is saved. */
  getEdit: (key: string) => Edit | undefined;
  api: EditorApi;
  onClose: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Build the dialog**

Stages and exact copy:

1. **Choose**: a file input accepting `.zip`. A wrong file shows the thrown message and stays here.
2. **Summary**: "N new pictures", "N replace a picture the word already has", "N skipped". The replaces and the skips are listed by word ("ለሚን · lemon — the word has changed since this picture was made" / "— this word is not in the lessons" / "— the picture is missing from the zip"). A checkbox **Replace existing pictures**, ticked. Buttons **Import N pictures** and **Cancel**. Nothing is written before **Import**.
3. **Importing**: a progress bar and "N of M". Three pictures at a time. For each: `api.uploadImage(key, new File([bytes], `${key}.webp`, { type: 'image/webp' }), () => {})`, then `api.save(key, { ...(getEdit(key) ?? {}), image: media })`.
4. **Done**: "N pictures imported." Failures are listed with their reason and **Retry failed**, which runs only those. **Close**.

Closing during stage 3 is not offered; the button reads "Importing…" and is disabled. The dialog uses no `<form>`.

- [ ] **Step 2: Add the button to the top bar**

A ghost button **Import pictures** before **Export zip**, disabled while `edits` is null. It refuses with the existing "Still saving — try again in a moment." toast when `pending > 0`.

- [ ] **Step 3: Update the README**

A short section, "Pictures from the bulk image generator", describing the button, the summary and the zip format, and linking the generator's repository.

- [ ] **Step 4: Verify the build**

Run: `pnpm typecheck && pnpm check && pnpm build`
Expected: no type errors, checks pass, the build succeeds.

- [ ] **Step 5: Verify end to end, locally**

The local editor uses the **live** database, so use one word only and put it back.

1. In the generator, export a zip with exactly one chosen picture, for a word that has no picture in the editor.
2. `pnpm dev` in the editor, log in, **Import pictures**, pick the zip. The summary says "1 new picture".
3. **Import**. The word's card shows the picture and "All changes saved".
4. Reload the editor: the picture is still there. Press **Export zip**: the manifest lists that word's image as `source: "new"` with filename `vocab-geez-<key>.webp`.
5. Import the same zip again: the summary now says "1 replace".
6. Pick the editor's own export zip instead: the message names the bulk image generator and nothing changes.
7. Leave the picture in place if it is one the developer chose for real; otherwise press **Remove** on that word.

Expected: all seven hold.

- [ ] **Step 6: Commit**

```bash
git add src/components/PictureImport.tsx src/components/Editor.tsx src/app/globals.css README.md
git commit -m "Import pictures: a button that takes the bulk image generator's zip"
```

- [ ] **Step 7: Stop and ask before deploying**

Merging `import-pictures` into `main` and pushing deploys to the live editor the client uses. Report the verification results to the developer and wait for a clear yes before:

```bash
git checkout main && git merge --ff-only import-pictures && git push origin main
```
