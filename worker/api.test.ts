import { describe, expect, it } from 'vitest';
import { handleApi, type ApiEnv } from './api';
import type { Idea } from '../src/lib/queue';

const URL_ROOT = 'https://ideaqueue.example';
const VISITOR = { 'oai-authenticated-user-id': 'owner-1', 'oai-authenticated-user-email': 'owner@example.com' };
const sampleIdea: Idea = {
  id: '7b35e83f-509a-4f64-b69a-85ef56d0f961', text: 'Read the book', context: 'At noon',
  category: 'Reading', priority: 7, color: 'blue', created_at: '2026-10-01T12:00:00.000Z', reviewed_at: null,
};

function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${URL_ROOT}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function database(first: Idea | null = null) {
  const calls: { sql: string; values: unknown[]; operation: string }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        all: async () => { calls.push({ sql, values: [], operation: 'all' }); return { results: [] }; },
        bind(...values: unknown[]) {
          return {
            first: async () => { calls.push({ sql, values, operation: 'first' }); return first; },
            run: async () => { calls.push({ sql, values, operation: 'run' }); return { meta: { changes: values.length / 8 } }; },
          };
        },
      };
    },
  } as ApiEnv['DB'];
  return { DB: db, calls };
}

describe('hosted API boundary', () => {
  it('chunks imports to respect D1 bound-parameter limits', async () => {
    const env = database();
    const ideas = Array.from({ length: 25 }, (_, index) => ({ ...sampleIdea, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
    const response = await handleApi(request('/api/import', 'POST', ideas, VISITOR), env);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ inserted: 25 });
    expect(env.calls).toHaveLength(3);
    expect(env.calls.every(call => call.values.length <= 100)).toBe(true);
  });
  it('returns visitor identity only to an authenticated visitor', async () => {
    const env = database();
    const anonymous = await handleApi(request('/api/session'), env);
    expect(anonymous?.status).toBe(401);
    const signedIn = await handleApi(request('/api/session', 'GET', undefined, VISITOR), env);
    expect(await signedIn?.json()).toEqual({ user: { id: 'owner-1', email: 'owner@example.com' } });
    expect(env.calls).toHaveLength(0);
  });

  it('accepts a service capture without visitor identity and supplies safe defaults', async () => {
    const env = database();
    const response = await handleApi(request('/api/ideas', 'POST', { text: 'Study algebra' }), env);
    expect(response?.status).toBe(201);
    const { idea } = await response!.json() as { idea: Idea };
    expect(idea).toMatchObject({ text: 'Study algebra', context: '', category: 'Mathematics', priority: 5, color: 'yellow', reviewed_at: null });
    expect(idea.id).toMatch(/^[\da-f]{8}-/i);
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0].sql).toContain('VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    expect(env.calls[0].values).toEqual([idea.id, idea.text, '', 'Mathematics', 5, 'yellow', idea.created_at, null]);
  });

  it('requires visitor identity for list, upsert, pop, and import', async () => {
    const env = database();
    for (const [path, method, body] of [
      ['/api/ideas', 'GET', undefined], ['/api/ideas', 'PUT', sampleIdea],
      ['/api/pop', 'POST', {}], ['/api/import', 'POST', [sampleIdea]],
    ] as const) {
      const response = await handleApi(request(path, method, body), env);
      expect(response?.status).toBe(401);
    }
    expect(env.calls).toHaveLength(0);
  });

  it('rejects cross-origin writes and non-JSON bodies', async () => {
    const env = database();
    const foreign = await handleApi(request('/api/ideas', 'POST', { text: 'Hello' }, { Origin: 'https://other.example' }), env);
    expect(foreign?.status).toBe(403);
    const wrongType = await handleApi(new Request(`${URL_ROOT}/api/ideas`, { method: 'POST', body: 'text=Hello', headers: { 'Content-Type': 'text/plain' } }), env);
    expect(wrongType?.status).toBe(415);
    expect(env.calls).toHaveLength(0);
  });

  it('rejects oversized capture bodies before writing', async () => {
    const env = database();
    const response = await handleApi(request('/api/ideas', 'POST', { text: 'x'.repeat(17_000) }), env);
    expect(response?.status).toBe(413);
    expect(env.calls).toHaveLength(0);
  });

  it('validates complete records before upsert and keeps supplied timestamps', async () => {
    const env = database();
    for (const invalid of [
      { ...sampleIdea, id: 'bad' },
      { ...sampleIdea, created_at: '2026-02-30T12:00:00.000Z' },
      { ...sampleIdea, priority: 11 },
      { ...sampleIdea, context: null },
    ]) {
      const response = await handleApi(request('/api/ideas', 'PUT', invalid, VISITOR), env);
      expect(response?.status).toBe(400);
    }
    expect(env.calls).toHaveLength(0);
    const response = await handleApi(request('/api/ideas', 'PUT', sampleIdea, VISITOR), env);
    expect(response?.status).toBe(200);
    expect(env.calls[0].values.at(-2)).toBe(sampleIdea.created_at);
    expect(env.calls[0].sql).toContain('ON CONFLICT(id) DO UPDATE');
  });

  it('uses one atomic SQLite update with queue ordering and an optional category', async () => {
    const env = database({ ...sampleIdea, reviewed_at: '2026-10-08T12:00:00.000Z' });
    const response = await handleApi(request('/api/pop', 'POST', { category: 'Reading' }, VISITOR), env);
    expect((await response?.json()).idea.id).toBe(sampleIdea.id);
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0].operation).toBe('first');
    expect(env.calls[0].sql).toMatch(/UPDATE ideas SET reviewed_at = \? WHERE id = \(\s*SELECT id/);
    expect(env.calls[0].sql).toContain("ORDER BY date(created_at, '-' || priority || ' days') ASC,");
    expect(env.calls[0].sql).toContain('priority DESC, created_at ASC, id ASC LIMIT 1');
    expect(env.calls[0].values[1]).toBe('Reading');
  });

  it('rejects an unknown pop category without changing the queue', async () => {
    const env = database();
    const response = await handleApi(request('/api/pop', 'POST', { category: 'Secret' }, VISITOR), env);
    expect(response?.status).toBe(400);
    expect(env.calls).toHaveLength(0);
  });

  it('rejects a stale visible-note pop without reviewing another idea', async () => {
    const env = database();
    const response = await handleApi(request('/api/pop', 'POST', { category: 'Reading', expected_id: sampleIdea.id }, VISITOR), env);
    expect(response?.status).toBe(409);
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0].sql).toContain('AND id = ?');
    expect(env.calls[0].values.slice(1)).toEqual(['Reading', sampleIdea.id]);
  });

  it('reviews the matching visible idea and validates its id', async () => {
    const env = database({ ...sampleIdea, reviewed_at: '2026-10-08T12:00:00.000Z' });
    const invalid = await handleApi(request('/api/pop', 'POST', { expected_id: 'not-an-id' }, VISITOR), env);
    expect(invalid?.status).toBe(400);
    expect(env.calls).toHaveLength(0);
    const response = await handleApi(request('/api/pop', 'POST', { expected_id: sampleIdea.id }, VISITOR), env);
    expect(response?.status).toBe(200);
    expect((await response?.json()).idea.id).toBe(sampleIdea.id);
    expect(env.calls[0].values.at(-1)).toBe(sampleIdea.id);
  });

  it('imports only validated unique records with conflict-safe inserts', async () => {
    const env = database();
    const duplicate = await handleApi(request('/api/import', 'POST', [sampleIdea, sampleIdea], VISITOR), env);
    expect(duplicate?.status).toBe(400);
    expect(env.calls).toHaveLength(0);
    const response = await handleApi(request('/api/import', 'POST', [sampleIdea], VISITOR), env);
    expect(await response?.json()).toEqual({ inserted: 1 });
    expect(env.calls[0].sql).toContain('ON CONFLICT(id) DO NOTHING');
    expect(env.calls[0].values).toEqual(Object.values(sampleIdea));
  });
});
