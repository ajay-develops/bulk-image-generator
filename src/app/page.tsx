import { Generator } from '@/components/Generator';
import { getAppState } from '@/lib/actions';

// Read from disk on every visit; the page itself then never reloads.
export const dynamic = 'force-dynamic';

export default async function Page() {
  return <Generator initial={await getAppState()} />;
}
