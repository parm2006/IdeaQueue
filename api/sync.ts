import { createClient } from '@supabase/supabase-js';
import {
  authorizeCapture, CaptureError, checkStorageError, type CaptureConfig, type CaptureInput, type CaptureRequest,
  type CaptureResponse, type CaptureRpc, parseJsonBody, validateCapture,
} from './ideas.js';

const SYNC_BODY_LIMIT = 64 * 1024;
const MAX_OUTBOX_ITEMS = 50;

function validateOutbox(body: unknown): CaptureInput[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CaptureError(400, 'Expected a JSON object.');
  const row = body as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || typeof row.outbox !== 'string') {
    throw new CaptureError(400, 'Expected an outbox string.');
  }
  const lines = row.outbox.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new CaptureError(400, 'The outbox is empty.');
  if (lines.length > MAX_OUTBOX_ITEMS) throw new CaptureError(413, `Sync at most ${MAX_OUTBOX_ITEMS} ideas at a time.`);
  return lines.map((line) => {
    try { return validateCapture(JSON.parse(line)); }
    catch (error) {
      if (error instanceof CaptureError) throw error;
      throw new CaptureError(400, 'The outbox contains invalid JSON.');
    }
  });
}

/** Accept a locally saved NDJSON outbox. It only creates notes for the token owner. */
export async function handleSync(request: CaptureRequest, response: CaptureResponse, config: CaptureConfig, rpc: CaptureRpc): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      throw new CaptureError(405, 'Only POST is supported.');
    }
    const token = authorizeCapture(request);
    const inputs = validateOutbox(parseJsonBody(request, SYNC_BODY_LIMIT));
    if (!config.url || !config.publicKey) throw new CaptureError(503, 'Sync is not configured yet.');
    for (const input of inputs) {
      const { data, error } = await rpc(token, input);
      if (error) {
        checkStorageError(error);
        if (error.code === '28000') throw new CaptureError(401, 'The capture token is invalid or revoked.');
        if (error.code === '22023' || error.code === '23514') throw new CaptureError(400, 'Invalid idea details.');
        throw new CaptureError(503, 'Sync could not complete. Try again later.');
      }
      if (!data?.[0]?.id || !data[0].created_at) throw new CaptureError(503, 'Sync could not complete. Try again later.');
    }
    response.status(201).json({ saved: inputs.length });
  } catch (error) {
    const known = error instanceof CaptureError;
    response.status(known ? error.status : 503).json({ error: known ? error.message : 'Sync could not complete. Try again later.' });
  }
}

declare const process: { env: Record<string, string | undefined> };
export default async function handler(request: CaptureRequest, response: CaptureResponse): Promise<void> {
  const config = {
    url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    publicKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
  };
  await handleSync(request, response, config, async (token, input) => {
    const client = createClient(config.url!, config.publicKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return client.rpc('capture_idea_with_token', {
      p_token: token, p_text: input.text, p_context: input.context, p_category: input.category,
      p_priority: input.priority, p_color: input.color,
    });
  });
}
