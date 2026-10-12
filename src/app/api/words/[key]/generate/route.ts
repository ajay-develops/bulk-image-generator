import { generateSlot, sharpenSlot } from '@/lib/actions';
import { NO_STORE, failure } from '@/lib/respond';
import type { SlotIndex } from '@/lib/types';

export const dynamic = 'force-dynamic';
// A busy picture service is waited out, up to four attempts of two minutes each.
export const maxDuration = 300;

/** Makes one picture for one slot and answers with the word's new state. */
export async function POST(request: Request, ctx: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { slot?: unknown; sharpen?: unknown } | null;
    // sharpen: redraw the picture that is there from its own seed, keeping a choice of it.
    const act = body?.sharpen === true ? sharpenSlot : generateSlot;
    return Response.json(await act(key, body?.slot as SlotIndex), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
