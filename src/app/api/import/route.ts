import { importWords } from '@/lib/actions';
import { NO_STORE, failure } from '@/lib/respond';

export const dynamic = 'force-dynamic';

/** The editor's export zip, sent as the request body itself. */
export async function POST(request: Request) {
  try {
    const zip = new Uint8Array(await request.arrayBuffer());
    return Response.json(await importWords(zip), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
