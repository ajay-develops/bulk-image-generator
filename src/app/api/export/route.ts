import { exportZip } from '@/lib/actions';
import { failure } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get('scope') === 'changed' ? 'changed' : 'all';
    const { zip, filename, missing } = await exportZip(scope);
    return new Response(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        // Words left out because their picture file is gone. Encoded: header values are ASCII.
        'X-Missing-Pictures': encodeURIComponent(JSON.stringify(missing)),
      },
    });
  } catch (error) {
    return failure(error);
  }
}
