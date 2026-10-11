import { ActionError, chooseSlot, saveSubject } from '@/lib/actions';
import { NO_STORE, failure } from '@/lib/respond';
import type { SlotIndex, WordState } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Saves the description, the choice, or both. */
export async function PUT(request: Request, ctx: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { subject?: unknown; selected?: unknown } | null;
    if (!body || (body.subject === undefined && body.selected === undefined)) throw new ActionError('Nothing to save.', 400);
    let state: WordState | undefined;
    if (body.subject !== undefined) state = await saveSubject(key, body.subject as string);
    if (body.selected !== undefined) state = await chooseSlot(key, body.selected as SlotIndex | null);
    return Response.json({ state }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
