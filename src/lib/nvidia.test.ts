import { describe, expect, it } from 'vitest';

import { GenerateError, STYLE, generatePicture } from './nvidia';

type Canned = { status: number; body: unknown };
const ok = (base64: string): Canned => ({ status: 200, body: { artifacts: [{ base64, finishReason: 'SUCCESS' }] } });
const filtered = (): Canned => ({ status: 200, body: { artifacts: [{ base64: '', finishReason: 'CONTENT_FILTERED' }] } });
const status = (code: number): Canned => ({ status: code, body: { detail: 'no' } });
const wait = async () => undefined;

function stub(responses: Canned[]) {
  const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fetch: fetchStub, requests };
}

describe('generatePicture', () => {
  it('sends the description, the style line and the app’s size', async () => {
    const calls = stub([ok('AAAA')]);
    const out = await generatePicture('a red umbrella', { fetch: calls.fetch, seed: 7, apiKey: 'k', wait });
    const body = JSON.parse(calls.requests[0].body);
    expect(body).toMatchObject({ width: 1152, height: 768, steps: 30, cfg_scale: 3.5, mode: 'base', seed: 7 });
    expect(body.prompt).toBe(`a red umbrella, ${STYLE}`);
    expect(calls.requests[0].headers.Authorization).toBe('Bearer k');
    expect(calls.requests[0].url).toBe('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev');
    expect(out.seed).toBe(7);
    expect(out.image.equals(Buffer.from('AAAA', 'base64'))).toBe(true);
  });

  it('retries when the service is busy, then succeeds', async () => {
    const calls = stub([status(429), status(503), ok('AAAA')]);
    await expect(generatePicture('x', { fetch: calls.fetch, apiKey: 'k', wait })).resolves.toBeTruthy();
    expect(calls.requests).toHaveLength(3);
  });

  it('retries when the network drops', async () => {
    let n = 0;
    const flaky = (async () => {
      if (n++ === 0) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(ok('AAAA').body), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(generatePicture('x', { fetch: flaky, apiKey: 'k', wait })).resolves.toBeTruthy();
  });

  it('tries another seed when a picture is filtered', async () => {
    const calls = stub([filtered(), ok('AAAA')]);
    const out = await generatePicture('x', { fetch: calls.fetch, seed: 10, apiKey: 'k', wait });
    expect(out.seed).not.toBe(10);
    expect(JSON.parse(calls.requests[1].body).seed).toBe(out.seed);
  });

  it.each([
    ['no-key', [], ''],
    ['rejected-key', [status(401)], 'k'],
    ['busy', [status(429), status(429), status(429), status(429)], 'k'],
    ['filtered', [filtered(), filtered(), filtered(), filtered()], 'k'],
    ['failed', [status(400)], 'k'],
  ] as [string, Canned[], string][])('fails as %s', async (kind, responses, apiKey) => {
    const expected = responses.length; // the stub uses them up
    const calls = stub(responses);
    const error = await generatePicture('x', { fetch: calls.fetch, apiKey, wait }).catch((e) => e);
    expect(error).toBeInstanceOf(GenerateError);
    expect(error.kind).toBe(kind);
    expect(calls.requests).toHaveLength(expected);
  });
});
