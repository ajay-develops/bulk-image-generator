import { randomInt } from 'node:crypto';

import { REQUEST } from './types';

const URL = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev';
const ATTEMPTS = 4;

/**
 * Added to every description, so all the pictures look like one set. The app
 * is for children and teenagers: the pictures should show the real thing, with
 * the details that make it recognisable, not a simplified cartoon of it.
 */
export const STYLE =
  'realistic detailed illustration for an educational picture dictionary, true-to-life shape, proportions, colors and details, natural and not cartoonish, clean crisp linework with soft shading, the subject large in the frame, centered and fully visible, plain pure white background, sharp focus, no captions, no words, no watermark';

export type GenerateKind = 'no-key' | 'rejected-key' | 'filtered' | 'busy' | 'failed';

/** The message is written for the person at the screen. */
export class GenerateError extends Error {
  constructor(message: string, readonly kind: GenerateKind) {
    super(message);
  }
}

type Options = {
  fetch?: typeof fetch;
  seed?: number;
  wait?: (ms: number) => Promise<void>;
  apiKey?: string;
};

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const newSeed = () => randomInt(1, 2_000_000_000);

/**
 * One picture from NVIDIA's hosted FLUX.1-dev, at the size it draws sharply. A busy
 * service is waited out and a filtered picture is tried again with another
 * seed, four attempts in all.
 */
export async function generatePicture(subject: string, options: Options = {}): Promise<{ image: Buffer; seed: number }> {
  const key = options.apiKey ?? process.env.NVIDIA_API_KEY;
  if (!key) throw new GenerateError('NVIDIA_API_KEY is missing. Add it to .env.local and restart.', 'no-key');
  const send = options.fetch ?? fetch;
  const wait = options.wait ?? sleep;
  let seed = options.seed ?? newSeed();
  let last: GenerateError = new GenerateError('The picture service did not answer.', 'busy');

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await send(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${subject}, ${STYLE}`,
          width: REQUEST.width,
          height: REQUEST.height,
          seed,
          steps: 30,
          cfg_scale: 3.5,
          mode: 'base',
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      last = new GenerateError('Could not reach the picture service. Check the connection and try again.', 'busy');
      if (attempt < ATTEMPTS) await wait(3000 * attempt);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new GenerateError('The picture service rejected the NVIDIA key. Check NVIDIA_API_KEY in .env.local.', 'rejected-key');
    }
    if (response.status === 429 || response.status >= 500) {
      last = new GenerateError('The picture service is busy. Try again in a minute.', 'busy');
      if (attempt < ATTEMPTS) await wait(5000 * attempt);
      continue;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 160);
      throw new GenerateError(`The picture service refused the request (${response.status}). ${detail}`.trim(), 'failed');
    }

    const body = (await response.json().catch(() => null)) as { artifacts?: { base64?: string; finishReason?: string }[] } | null;
    const art = body?.artifacts?.[0];
    if (art?.finishReason === 'SUCCESS' && art.base64) return { image: Buffer.from(art.base64, 'base64'), seed };
    // Filtered, or an empty answer: another seed usually gets through.
    last = new GenerateError('The picture service would not draw this. Try describing it differently.', 'filtered');
    seed = newSeed();
  }
  throw last;
}
