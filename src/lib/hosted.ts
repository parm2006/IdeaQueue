export interface WorkspaceUser { id: string; email?: string }

declare global { interface Window { __IDEAQUEUE_HOSTED__?: boolean } }
export const hosted = window.__IDEAQUEUE_HOSTED__ === true;

export async function workspaceApi<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Sign in again to open your private box. Reload this page to continue.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Your box could not be reached. Please retry.');
  return result as T;
}
