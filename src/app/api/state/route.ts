import { getAppState } from '@/lib/actions';
import { NO_STORE, failure } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getAppState(), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
