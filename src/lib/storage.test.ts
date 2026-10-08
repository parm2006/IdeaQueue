import { describe, expect, it } from 'vitest';
import { createIdea } from './queue';
import { validateImport } from './storage';

describe('import validation', () => {
  it('accepts exports and preserves identity and review state', () => {
    const idea = { ...createIdea({ text: '  A thought  ' }), reviewed_at: '2026-10-07T12:00:00Z' };
    expect(validateImport({ version: 1, ideas: [idea] })[0]).toMatchObject({ ...idea, text: 'A thought', reviewed_at: '2026-10-07T12:00:00.000Z' });
  });
  it('rejects invalid dates, UUIDs, duplicate IDs, and missing fields', () => {
    const idea = createIdea({ text: 'Safe note' });
    expect(() => validateImport([idea, idea])).toThrow('unique UUIDs');
    for (const patch of [{ created_at: 'bad' }, { reviewed_at: 'bad' }, { id: '../id' }, { category: 'bad' }, { context: null }, { priority: 99 }]) expect(() => validateImport([{ ...idea, ...patch }])).toThrow();
  });
  it('rejects invalid envelopes and large files', () => {
    for (const value of [null, {}, 'hello', { ideas: {} }, Array(10001).fill({})]) expect(() => validateImport(value)).toThrow();
  });
  it('accepts an empty export and does not mutate its input', () => {
    expect(validateImport({ ideas: [] })).toEqual([]);
    const idea = { ...createIdea({ text: 'A thought' }), text: '  A thought  ' };
    expect(validateImport([idea])[0].text).toBe('A thought');
    expect(idea.text).toBe('  A thought  ');
  });
});
