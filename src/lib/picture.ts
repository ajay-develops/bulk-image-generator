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
