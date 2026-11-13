export interface AgentConnectionRequest {
  clientId: string; redirectUri: string; challenge: string; resource: string; state: string; startedAt: number;
}
const pendingKey = 'ideaqueue.pending-connection';
export function parseConnectionRequest(search: string, origin: string): AgentConnectionRequest {
  const q = new URLSearchParams(search);
  for (const key of ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'state', 'response_type', 'scope']) {
    if (q.getAll(key).length > 1) throw new Error('The connection request has duplicate parameters.');
  }
  const clientId = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';
  const challenge = q.get('code_challenge') ?? '';
  const resource = q.get('resource') ?? '';
  const state = q.get('state') ?? '';
  if (!clientId || clientId.length > 128 || !redirectUri || redirectUri.length > 2048 || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || q.get('code_challenge_method') !== 'S256' || q.get('response_type') !== 'code' || resource !== `${origin}/api/mcp` || (q.has('scope') && q.get('scope') !== 'ideas:read') || state.length > 2048) throw new Error('This connection request is invalid or asks for unsupported access. Start again from your agent.');
  const redirect = new URL(redirectUri);
  if (redirect.username || redirect.password || redirect.hash || !(redirect.protocol === 'https:' || (redirect.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(redirect.hostname)))) throw new Error('Invalid return address.');
  return { clientId, redirectUri, challenge, resource, state, startedAt: Date.now() };
}
export function pendingConnection(): AgentConnectionRequest | null {
  try {
    const raw = sessionStorage.getItem(pendingKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as AgentConnectionRequest;
    if (!saved || !Number.isFinite(saved.startedAt) || Date.now() - saved.startedAt > 10 * 60 * 1000 || Date.now() < saved.startedAt) { clearConnection(); return null; }
    // Revalidate browser-stored data after returning from Google sign-in.
    const parsed = parseConnectionRequest(new URLSearchParams({ client_id: saved.clientId, redirect_uri: saved.redirectUri, code_challenge: saved.challenge, resource: saved.resource, state: saved.state, response_type: 'code', code_challenge_method: 'S256', scope: 'ideas:read' }).toString(), window.location.origin);
    return { ...parsed, startedAt: saved.startedAt };
  } catch { return null; }
}
export function rememberConnection(request: AgentConnectionRequest) { sessionStorage.setItem(pendingKey, JSON.stringify(request)); }
export function clearConnection() { sessionStorage.removeItem(pendingKey); }
export function connectionCallback(request: AgentConnectionRequest, origin: string, result: { code: string } | { error: string }): string {
  const redirect = new URL(request.redirectUri);
  // OAuth response parameters must never be supplied by a registered redirect query.
  for (const key of ['code', 'error', 'state', 'iss']) redirect.searchParams.delete(key);
  Object.entries(result).forEach(([key, value]) => redirect.searchParams.set(key, value));
  if (request.state) redirect.searchParams.set('state', request.state);
  redirect.searchParams.set('iss', origin);
  return redirect.href;
}
