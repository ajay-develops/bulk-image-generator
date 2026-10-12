import sharp from 'sharp';

import { PICTURE } from './types';

/**
 * Any image in, the app's picture out: 1152×768 WebP on white. Every picture
 * the app already ships is exactly this, and the app crops to fill its frame,
 * so a different shape would be cropped differently from the ones that fit.
 */
export async function toPicture(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(PICTURE.width, PICTURE.height, { fit: 'cover' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: PICTURE.quality })
    .toBuffer();
}

/**
 * Whether a picture is an empty white frame. The picture service sometimes
 * answers "success" with exactly that, most often for a description it is
 * uneasy about, and a slot filled with nothing is worse than an empty slot.
 * Fewer than one pixel in two hundred being anything but near-white counts
 * as empty, so a stray speck does not pass for a drawing.
 */
export async function isBlank(input: Buffer): Promise<boolean> {
  try {
    const data = await sharp(input).resize(192, 128, { fit: 'fill' }).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer();
    let drawn = 0;
    for (const value of data) if (value < 235) drawn += 1;
    return drawn / data.length < 0.005;
  } catch {
    // Not a picture at all: that is reported elsewhere, with its own message.
    return false;
  }
}

/**
 * How crisp a picture is, from 0 to about 1: at each strong edge, how much of
 * the change in brightness happens between two neighbouring pixels. A crisp
 * edge scores near 1; an edge smeared over several pixels scores about 0.3.
 * The value is the upper quartile over all edges. Null when the picture has
 * too few edges to say (a plain shape on white).
 */
export async function sharpness(input: Buffer): Promise<number | null> {
  const W = PICTURE.width, H = PICTURE.height;
  let d: Buffer;
  try {
    d = await sharp(input).resize(W, H, { fit: 'fill' }).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer();
  } catch {
    return null;
  }
  const ratios: number[] = [];
  for (let y = 2; y < H - 2; y += 2) {
    for (let x = 2; x < W - 2; x += 2) {
      const i = y * W + x;
      const across = Math.abs(d[i + 2] - d[i - 2]);
      const down = Math.abs(d[i + 2 * W] - d[i - 2 * W]);
      if (across > 50) ratios.push(Math.max(Math.abs(d[i + 1] - d[i]), Math.abs(d[i] - d[i - 1])) / across);
      if (down > 50) ratios.push(Math.max(Math.abs(d[i + W] - d[i]), Math.abs(d[i] - d[i - W])) / down);
    }
  }
  if (ratios.length < 200) return null;
  ratios.sort((a, b) => a - b);
  return Math.round(ratios[Math.floor(ratios.length * 0.75)] * 100) / 100;
}
