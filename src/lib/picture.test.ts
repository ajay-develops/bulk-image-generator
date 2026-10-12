import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { isBlank, sharpness, toPicture } from './picture';

const blank = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

describe('toPicture', () => {
  it.each([[1152, 768], [1216, 832], [1024, 1024], [600, 400], [2000, 900]])('turns %ix%i into 1152x768 webp', async (width, height) => {
    const meta = await sharp(await toPicture(await blank(width, height))).metadata();
    expect([meta.width, meta.height, meta.format, meta.hasAlpha]).toEqual([1152, 768, 'webp', false]);
  });

  it('puts transparent areas on white', async () => {
    const { data } = await sharp(await toPicture(await blank(1152, 768))).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]].every((v) => v > 250)).toBe(true);
  });

  it('refuses something that is not a picture', async () => {
    await expect(toPicture(Buffer.from('not a picture'))).rejects.toThrow();
  });

  it('knows an empty white picture from one with something in it', async () => {
    const white = await sharp({ create: { width: 1216, height: 832, channels: 3, background: '#fefefe' } }).jpeg().toBuffer();
    const drawn = await sharp({ create: { width: 1216, height: 832, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp({ create: { width: 300, height: 300, channels: 3, background: '#7a4a1e' } }).png().toBuffer(), left: 450, top: 260 }])
      .jpeg().toBuffer();
    // A stray speck is still an empty picture.
    const speck = await sharp({ create: { width: 1216, height: 832, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp({ create: { width: 12, height: 12, channels: 3, background: '#000000' } }).png().toBuffer(), left: 600, top: 400 }])
      .jpeg().toBuffer();
    expect(await isBlank(white)).toBe(true);
    expect(await isBlank(speck)).toBe(true);
    expect(await isBlank(drawn)).toBe(false);
    expect(await isBlank(Buffer.from('not a picture'))).toBe(false);
  });

  it('tells a crisp picture from a soft one', async () => {
    const crisp = await sharp({ create: { width: 1216, height: 832, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp({ create: { width: 400, height: 400, channels: 3, background: '#222222' } }).png().toBuffer(), left: 400, top: 200 }])
      .png().toBuffer();
    const soft = await sharp(crisp).blur(5).png().toBuffer();
    const plain = await sharp({ create: { width: 1216, height: 832, channels: 3, background: '#ffffff' } }).png().toBuffer();
    expect(await sharpness(crisp)).toBeGreaterThan(0.6);
    expect(await sharpness(soft)).toBeLessThan(0.42);
    expect(await sharpness(plain)).toBeNull();
    expect(await sharpness(Buffer.from('nope'))).toBeNull();
  });
});
