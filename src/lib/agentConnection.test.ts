import { describe, it, expect, vi } from 'vitest';
import { parseConnectionRequest, connectionCallback } from './agentConnection';
import { handleOAuth, validRedirect, type OAuthRpc } from '../../api/oauth';
import type { CaptureRequest, CaptureResponse } from '../../api/ideas';

const origin = 'https://iq.example';
const config = { origin, url: 'https://db.example', serverKey: 'server-only' };
const params = { client_id: 'iqclient_test', redirect_uri: 'http://127.0.0.1:9999/callback', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: `${origin}/api/mcp`, response_type: 'code', state: 'random-state', scope: 'ideas:read' };
async function call(action: string, body?: unknown, changes: Partial<CaptureRequest> = {}, rpc: OAuthRpc = vi.fn().mockResolvedValue({ data: 'client-1', error: null })) {
  const out = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res: CaptureResponse = { setHeader(k, v) { out.headers[k] = v; }, status(n) { out.status = n; return this; }, json(b) { out.body = b; }, end() {} };
  await handleOAuth({ url: `/api/oauth?action=${action}`, method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body, ...changes }, res, config, rpc);
  return { ...out, rpc };
}
describe('account connection request', () => {
  it('accepts only a read-only, resource-bound S256 request', () => {
    expect(parseConnectionRequest(new URLSearchParams(params).toString(), origin)).toMatchObject({ clientId: params.client_id, state: params.state });
    for (const replacement of [{ scope: 'all' }, { resource: 'https://other.example/api/mcp' }, { code_challenge_method: 'plain' }, { redirect_uri: 'javascript:alert(1)' }, { redirect_uri: 'http://evil.example/callback' }, { redirect_uri: 'https://user:pass@example.com' }]) {
      expect(() => parseConnectionRequest(new URLSearchParams({ ...params, ...replacement }).toString(), origin)).toThrow();
    }
    expect(() => parseConnectionRequest(new URLSearchParams(params) + '&client_id=other', origin)).toThrow('duplicate');
  });
  it('returns only a code or denial to the verified client and preserves state/issuer', () => {
    const req = parseConnectionRequest(new URLSearchParams(params).toString(), origin);
    const url = new URL(connectionCallback(req, origin, { code: 'one-use-code' }));
    expect(url.searchParams.get('state')).toBe(params.state);
    expect(url.searchParams.get('iss')).toBe(origin);
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(new URL(connectionCallback(req, origin, { error: 'access_denied' })).searchParams.get('error')).toBe('access_denied');
  });
});
describe('OAuth discovery, registration, and exchange', () => {
  it('returns 429 on account refresh limits instead of invalidating the connection', async () => {
    const result = await call('token', { grant_type: 'refresh_token', client_id: 'client', refresh_token: `iqr_${'a'.repeat(64)}`, resource: params.resource }, {}, vi.fn().mockResolvedValue({ data: null, error: { code: 'P0429' } }));
    expect(result.status).toBe(429);
    expect(result.headers['Retry-After']).toBe('3600');
    expect(result.body).toMatchObject({ error_description: expect.stringContaining('account') });
  });
  it('advertises OAuth and the read-only resource without database information', async () => {
    const metadata = await call('metadata');
    expect(metadata.body).toMatchObject({ issuer: origin, code_challenge_methods_supported: ['S256'], scopes_supported: ['ideas:read'] });
    expect(metadata.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(metadata.body)).not.toContain('db.example');
    expect((await call('resource')).body).toMatchObject({ resource: params.resource, authorization_servers: [origin] });
    expect((await call('', undefined, { url: '/.well-known/oauth-authorization-server' })).status).toBe(200);
  });
  it('does not expose client details through the public API', async () => {
    const result = await call('client', undefined, { url: `/api/oauth?action=client&client_id=known&redirect_uri=${encodeURIComponent(params.redirect_uri)}` });
    expect(result.status).toBe(404);
    expect(result.rpc).not.toHaveBeenCalled();
  });
  it('never advertises or accepts public registration', async () => {
    const metadata = await call('metadata');
    expect(metadata.body).not.toHaveProperty('registration_endpoint');
    for (const changes of [{}, { headers: { authorization: 'Bearer guessed-token', 'content-type': 'application/json' } }]) {
      const result = await call('register', { client_name: 'Attacker', redirect_uris: [params.redirect_uri] }, changes);
      expect(result.status).toBe(404);
      expect(result.rpc).not.toHaveBeenCalled();
    }
    for (const redirect of ['javascript:foo', 'http://evil.test', 'https://user:pw@example.test', 'https://example.test/#fragment']) expect(validRedirect(redirect)).toBe(false);
  });
  it('exchanges form or JSON codes only with a verifier and the correct resource', async () => {
    const body = { grant_type: 'authorization_code', code: 'code', client_id: params.client_id, redirect_uri: params.redirect_uri, code_verifier: 'x'.repeat(64), resource: params.resource };
    const rpc = vi.fn().mockResolvedValue({ data: [{ access_token: 'iqa_access', refresh_token: 'iqr_refresh' }], error: null });
    for (const req of [{ body, headers: { 'content-type': 'application/json' } }, { body: new URLSearchParams(body).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }]) {
      const result = await call('token', req.body, { headers: req.headers }, rpc);
      expect(result.status).toBe(200); expect(result.body).toMatchObject({ expires_in: 3600, scope: 'ideas:read', token_type: 'Bearer' });
    }
    expect(rpc).toHaveBeenCalledWith('exchange_agent_oauth_code', expect.objectContaining({ p_verifier: body.code_verifier, p_resource: params.resource }));
    const bad = await call('token', { ...body, resource: 'https://wrong.example' });
    expect(bad.status).toBe(400); expect(bad.rpc).not.toHaveBeenCalled();
    const replay = await call('token', body, {}, vi.fn().mockResolvedValue({ data: [], error: null }));
    expect(replay.body).toMatchObject({ error: 'invalid_grant' });
  });
  it('validates refresh and revocation requests, without exposing internal errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: { message: 'private database error' } });
    const result = await call('token', { grant_type: 'refresh_token', client_id: 'client', refresh_token: `iqr_${'a'.repeat(64)}`, resource: params.resource }, {}, rpc);
    expect(result.body).toMatchObject({ error: 'invalid_grant' });
    expect(JSON.stringify(result.body)).not.toContain('private');
    expect((await call('revoke', { client_id: 'client', token: 'token' }, {}, vi.fn().mockResolvedValue({ data: null, error: null }))).status).toBe(200);
  });
});
