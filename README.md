# Bulk image generator

Makes the word pictures for the Zema Fidelat app. It reads the words from the
[content editor](https://github.com/ajay-develops/zema-content-editor), draws
three pictures for each one, lets you pick one, and hands the picks back to
the editor as a zip.

It runs on your own machine. There is no login and nothing is hosted.

## The loop

1. In the content editor, press **Export zip**.
2. Here, press **Import words** and choose that zip.
3. Press **Generate all missing**, or **Generate 3 pictures** on one word.
   Tap the picture you want for each word.
4. Press **Export zip**.
5. In the content editor, press **Import pictures** and choose that zip.
6. When a picture needs changing: reword **What to draw** or press **Redo**,
   pick again, and export **Changed since last export**.

Importing words again never loses work. Pictures and choices are kept, new
words appear, and a word whose spelling or meaning changed after its picture
was chosen is marked **Word changed**.

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Put an NVIDIA API key in `.env.local`. Keys are free at
[build.nvidia.com](https://build.nvidia.com). The pictures come from NVIDIA's
hosted FLUX.1-dev, so nothing is downloaded or run locally.

## Running

```bash
pnpm start
```

This builds the app and serves it on port 3210 to every device on the network:

- on the same machine: http://localhost:3210
- from a phone or another computer on the same Tailscale network:
  `http://<this machine's Tailscale name>:3210`

`pnpm start` is the one to use day to day. It has no hot reload, so the page
cannot refresh under you while pictures are being made. `pnpm dev` is for
working on the code.

## The pictures

Every picture is **1152×768 WebP** on a white background. That is the exact
size and shape of the pictures the app already ships, and the app crops a
picture to fill its frame, so a different shape would be cropped differently.

The picture service is asked for 1216×832, not 1152×768: at the app's own
size it answers with a soft, blurred picture, and at 1216×832 it is sharp. The
result is trimmed by about ten rows top and bottom and scaled to 1152×768.

Each description is sent with one fixed style line (realistic, detailed
picture-dictionary illustration, true-to-life details, single subject, plain
white background, no words), so the whole set looks like one set. The app is
for children and teenagers, so the pictures show the real thing and not a
simplified cartoon. The line is `STYLE` in `src/lib/nvidia.ts`.

Two things learned the hard way about wording descriptions: the service
refuses prompts containing the word "seven" (say "the number 7"), and a
number draws best as "the number 7 written as one large bold digit".

`seed/subjects.json` holds hand-written descriptions for some words. They are
only the starting text of **What to draw**; whatever you type replaces them.

## Where things are kept

Everything generated is in `data/`, which is not in git:

```
data/words.json                 the words last imported from the editor
data/state.json                 per word: description, three pictures, the choice
data/images/<key>/<id>.webp     the pictures
```

Deleting `data/` starts over. Set `DATA_DIR` to keep it somewhere else.

## The zip this app exports

```
manifest.json
pictures/<word key>.webp
```

```jsonc
{
  "format": "zema-pictures",
  "version": 1,
  "exportedAt": "2026-10-11T17:00:17.759Z",
  "pictures": [
    {
      "key": "l1-o6-w2",
      "id": "vocab-geez-l1-o6-w2",
      "file": "pictures/l1-o6-w2.webp",
      "glyph": "…",
      "meaning": "monkey",
      "subject": "a cute cartoon monkey sitting"
    }
  ]
}
```

`glyph` and `meaning` are the word as it was when the picture was chosen. The
editor uses them to skip a picture made for a word that has since changed.

## Commands

```bash
pnpm start        # build and serve on 0.0.0.0:3210
pnpm dev          # development server, same port
pnpm test         # unit tests
pnpm typecheck
```
