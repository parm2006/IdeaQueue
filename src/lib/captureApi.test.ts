import { describe, expect, it, vi } from 'vitest';
import { handleCapture, type CaptureRequest, type CaptureResponse, type CaptureRpc, validateCapture } from '../../api/ideas';

const token = `iqc_${'a'.repeat(64)}`;
const config = { url: 'https://example.supabase.co', publicKey: 'public-key' };
function request(body: unknown = { text: 'Build a website' }, changes: Partial<CaptureRequest> = {}): CaptureRequest {
  return { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body, ...changes };
}
async function call(req: CaptureRequest, rpc: CaptureRpc = vi.fn().mockResolvedValue({
  data: [{ id: 'new-note', created_at: '2026-10-08T12:00:00Z' }], error: null,
}), settings = config) {
  const output = { status: 0, body: null as unknown, headers: {} as Record<string, string> };
  const response: CaptureResponse = {
    setHeader(name, value) { output.headers[name] = value; },
    status(code) { output.status = code; return this; },
    json(value) { output.body = value; },
  };
  await handleCapture(req, response, settings, rpc);
  return { ...output, rpc };
}
describe('Shortcut capture authorization', () => {
  it('does not offer listing, editing, popping or preflight routes', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const result = await call(request(undefined, { method }));
      expect(result.status).toBe(405);
      expect(result.headers.Allow).toBe('POST');
      expect(result.rpc).not.toHaveBeenCalled();
    }
  });
  it('rejects a missing, malformed or Google session bearer before contacting the database', async () => {
    for (const authorization of ['', token, 'Bearer session.jwt.token', `Bearer iqc_${'a'.repeat(63)}`]) {
      const result = await call(request({ text: 'hello' }, { headers: { authorization, 'content-type': 'application/json' } }));
      expect(result.status).toBe(401);
      expect(result.rpc).not.toHaveBeenCalled();
    }
  });
  it('maps invalid or revoked database tokens to a generic unauthorized response', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '28000', message: 'sensitive debug data' } });
    const result = await call(request(), rpc);
    expect(result.status).toBe(401);
    expect(JSON.stringify(result.body)).not.toContain('sensitive');
  });
  it('does not leak tokens, user IDs or note contents in the creation receipt', async () => {
    const result = await call(request());
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ id: 'new-note', created_at: '2026-10-08T12:00:00Z' });
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(result.rpc).toHaveBeenCalledWith(token, {
      text: 'Build a website', context: '', category: 'Projects', priority: 5, color: 'yellow',
    });
  });
  it('refuses caller-supplied identity, timestamps and reviewed state', async () => {
    for (const key of ['user_id', 'id', 'created_at', 'reviewed_at']) {
      const result = await call(request({ text: 'hello', [key]: 'spoof' }));
      expect(result.status).toBe(400);
      expect(result.rpc).not.toHaveBeenCalled();
    }
  });
});
describe('Shortcut capture validation', () => {
  it('returns 507 without a success receipt when storage is full or read-only', async () => {
    for (const code of ['53100', '25006']) {
      const result = await call(request(), vi.fn().mockResolvedValue({ data: null, error: { code, message: 'private database details' } }));
      expect(result.status).toBe(507);
      expect(result.body).toEqual({ error: expect.stringContaining('Keep your queue intact') });
      expect(JSON.stringify(result.body)).not.toContain('private database details');
    }
  });
  it('uses only note text for bucket inference and preserves manual context', () => {
    expect(validateCapture({ text: '  Calculus proof  ', context: 'Build a website' })).toEqual({
      text: 'Calculus proof', context: 'Build a website', category: 'Mathematics', priority: 5, color: 'yellow',
    });
    expect(validateCapture({ text: 'A thought', context: 'calculus' }).category).toBe('General');
    expect(validateCapture({ text: 'Calculus', category: 'Personal', priority: 10, color: 'pink' }).category).toBe('Personal');
  });
  it('rejects malformed fields and out-of-range values without a database write', async () => {
    for (const body of [null, [], { text: '' }, { text: 'a'.repeat(2001) }, { text: 'hello', context: 3 },
      { text: 'hello', context: 'a'.repeat(4001) }, { text: 'hello', category: 'nope' },
      { text: 'hello', priority: null }, { text: 'hello', priority: 0 }, { text: 'hello', priority: 11 }, { text: 'hello', priority: 1.5 },
      { text: 'hello', color: 'orange' }]) {
      const result = await call(request(body));
      expect(result.status).toBe(400);
      expect(result.rpc).not.toHaveBeenCalled();
    }
  });
  it('rejects oversize bodies, incorrect content types and invalid JSON', async () => {
    expect((await call(request(' '.repeat(17000)))).status).toBe(413);
    expect((await call(request('{'))).status).toBe(400);
    const result = await call(request({}, { headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' } }));
    expect(result.status).toBe(415);
    expect(result.rpc).not.toHaveBeenCalled();
  });
  it('fails closed when configuration is missing and sanitizes unexpected database errors', async () => {
    expect((await call(request(), undefined, { url: '', publicKey: '' })).status).toBe(503);
    const rpc = vi.fn().mockRejectedValue(new Error('database password leaked'));
    const result = await call(request(), rpc);
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('password');
  });
});
