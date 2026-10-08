import { categories, colors, createIdea, type Category, type Idea, type NoteColor } from '../src/lib/queue';

/** The subset of D1 used here, kept structural so the Worker needs no browser types. */
export interface IdeaDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
    all<T>(): Promise<{ results: T[] }>;
  };
}

export interface ApiEnv { DB: IdeaDatabase }

const IDEA_COLUMNS = 'id, text, context, category, priority, color, created_at, reviewed_at';
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const SINGLE_BODY_LIMIT = 16 * 1024;
const IMPORT_BODY_LIMIT = 16 * 1024 * 1024;
const IMPORT_COUNT_LIMIT = 500;
// D1 permits 100 bound parameters per statement; each row uses eight.
const IMPORT_BATCH_SIZE = 12;

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function respond(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Expected a JSON object.');
  return value as Record<string, unknown>;
}

function category(value: unknown): Category {
  if (typeof value !== 'string' || !categories.includes(value as Category)) throw new ApiError(400, 'Choose a valid category.');
  return value as Category;
}

function color(value: unknown): NoteColor {
  if (typeof value !== 'string' || !colors.includes(value as NoteColor)) throw new ApiError(400, 'Choose a valid note color.');
  return value as NoteColor;
}

function priority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new ApiError(400, 'Priority must be an integer from 1 to 10.');
  }
  return value;
}

function noteText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) {
    throw new ApiError(400, 'Idea text must contain 1–2000 characters.');
  }
  return value.trim();
}

function noteContext(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length > 4000) {
    throw new ApiError(400, 'Context must contain at most 4000 characters.');
  }
  return value.trim();
}

function timestamp(value: unknown, field: string): string {
  const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  const day = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  const calendarTime = Date.parse(`${day}T00:00:00Z`);
  if (!match || !Number.isFinite(Date.parse(value as string)) ||
    !Number.isFinite(calendarTime) || new Date(calendarTime).toISOString().slice(0, 10) !== day) {
    throw new ApiError(400, `Invalid ${field}.`);
  }
  return new Date(value as string).toISOString();
}

function completeIdea(value: unknown): Idea {
  const row = object(value);
  if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new ApiError(400, 'Idea id must be a UUID.');
  if (row.reviewed_at === undefined) throw new ApiError(400, 'Missing reviewed_at.');
  return {
    id: row.id,
    text: noteText(row.text),
    context: noteContext(row.context),
    category: category(row.category),
    priority: priority(row.priority),
    color: color(row.color),
    created_at: timestamp(row.created_at, 'created_at'),
    reviewed_at: row.reviewed_at === null ? null : timestamp(row.reviewed_at, 'reviewed_at'),
  };
}

function captureIdea(value: unknown): Idea {
  const row = object(value);
  return createIdea({
    text: noteText(row.text),
    context: row.context === undefined ? undefined : noteContext(row.context),
    category: row.category === undefined ? undefined : category(row.category),
    priority: row.priority === undefined ? undefined : priority(row.priority),
    color: row.color === undefined ? undefined : color(row.color),
  });
}

async function readJson(request: Request, limit: number, optional = false): Promise<unknown> {
  if (request.body === null && optional) return {};
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new ApiError(415, 'Use application/json.');
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > limit) throw new ApiError(413, 'Request body is too large.');
  if (request.body === null) throw new ApiError(400, 'A JSON body is required.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!size && optional) return {};
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, 'Invalid JSON body.'); }
}

function assertMutationOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) throw new ApiError(403, 'Cross-origin writes are not allowed.');
}

function assertVisitor(request: Request): void {
  if (!request.headers.get('oai-authenticated-user-id')) throw new ApiError(401, 'Sign in to access this workspace.');
}

function allow(methods: string): Response {
  return respond({ error: 'Method not allowed.' }, 405, { Allow: methods });
}

