import { ActionError } from './actions';

/** Turns whatever an action threw into a response the page can show. */
export function failure(error: unknown): Response {
  if (error instanceof ActionError) {
    return Response.json({ error: error.message, ...(error.kind ? { kind: error.kind } : {}) }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: 'Something went wrong on this Mac. Look at the terminal the app runs in.' }, { status: 500 });
}

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
