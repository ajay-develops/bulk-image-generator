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
