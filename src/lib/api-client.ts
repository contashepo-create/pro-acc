/**
 * Browser fetch for tenant APIs. Always bypasses HTTP cache so a successful
 * DELETE/PUT is followed by a fresh list — never a 5-minute stale snapshot
 * that still shows the deleted row (second click then 404 Not found).
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  let url = input;
  if (method === 'GET') {
    const sep = input.includes('?') ? '&' : '?';
    url = `${input}${sep}_ts=${Date.now()}`;
  }
  return fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
}
