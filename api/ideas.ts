import { createClient } from '@supabase/supabase-js';
import { categories, colors, inferCategory, type Category, type NoteColor } from '../src/lib/queue.js';

// Structural Node request/response types avoid an additional runtime dependency.
export interface CaptureRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface CaptureResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): CaptureResponse;
  json(value: unknown): unknown;
}
export interface CaptureInput { text: string; context: string; category: Category; priority: number; color: NoteColor }
export interface CaptureConfig { url?: string; publicKey?: string }
export type CaptureRpc = (token: string, input: CaptureInput) => Promise<{
  data: { id: string; created_at: string }[] | null;
  error: { code?: string; message?: string } | null;
}>;
export const BODY_LIMIT = 16 * 1024;
export const TOKEN_PATTERN = /^iqc_[a-f0-9]{64}$/;
export class CaptureError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function checkStorageError(error: { code?: string }): void {
  if (error.code === '53100' || error.code === '25006') {
    throw new CaptureError(507, 'Cloud storage is full or unavailable. Keep your queue intact and retry after space is freed.');
  }
}
export function header(request: CaptureRequest, name: string): string {
  const value = request.headers[name];
  return typeof value === 'string' ? value : '';
}

/** Parse a small JSON request body consistently across Vercel's parsed and raw forms. */
export function parseJsonBody(request: CaptureRequest, limit = BODY_LIMIT): unknown {
  const declaredSize = Number(header(request, 'content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > limit) throw new CaptureError(413, 'Request body is too large.');
  let body = request.body;
  if (typeof body === 'string') {
    if (new TextEncoder().encode(body).length > limit) throw new CaptureError(413, 'Request body is too large.');
    try { return JSON.parse(body); } catch { throw new CaptureError(400, 'Invalid JSON body.'); }
  }
  if (new TextEncoder().encode(JSON.stringify(body) ?? '').length > limit) throw new CaptureError(413, 'Request body is too large.');
  return body;
}

export function authorizeCapture(request: CaptureRequest): string {
  const authorization = header(request, 'authorization');
  if (!authorization.startsWith('Bearer ') || !TOKEN_PATTERN.test(authorization.slice(7))) {
    throw new CaptureError(401, 'A valid Shortcut capture token is required.');
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(header(request, 'content-type'))) {
    throw new CaptureError(415, 'Use application/json.');
  }
  return authorization.slice(7);
}

/** Reject identity/timestamps in capture input: the database sets the owner and capture time. */
export function validateCapture(value: unknown): CaptureInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CaptureError(400, 'Expected a JSON object.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['text', 'context', 'category', 'priority', 'color'].includes(key))) {
    throw new CaptureError(400, 'Only text, context, category, priority and color are accepted.');
  }
  if (typeof row.text !== 'string' || !row.text.trim() || row.text.trim().length > 2000) {
    throw new CaptureError(400, 'Idea text must contain 1–2000 characters.');
  }
  if (row.context !== undefined && (typeof row.context !== 'string' || row.context.trim().length > 4000)) {
    throw new CaptureError(400, 'Context must contain at most 4000 characters.');
  }
  if (row.category !== undefined && !categories.includes(row.category as Category)) throw new CaptureError(400, 'Choose a valid category.');
  if (row.color !== undefined && !colors.includes(row.color as NoteColor)) throw new CaptureError(400, 'Choose a valid note color.');
  const priority = row.priority === undefined ? 5 : row.priority;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 1 || priority > 10) {
    throw new CaptureError(400, 'Priority must be an integer from 1 to 10.');
  }
  return {
    text: row.text.trim(), context: typeof row.context === 'string' ? row.context.trim() : '',
    category: row.category as Category | undefined ?? inferCategory(row.text),
    priority, color: row.color as NoteColor | undefined ?? 'yellow',
  };
}

/** Only this create endpoint accepts a Shortcut token. It never lists, edits or pops notes. */
export async function handleCapture(request: CaptureRequest, response: CaptureResponse, config: CaptureConfig, rpc: CaptureRpc): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      throw new CaptureError(405, 'Only POST is supported.');
    }
    const token = authorizeCapture(request);
    const input = validateCapture(parseJsonBody(request));
    if (!config.url || !config.publicKey) throw new CaptureError(503, 'Capture is not configured yet.');
    const { data, error } = await rpc(token, input);
    if (error) {
      checkStorageError(error);
      if (error.code === '28000') throw new CaptureError(401, 'The capture token is invalid or revoked.');
      if (error.code === '22023' || error.code === '23514') throw new CaptureError(400, 'Invalid idea details.');
      throw new CaptureError(503, 'Capture could not complete. Try again later.');
    }
    const captured = data?.[0];
    if (!captured?.id || !captured.created_at) throw new CaptureError(503, 'Capture could not complete. Try again later.');
    response.status(201).json({ id: captured.id, created_at: captured.created_at });
  } catch (error) {
    const known = error instanceof CaptureError;
    response.status(known ? error.status : 503).json({ error: known ? error.message : 'Capture could not complete. Try again later.' });
  }
}

declare const process: { env: Record<string, string | undefined> };
export default async function handler(request: CaptureRequest, response: CaptureResponse): Promise<void> {
  const config = {
    url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    publicKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
  };
  await handleCapture(request, response, config, async (token, input) => {
    const client = createClient(config.url!, config.publicKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    // The public Supabase key authenticates the RPC role. The opaque Shortcut
    // bearer is an RPC argument, never a Supabase JWT or a service-role key.
    return client.rpc('capture_idea_with_token', {
      p_token: token, p_text: input.text, p_context: input.context, p_category: input.category,
      p_priority: input.priority, p_color: input.color,
    });
  });
}
