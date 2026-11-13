import { describe, it, expect, vi } from 'vitest';
import { createIdea, hasAgentSuffix, isAgentVisible } from './queue';
import { validateImport } from './storage';
import { handleMcp, type AgentRpc } from '../../api/mcp';
import type { CaptureRequest, CaptureResponse } from '../../api/ideas';

describe('card visibility', () => {
  it('recognizes only a separate final AI or agent word, in every capitalization', () => {
    for (const suffix of ['AI', 'aI', 'Ai', 'ai', 'agent', 'AGENT', 'Agent', 'aGeNt']) {
      expect(hasAgentSuffix(`Build this ${suffix} \n`)).toBe(true);
      expect(isAgentVisible({ text: `Build this ${suffix}` })).toBe(true);
    }
    for (const text of ['bonsai', 'reagent', 'agent help', 'AI please', 'hello AI.', '']) expect(isAgentVisible({ text })).toBe(false);
  });
  it('shares by suffix after import and hides the card when the suffix is removed', () => {
    const note = createIdea({ text: 'Help AGENT' });
    expect(isAgentVisible(validateImport(JSON.parse(JSON.stringify([note])))[0])).toBe(true);
    expect(isAgentVisible({ ...note, text: 'Help' })).toBe(false);
    expect(isAgentVisible(validateImport([{ ...note, agent_visible: false }])[0])).toBe(true);
  });
});

const token = `iqa_${'a'.repeat(64)}`;
const config = { url: 'https://example.supabase.co', publicKey: 'public' };
async function call(body: unknown, changes: Partial<CaptureRequest> = {}, rpc: AgentRpc = vi.fn().mockResolvedValue({ data: [{ text: 'Selected' }], error: null })) {
  const output = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res: CaptureResponse = { setHeader(k, v) { output.headers[k] = v; }, status(n) { output.status = n; return this; }, json(b) { output.body = b; }, end() {} };
  await handleMcp({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, ...changes }, res, config, rpc);
  return { ...output, rpc };
}
const msg = (method: string, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
describe('read-only MCP', () => {
  it('returns a retryable 429 for the token owner’s account quota', async () => {
    const result = await call(msg('tools/call', { name: 'list_ideas' }), {}, vi.fn().mockResolvedValue({ data: null, error: { code: 'P0429' } }));
    expect(result.status).toBe(429);
    expect(result.headers['Retry-After']).toBe('3600');
    expect(result.body).toMatchObject({ error: { message: expect.stringContaining('account') } });
  });
  it('authenticates initialization and every tool call, returning JSON-RPC content', async () => {
    const init = await call(msg('initialize', { protocolVersion: '2025-03-26' }));
    expect(init.status).toBe(200);
    expect(init.body).toMatchObject({ result: { protocolVersion: '2025-03-26' } });
    expect(init.rpc).toHaveBeenCalledWith(token);
    expect((await call(msg('tools/list'))).body).toMatchObject({ result: { tools: [{ name: 'list_ideas', annotations: { readOnlyHint: true } }] } });
    const result = await call(msg('tools/call', { name: 'list_ideas', arguments: {} }));
    expect(result.body).toMatchObject({ result: { content: [{ text: JSON.stringify({ ideas: [{ text: 'Selected' }], limit: 100 }) }] } });
    expect(result.headers['Cache-Control']).toBe('no-store');
  });
  it('rejects missing, capture and JWT credentials before reading the database', async () => {
    for (const authorization of ['', `Bearer iqc_${'a'.repeat(64)}`, 'Bearer jwt']) {
      const result = await call(msg('tools/list'), { headers: { authorization, 'content-type': 'application/json' } });
      expect(result.status).toBe(401); expect(result.rpc).not.toHaveBeenCalled();
    }
  });
  it('rejects revoked tokens without leaking database details', async () => {
    const result = await call(msg('initialize'), {}, vi.fn().mockResolvedValue({ data: null, error: { code: '28000', message: 'secret' } }));
    expect(result.status).toBe(401); expect(JSON.stringify(result.body)).not.toContain('secret');
  });
  it('offers no writes, prevents arbitrary arguments and refuses browser origins', async () => {
    expect((await call(msg('tools/call', { name: 'delete_idea' }))).body).toMatchObject({ error: { code: -32602 } });
    expect((await call(msg('tools/call', { name: 'list_ideas', arguments: { user_id: 'other' } }))).body).toMatchObject({ error: { code: -32602 } });
    const origin = await call(msg('tools/list'), { headers: { origin: 'https://evil.test' } });
    expect(origin.status).toBe(403); expect(origin.rpc).not.toHaveBeenCalled();
    expect((await call(msg('tools/list'), { method: 'GET' })).status).toBe(405);
    expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
  });
});
