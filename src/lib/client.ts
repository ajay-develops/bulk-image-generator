import type { AppState } from './actions';
import type { SlotIndex, WordState } from './types';

/** Parsed JSON, or an Error carrying the server's own message. */
async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) {
    const error = new Error(body?.error ?? `The app on this Mac did not answer properly (${response.status}).`) as Error & { kind?: string; status?: number };
    error.kind = (body as { kind?: string } | null)?.kind;
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function loadState(): Promise<AppState> {
  return json(await fetch('/api/state', { cache: 'no-store' }));
}

export async function importZip(file: File): Promise<AppState> {
  return json(await fetch('/api/import', { method: 'POST', body: file, headers: { 'Content-Type': 'application/zip' } }));
}

export async function putWord(key: string, body: { subject?: string; selected?: SlotIndex | null; id?: string }): Promise<{ state: WordState }> {
  return json(await fetch(`/api/words/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }));
}

export async function generate(key: string, slot: SlotIndex): Promise<{ state: WordState }> {
  return json(await fetch(`/api/words/${key}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot }) }));
}

export function imageUrl(key: string, id: string): string {
  return `/api/images/${key}/${id}`;
}

/** Fetches the zip and saves it through a hidden link, so the page itself never goes anywhere. */
export async function downloadExport(scope: 'all' | 'changed'): Promise<{ missing: string[] }> {
  const response = await fetch(`/api/export?scope=${scope}`, { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Could not build the zip.');
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'zema-pictures.zip';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  try {
    return { missing: JSON.parse(decodeURIComponent(response.headers.get('X-Missing-Pictures') ?? '%5B%5D')) as string[] };
  } catch {
    return { missing: [] };
  }
}
