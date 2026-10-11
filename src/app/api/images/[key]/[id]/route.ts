import { readPicture } from '@/lib/actions';
import { failure } from '@/lib/respond';

export const dynamic = 'force-dynamic';

/** A picture never changes once made (a redo gets a new id), so the browser may keep it. */
export async function GET(_request: Request, ctx: { params: Promise<{ key: string; id: string }> }) {
  try {
    const { key, id } = await ctx.params;
    const picture = await readPicture(key, id);
    return new Response(new Uint8Array(picture), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch (error) {
    return failure(error);
  }
}
