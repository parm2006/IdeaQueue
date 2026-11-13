import { CaptureError, header, parseJsonBody, type CaptureRequest, type CaptureResponse } from './ideas.js';
import { connectorClient, connectorConfig, type ConnectorConfig } from '../server/connectorConfig.js';

export type OAuthRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
export function validRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return !u.username && !u.password && !u.hash && (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)));
  } catch { return false; }
}
export async function handleOAuth(req: CaptureRequest, res: CaptureResponse, config: ConnectorConfig, rpc: OAuthRpc) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // These public OAuth endpoints use no cookies. Discovery is public; account setup requires authenticated IQ RPCs.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  try {
    if (req.method === 'OPTIONS') { res.status(204); return res.end?.(); }
    const url = new URL(req.url ?? '', config.origin);
    const action = req.query?.action ?? url.searchParams.get('action') ?? (url.pathname.startsWith('/.well-known/oauth-protected-resource') ? 'resource' : url.pathname === '/.well-known/oauth-authorization-server' ? 'metadata' : null);
    const resource = `${config.origin}/api/mcp`;
    if (req.method === 'GET' && action === 'resource') return res.status(200).json({ resource, authorization_servers: [config.origin], scopes_supported: ['ideas:read'], bearer_methods_supported: ['header'], resource_name: 'IdeaQueue' });
    if (req.method === 'GET' && action === 'metadata') return res.status(200).json({ issuer: config.origin, authorization_endpoint: `${config.origin}/connect`, token_endpoint: `${config.origin}/api/oauth?action=token`, revocation_endpoint: `${config.origin}/api/oauth?action=revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['ideas:read'], authorization_response_iss_parameter_supported: true });
    if (action === 'register') throw new CaptureError(404, 'Public client registration is disabled. Sign in to IQ to create a connector.');
    if (!config.url || !config.serverKey) throw new CaptureError(503, 'Account connections are not configured yet.');
    if (action === 'client') throw new CaptureError(404, 'Sign in to IQ to inspect your own connector.');
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); throw new CaptureError(405, 'Unsupported method.'); }
    let body: unknown;
    const type = header(req, 'content-type');
    if (/^application\/x-www-form-urlencoded(?:;|$)/i.test(type)) {
      if (typeof req.body === 'string') {
        if (req.body.length > 16384) throw new CaptureError(400, 'Invalid form body.');
        const params = new URLSearchParams(req.body);
        if ([...params.keys()].some(k => params.getAll(k).length !== 1)) throw new CaptureError(400, 'Duplicate parameters.');
        body = Object.fromEntries(params);
      } else {
        body = parseJsonBody(req);
        if (!body || typeof body !== 'object' || Object.values(body).some(v => typeof v !== 'string')) throw new CaptureError(400, 'Invalid form body.');
      }
    } else if (/^application\/json(?:;|$)/i.test(type)) body = parseJsonBody(req);
    else throw new CaptureError(415, 'Use JSON or form encoding.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CaptureError(400, 'Invalid request body.');
    const b = body as Record<string, unknown>;
    if (action === 'token') {
      if (typeof b.client_id !== 'string' || b.resource !== resource || (b.scope !== undefined && b.scope !== 'ideas:read')) throw new CaptureError(400, 'Invalid client, resource, or scope.');
      let result;
      if (b.grant_type === 'authorization_code') {
        if (typeof b.code !== 'string' || !validRedirect(b.redirect_uri) || typeof b.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier)) throw new CaptureError(400, 'Invalid code exchange.');
        result = await rpc('exchange_agent_oauth_code', { p_client_id: b.client_id, p_code: b.code, p_redirect_uri: b.redirect_uri, p_verifier: b.code_verifier, p_resource: resource });
      } else if (b.grant_type === 'refresh_token') {
        if (typeof b.refresh_token !== 'string' || !/^iqr_[a-f0-9]{64}$/.test(b.refresh_token)) throw new CaptureError(400, 'Invalid refresh token.');
        result = await rpc('refresh_agent_oauth_token', { p_client_id: b.client_id, p_refresh: b.refresh_token, p_resource: resource });
      } else throw new CaptureError(400, 'Unsupported grant type.');
      if (result.error?.code === 'P0429') throw new CaptureError(429, 'Your account’s hourly or daily connector limit has been reached.');
      if (result.error || !Array.isArray(result.data) || !result.data[0]) return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization expired, inactive, revoked, already used, or invalid.' });
      return res.status(200).json({ ...(result.data[0] as object), token_type: 'Bearer', expires_in: 3600, scope: 'ideas:read' });
    }
    if (action === 'revoke') {
      if (typeof b.token !== 'string' || typeof b.client_id !== 'string') throw new CaptureError(400, 'Token and client ID required.');
      const result = await rpc('revoke_agent_oauth_token', { p_client_id: b.client_id, p_token: b.token });
      if (result.error) throw new CaptureError(503, 'Revocation is unavailable.');
      return res.status(200).json({});
    }
    throw new CaptureError(404, 'Unknown OAuth endpoint.');
  } catch (e) {
    const known = e instanceof CaptureError;
    if (known && e.status === 429) res.setHeader('Retry-After', '3600');
    return res.status(known ? e.status : 503).json({ error: known && e.status < 500 && e.status !== 429 ? 'invalid_request' : 'temporarily_unavailable', error_description: known ? e.message : 'Account connection is unavailable.' });
  }
}
export default async function handler(req: CaptureRequest, res: CaptureResponse) {
  const config = connectorConfig();
  return handleOAuth(req, res, config, async (name, args) => connectorClient(config).rpc(name, args));
}
