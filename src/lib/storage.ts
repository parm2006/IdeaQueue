import { categories, colors, createIdea, type Idea } from './queue';

export const STORAGE_KEY = 'ideaqueue.notes.v1';

export function validateImport(value: unknown): Idea[] {
  const rows = Array.isArray(value) ? value : (value as { ideas?: unknown })?.ideas;
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Choose an IdeaQueue JSON export (up to 10,000 notes).');
  const ids = new Set<string>();
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('The file contains an invalid note.');
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(r.id) || ids.has(r.id)) throw new Error('Notes must have unique UUIDs.');
    if (typeof r.text !== 'string' || typeof r.context !== 'string' || typeof r.priority !== 'number' || !categories.includes(r.category as never) || !colors.includes(r.color as never)) throw new Error('A note has invalid text, priority, category, or color.');
    if (typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at))) throw new Error('A note has an invalid creation date.');
    if (r.reviewed_at !== null && (typeof r.reviewed_at !== 'string' || !Number.isFinite(Date.parse(r.reviewed_at)))) throw new Error('A note has an invalid review date.');
    const validated = createIdea({ text: r.text, context: r.context, priority: r.priority, category: r.category as Idea['category'], color: r.color as Idea['color'] });
    ids.add(r.id);
    return { ...validated, id: r.id, created_at: new Date(r.created_at).toISOString(), reviewed_at: r.reviewed_at === null ? null : new Date(r.reviewed_at as string).toISOString() };
  });
}

export function writeLocal(ideas: Idea[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas)); }
  catch { throw new Error('This browser could not save your note. Free some storage or export your notes.'); }
}

export function readLocal(): Idea[] | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try { return validateImport(JSON.parse(raw)); }
  catch { throw new Error('Saved notes could not be read. They have been kept in browser storage; no data was overwritten.'); }
}

export function exportIdeas(ideas: Idea[]) {
  const blob = new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), ideas }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `ideaqueue-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
