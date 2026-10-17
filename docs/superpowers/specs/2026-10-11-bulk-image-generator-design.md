# Bulk image generator — design

Date: 2026-10-11 · Status: draft, awaiting review

## Why

123 words in the Zema Fidelat content editor have no picture. A one-off script
(`zema-content-editor/scripts/generate-pictures.ts`) proved that NVIDIA's
hosted FLUX.1-dev draws them well, but it makes one picture per word, gives no
way to choose, and nothing puts the results into the editor.

The developer wants to pick one of three pictures per word, put the picks into
the editor in one go, and regenerate any the client rejects.

## The whole loop

1. In the editor, press **Export zip** (unchanged).
2. In the generator, **Import words** with that zip.
3. Generate, pick one of three per word.
4. In the generator, **Export zip**.
5. In the editor, **Import pictures** with that zip.
6. The client reviews in the editor. For each change he asks for: regenerate
   in the generator, pick, export, import again.

## Two pieces of work

| Where | What |
| --- | --- |
| `zemafidelat/bulk-image-generator` (new, public repo `ajay-develops/bulk-image-generator`) | The generator app |
| `zemafidelat/zema-content-editor` | One new button, **Import pictures**. Pushing to `main` deploys it to the live site |

The editor's export format does not change.

## The generator

### Running it

Next.js (App Router), TypeScript, pnpm, `sharp`, `fflate`. Local only, no login.

- `pnpm start` builds and serves on `0.0.0.0:3210`, so it opens from the phone
  or the MacBook over Tailscale. Day-to-day use is the production build: it has
  no hot reload, so nothing can refresh the page.
- `pnpm dev` is for working on the code.
- `NVIDIA_API_KEY` in `.env.local` (git-ignored). `.env.example` is committed.
  The app says so plainly on screen if the key is missing.

### What is stored

Everything generated lives in `data/`, git-ignored and outside anything the
dev server watches. Pictures are served through an API route, not `public/`.

```
data/words.json                 the words last imported from the editor
data/state.json                 per word: description, three slots, the choice
data/images/<key>/<id>.webp     the generated pictures
```

`state.json` per word key:

```jsonc
{
  "subject": "a cute cartoon monkey sitting",
  "slots": [ { "id": "a1b2c3", "seed": 48213, "subject": "…", "createdAt": "…" }, null, null ],
  "selected": 0,                      // slot index, or null
  "selectedAt": "…",
  "exportedAt": "…",                  // when this choice last went out in a zip
  "madeFor": { "glyph": "…", "meaning": "…" }   // the word as it was when chosen
}
```

Writes go through one in-process queue and an atomic rename, so two pictures
finishing together cannot corrupt the file.

### Words in

**Import words** takes the editor's export zip and reads `manifest.json`
(`format: zema-content-export`, version 5; any other format is refused with a
clear message). It keeps the words whose status is `unchanged`, `edited` or
`added`, in manifest order, which is the editor's order: level, letter, word.

Kept per word: `key`, `id`, `level`, `lesson`, `order`, `fidel`, `index`,
`glyph`, `meaning`, `romanization`, and `hasPicture` (`image` is not null).

Importing again replaces `words.json` and keeps `state.json`:

- a word that is new appears with empty slots;
- a word whose spelling or meaning changed since its picture was chosen is
  marked **Word changed** on its card, and its pictures and choice are kept;
- state for a key no longer in the manifest is kept on disk but not shown.

### The screen

One page, loaded once. A sticky top bar and a list of word cards grouped under
"Level N" headings, each card labelled with its letter.

Top bar:

- **Import words**, **Export zip**
- **Generate all missing**, which becomes **Stop** while running
- filter: **Needs picture** (default: the editor has no picture for it),
  **No choice yet**, **All**
- progress: "62 of 123 chosen"

Word card:

- the Tigrinya word, its meaning and pronunciation, its key, a "has a picture in
  the editor" note when that applies
- **What to draw**: a text box, prefilled from the meaning. Saved as you type.
- three picture slots in a row, each 3:2. An empty slot is a grey frame; a slot
  being generated shows a spinner; a failed slot shows the reason and **Retry**.
- **Generate** fills the empty slots. Each slot has its own **Redo**.
- tapping a picture selects it: a thick coloured border, a tick in the corner,
  and the other two dimmed. Tapping it again clears the choice.
- an expand button on each picture opens it full width, which matters on a
  phone where three across are small.

Phone layout: one column of cards, three pictures still side by side, the top
bar wraps onto two rows.

### Generating

`POST /api/words/[key]/generate { slot }` makes one picture and returns it.
A card's **Generate** sends one request per empty slot, so each picture
appears as it arrives.

