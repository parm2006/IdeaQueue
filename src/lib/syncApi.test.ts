import { describe, expect, it, vi } from 'vitest';
import { handleSync } from '../../api/sync';
import type { CaptureRequest, CaptureResponse, CaptureRpc } from '../../api/ideas';

const token = `iqc_${'b'.repeat(64)}`;
const config = { url: 'https://example.supabase.co', publicKey: 'public-key' };
const note = JSON.stringify({ text: 'Sketch the garden' });
function request(body: unknown = { outbox: note }, changes: Partial<CaptureRequest> = {}): CaptureRequest {
  return { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, ...changes };
}
async function call(req: CaptureRequest, rpc: CaptureRpc = vi.fn().mockResolvedValue({
  data: [{ id: 'new-note', created_at: '2026-10-13T12:00:00Z' }], error: null,
})) {
  const output = { status: 0, body: null as unknown, headers: {} as Record<string, string> };
  const response: CaptureResponse = {
    setHeader(name, value) { output.headers[name] = value; },
    status(code) { output.status = code; return this; },
    json(value) { output.body = value; },
  };
  await handleSync(req, response, config, rpc);
  return { ...output, rpc };
}

describe('Shortcut offline outbox sync', () => {
  it('saves each valid queued note in order and returns one small receipt', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'saved', created_at: '2026-10-13T12:00:00Z' }], error: null });
    const result = await call(request({ outbox: `${note}\n${JSON.stringify({ text: 'Call Mum', priority: 8 })}` }), rpc);
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ saved: 2 });
    expect(rpc).toHaveBeenNthCalledWith(1, token, expect.objectContaining({ text: 'Sketch the garden' }));
    expect(rpc).toHaveBeenNthCalledWith(2, token, expect.objectContaining({ text: 'Call Mum', priority: 8 }));
  });

  it('rejects malformed, empty, or oversized queues before writing anything', async () => {
    for (const body of [{ outbox: '' }, { outbox: '{' }, { outbox: note, other: true }, { outbox: Array.from({ length: 51 }, () => note).join('\n') }]) {
      const result = await call(request(body));
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.rpc).not.toHaveBeenCalled();
    }
  });

  it('requires the same POST, JSON, and opaque token protections as direct capture', async () => {
    const cases: CaptureRequest[] = [
      request(undefined, { method: 'GET' }),
      request(undefined, { headers: { authorization: '', 'content-type': 'application/json' } }),
      request(undefined, { headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' } }),
    ];
    for (const item of cases) {
      const result = await call(item);
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.rpc).not.toHaveBeenCalled();
    }
  });
});