async function insertIdea(db: IdeaDatabase, idea: Idea): Promise<void> {
  await db.prepare(`INSERT INTO ideas (${IDEA_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(idea.id, idea.text, idea.context, idea.category, idea.priority, idea.color, idea.created_at, idea.reviewed_at).run();
}

async function importIdeas(db: IdeaDatabase, ideas: Idea[]): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < ideas.length; start += IMPORT_BATCH_SIZE) {
    const batch = ideas.slice(start, start + IMPORT_BATCH_SIZE);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = batch.flatMap(idea => [idea.id, idea.text, idea.context, idea.category, idea.priority, idea.color, idea.created_at, idea.reviewed_at]);
    const result = await db.prepare(`INSERT INTO ideas (${IDEA_COLUMNS}) VALUES ${placeholders} ON CONFLICT(id) DO NOTHING`)
      .bind(...values).run();
    inserted += result.meta.changes;
  }
  return inserted;
}

/** Returns null for paths outside this API so the hosting router can serve the app. */
export async function handleApi(request: Request, env: ApiEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!['/api/session', '/api/ideas', '/api/pop', '/api/import'].includes(path)) return null;

  try {
    if (request.method !== 'GET') assertMutationOrigin(request);
    // Only capture is callable through the owner's non-browser Sites service bypass.
    if (!(path === '/api/ideas' && request.method === 'POST')) assertVisitor(request);

    if (path === '/api/session') {
      if (request.method !== 'GET') return allow('GET');
      return respond({ user: {
        id: request.headers.get('oai-authenticated-user-id'),
        email: request.headers.get('oai-authenticated-user-email') ?? '',
      } });
    }

    if (path === '/api/ideas') {
      if (request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT ${IDEA_COLUMNS} FROM ideas ORDER BY created_at DESC, id DESC`).all<Idea>();
        return respond({ ideas: results });
      }
      if (request.method === 'POST') {
        const idea = captureIdea(await readJson(request, SINGLE_BODY_LIMIT));
        await insertIdea(env.DB, idea);
        return respond({ idea }, 201);
      }
      if (request.method === 'PUT') {
        const idea = completeIdea(await readJson(request, SINGLE_BODY_LIMIT));
        await env.DB.prepare(`INSERT INTO ideas (${IDEA_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET text=excluded.text, context=excluded.context,
          category=excluded.category, priority=excluded.priority, color=excluded.color,
          created_at=excluded.created_at, reviewed_at=excluded.reviewed_at`)
          .bind(idea.id, idea.text, idea.context, idea.category, idea.priority, idea.color, idea.created_at, idea.reviewed_at).run();
        return respond({ idea });
      }
      return allow('GET, POST, PUT');
    }

    if (path === '/api/pop') {
      if (request.method !== 'POST') return allow('POST');
      const input = object(await readJson(request, SINGLE_BODY_LIMIT, true));
      const selectedCategory = input.category === undefined ? null : category(input.category);
      const expectedId = input.expected_id;
      if (expectedId !== undefined && (typeof expectedId !== 'string' || !UUID.test(expectedId))) {
        throw new ApiError(400, 'Expected idea id must be a UUID.');
      }
      const whereCategory = selectedCategory === null ? '' : ' AND category = ?';
      const sql = `UPDATE ideas SET reviewed_at = ? WHERE id = (
        SELECT id FROM ideas WHERE reviewed_at IS NULL${whereCategory}
        ORDER BY date(created_at, '-' || priority || ' days') ASC,
          priority DESC, created_at ASC, id ASC LIMIT 1
      )${expectedId === undefined ? '' : ' AND id = ?'} RETURNING ${IDEA_COLUMNS}`;
      const statement = env.DB.prepare(sql).bind(
        ...(selectedCategory === null ? [new Date().toISOString()] : [new Date().toISOString(), selectedCategory]),
        ...(expectedId === undefined ? [] : [expectedId]),
      );
      const idea = await statement.first<Idea>();
      if (!idea && expectedId !== undefined) throw new ApiError(409, 'Your queue changed. The latest upcoming idea is now shown; tap Pop again.');
      return respond({ idea });
    }

    if (request.method !== 'POST') return allow('POST');
    const value = await readJson(request, IMPORT_BODY_LIMIT);
    if (!Array.isArray(value) || value.length > IMPORT_COUNT_LIMIT) {
      throw new ApiError(400, 'Expected an array of up to 500 ideas. Send larger imports in chunks.');
    }
    const ideas = value.map(completeIdea);
    const ids = new Set(ideas.map(idea => idea.id.toLowerCase()));
    if (ids.size !== ideas.length) throw new ApiError(400, 'Import contains duplicate idea ids.');
    return respond({ inserted: await importIdeas(env.DB, ideas) });
  } catch (error) {
    if (error instanceof ApiError) return respond({ error: error.message }, error.status);
    console.error('IdeaQueue API failed', error);
    return respond({ error: 'The workspace could not complete this request.' }, 500);
  }
}