- NVIDIA `black-forest-labs/flux.1-dev`: `width 1152`, `height 768`, `steps 30`,
  `cfg_scale 3.5`, `mode base`, a fresh random seed per slot.
- Prompt: the card's description plus the fixed style line from the old script
  (flat vector, children's vocabulary app, plain white background, no text).
- 429 and 5xx are retried with a growing wait, up to four times. A picture the
  service filters is retried with another seed.
- The result is flattened onto white and saved as WebP quality 82. If it is not
  1152×768 it is resized to cover that size, so every file matches.

**Why 1152×768.** All 151 pictures the app ships are 1152×768 WebP, and the app
shows them with `contentFit="cover"`. Same size, same shape, so nothing is
cropped differently from the pictures that already fit.

**Generate all missing** runs in the browser: it walks the words in the current
filter that have empty slots, three pictures at a time. **Stop** lets the three
in flight finish and starts no more. Closing the page stops it; everything
already made is on disk.

**Descriptions carried over.** The 81 hand-written descriptions in the old
script are committed as `seed/subjects.json` and used as the starting text for
those word keys. They are visible in the box, so a stale one is easy to spot.

### No page refresh

- Only client state changes: no `router.refresh()`, no form posts, no
  navigation. The top-bar buttons are `type="button"`.
- A new picture is added to state from the response of the request that made
  it. Its URL contains its id, so it is never a cached older picture.
- Export downloads through a hidden link, not by changing the page's address.
- Generated files are written outside every watched folder.

### Pictures out

`GET /api/export?scope=all|changed` streams a zip. **Export zip** offers both:
every chosen picture, or only choices made since they were last exported.
Exporting stamps `exportedAt` on what went out.

```
manifest.json
pictures/<key>.webp
```

```jsonc
{
  "format": "zema-pictures",
  "version": 1,
  "exportedAt": "…",
  "pictures": [
    { "key": "l1-o6-w2", "id": "vocab-geez-l1-o6-w2", "file": "pictures/l1-o6-w2.webp",
      "glyph": "…", "meaning": "monkey", "subject": "a cute cartoon monkey sitting" }
  ]
}
```

`glyph` and `meaning` are the word as the generator knew it, so the editor can
tell when a picture was made for a word that has since changed.

## The editor: Import pictures

A button next to **Export zip**. It opens a file picker for the generator's zip.

The browser unpacks the zip itself (`fflate`) — about 120 pictures is close to
Vercel's 4.5 MB request limit — and sorts each picture against the current
state of the editor:

| Result | When |
| --- | --- |
| **Add** | the word is in the lessons and has no picture |
| **Replace** | the word is in the lessons and already has a picture |
| **Skip: word changed** | spelling or meaning differs from what the picture was made for |
| **Skip: not found** | no such word, or it is removed or archived |

A summary shows the counts and lists the replaces and skips by word. **Replace
existing pictures** is ticked by default and can be unticked. Nothing is
written until **Import**.

Import saves each picture through the existing path, three at a time, with a
progress bar: upload to UploadThing, `/api/image/[slot]` converts it, and the
word's edit is saved as a normal picture change. So an imported picture is
exactly what the client would get by pressing **Add picture**: he can change
or remove it, the export lists it, and `pnpm settle` treats it as usual.

A picture that fails is listed with its reason and **Retry failed**; the ones
that succeeded stay. The sorting is a pure function in `src/lib`, so it is
tested without a browser.

## Errors

| Situation | What happens |
| --- | --- |
| Not the editor's zip, or a version the generator does not know | Refused, nothing changed |
| NVIDIA key missing or rejected | A banner; generating is disabled |
| Rate limit, timeout, filtered picture | Retried, then the slot shows the reason and **Retry** |
| Export with nothing chosen | The button is disabled |
| Generator zip made for words that have since changed | Those pictures are skipped and listed |

## Testing

Generator (`vitest`):

- manifest import: keeps the right statuses, keeps order, merge on re-import
  keeps choices and flags changed words
- state store: concurrent writes do not lose updates
- export: zip contents and manifest, `changed` scope, `exportedAt` stamping
- picture normalising: any input comes out 1152×768 WebP
- NVIDIA client against a stubbed fetch: retry, filtered picture, hard failure

Editor: cases for the sorting function added to `pnpm check`.

By hand, in a browser against the real service: import the editor's zip,
generate a card, pick, export, import into a local editor. For the refresh
rule: set a marker on `window`, run **Generate all missing** over several
words, confirm the marker is still there and the scroll position did not move.

## Not in this version

- Login or hosting
- Drawn symbols for numbers and colours
- Pushing pictures straight into the editor without a zip
- Showing the editor's existing picture next to the candidates
