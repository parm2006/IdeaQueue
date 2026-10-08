import { describe, expect, it } from 'vitest';
import { createIdea, DAY_MS, effectiveDate, effectiveDay, effectivePriority, inferCategory, orderIdeas, PriorityQueue, seedIdeas, type Category, type Idea, type NoteColor } from './queue';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const UTC_MIDNIGHT = Date.parse('2026-10-08T00:00:00Z');
const HOUR = 60 * 60 * 1000;
function idea(id: string, priority: number, ageHours = 0): Idea {
  return { id, priority, text: id, context: '', category: 'General', color: 'yellow', created_at: new Date(NOW - ageHours * HOUR).toISOString(), reviewed_at: null };
}

describe('priority aging', () => {
  it('adds a point at UTC midnight rather than after 24 elapsed hours', () => {
    const note = idea('a', 4);
    expect(effectivePriority(note, UTC_MIDNIGHT + DAY_MS - 1)).toBe(4);
    expect(effectivePriority(note, UTC_MIDNIGHT + DAY_MS)).toBe(5);
    expect(effectivePriority(note, UTC_MIDNIGHT + 2 * DAY_MS)).toBe(6);
  });
  it('allows scores to grow beyond ten without modifying the record', () => {
    const note = idea('a', 9, 720);
    const original = { ...note };
    expect(effectivePriority(note, NOW)).toBe(39);
    expect(effectivePriority(note, NOW + 365 * DAY_MS)).toBe(404);
    expect(note).toEqual(original);
  });
  it('uses UTC calendar day math for future dates, including negative scores', () => {
    expect(effectivePriority(idea('a', 6, -72), NOW)).toBe(3);
    expect(effectivePriority(idea('b', 1, -48), NOW)).toBe(-1);
    expect(effectivePriority(idea('c', 1, -24), UTC_MIDNIGHT - 1)).toBe(-1);
  });
  it('offsets the ranking date by the selected number of days', () => {
    expect(effectiveDay(idea('a', 10))).toBe(Math.floor(NOW / DAY_MS) - 10);
    expect(effectiveDate(idea('a', 10))).toBe(UTC_MIDNIGHT - 10 * DAY_MS);
    expect(effectiveDate(idea('b', 1))).toBe(UTC_MIDNIGHT - DAY_MS);
  });
});

describe('binary priority heap', () => {
  it('pops every entry in effective priority order', () => {
    const queue = new PriorityQueue([idea('low', 1), idea('high', 9), idea('aged', 7, 72), idea('middle', 5)], NOW);
    expect(queue.size).toBe(4);
    expect(queue.peek()?.id).toBe('aged');
    expect(Array.from({ length: 4 }, () => queue.pop()?.id)).toEqual(['aged', 'high', 'middle', 'low']);
    expect(queue.size).toBe(0);
    expect(queue.pop()).toBeUndefined();
    expect(queue.peek()).toBeUndefined();
  });
  it('sifts pushed entries upward and restores order after a pop', () => {
    const queue = new PriorityQueue([idea('a', 3), idea('b', 5), idea('c', 4)], NOW);
    queue.push(idea('d', 10));
    expect(queue.pop()?.id).toBe('d');
    queue.push(idea('e', 6));
    expect(Array.from({ length: 4 }, () => queue.pop()?.id)).toEqual(['e', 'b', 'c', 'a']);
  });
  it('uses actual timestamp FIFO when adjusted day and base priority tie, then ascending id', () => {
    const input = [idea('z', 5), idea('b', 5, 6), idea('a', 5, 6)];
    expect(orderIdeas(input, NOW).map(({ id }) => id)).toEqual(['a', 'b', 'z']);
    expect(input.map(({ id }) => id)).toEqual(['z', 'b', 'a']);
  });
  it('matches a reference ordering across a larger heap', () => {
    const input = Array.from({ length: 80 }, (_, i) => idea(String(i).padStart(3, '0'), (i * 7) % 10 + 1, (i * 13) % 240));
    const expected = [...input].sort((a, b) => effectiveDay(a) - effectiveDay(b) || b.priority - a.priority || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
    expect(orderIdeas(input, NOW)).toEqual(expected);
  });
  it('ranks a twenty-day-old priority one above a fresh priority ten', () => {
    expect(orderIdeas([idea('fresh', 10), idea('old', 1, 20 * 24)], NOW).map(({ id }) => id)).toEqual(['old', 'fresh']);
  });
  it('uses higher base priority for a day tie even when captured later', () => {
    const freshHigh = idea('fresh', 8);
    const oldLow = idea('old', 6, 48);
    expect(effectiveDay(freshHigh)).toBe(effectiveDay(oldLow));
    expect(effectivePriority(freshHigh, NOW)).toBe(effectivePriority(oldLow, NOW));
    expect(orderIdeas([oldLow, freshHigh], NOW)).toEqual([freshHigh, oldLow]);
  });
  it('ignores subday creation time for primary ranking but preserves it for FIFO', () => {
    const morning = idea('morning', 4, 6);
    const noon = idea('noon', 4);
    expect(effectiveDate(morning)).toBe(effectiveDate(noon));
    expect(effectivePriority(morning, NOW)).toBe(effectivePriority(noon, NOW));
    expect(orderIdeas([noon, morning], NOW)).toEqual([morning, noon]);
  });
  it('keeps ordering independent of the clock and leaves all stored fields unchanged', () => {
    const input = [idea('a', 7, -12), idea('b', 3, 90), idea('c', 5)];
    const original = structuredClone(input);
    expect(orderIdeas(input, NOW - 100 * DAY_MS)).toEqual(orderIdeas(input, NOW + 100 * DAY_MS));
    const queue = new PriorityQueue(input, NOW + DAY_MS);
    queue.pop(); queue.push(idea('d', 10));
    expect(input).toEqual(original);
  });
});

describe('idea creation', () => {
  it('trims input, infers category, and supplies defaults', () => {
    const result = createIdea({ text: '  Learn Python  ', context: '  Start small.  ' }, NOW);
    expect(result).toMatchObject({ text: 'Learn Python', context: 'Start small.', category: 'Computer science', priority: 5, color: 'yellow', created_at: new Date(NOW).toISOString(), reviewed_at: null });
    expect(result.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
  });
  it('keeps manual category overrides and context entirely user supplied', () => {
    const automatic = createIdea({ text: 'A new thought', context: 'A calculus theorem' }, NOW);
    expect(automatic.category).toBe('General');
    expect(automatic.context).toBe('A calculus theorem');
    const manual = createIdea({ text: 'Learn Python', category: 'Personal' }, NOW);
    expect(manual.category).toBe('Personal');
    expect(manual.context).toBe('');
    expect(manual.created_at).toBe(new Date(NOW).toISOString());
    expect(Object.keys(manual).sort()).toEqual(['id', 'text', 'context', 'category', 'priority', 'color', 'created_at', 'reviewed_at'].sort());
  });
  it('rejects blank and oversized text or context', () => {
    expect(() => createIdea({ text: ' \n ' })).toThrow();
    expect(() => createIdea({ text: 'a'.repeat(2001) })).toThrow();
    expect(() => createIdea({ text: 'Valid', context: 'a'.repeat(4001) })).toThrow();
    expect(() => createIdea({ text: 'a'.repeat(2000), context: 'a'.repeat(4000) })).not.toThrow();
  });
  it('rejects invalid priorities and unsupported categories or colors', () => {
    for (const priority of [0, 11, 1.5, NaN, Infinity]) expect(() => createIdea({ text: 'Valid', priority })).toThrow();
    expect(() => createIdea({ text: 'Valid', category: 'Unknown' as Category })).toThrow();
    expect(() => createIdea({ text: 'Valid', color: 'orange' as NoteColor })).toThrow();
  });
});

describe('categories and demos', () => {
  it('matches whole words without classifying substrings', () => {
    expect(inferCategory('Try CALCULUS and algebra')).toBe('Mathematics');
    expect(inferCategory('Learn computer science')).toBe('Computer science');
    expect(inferCategory('Build a side project')).toBe('Projects');
    expect(inferCategory('Read a novel')).toBe('Reading');
    expect(inferCategory('Plan a family vacation')).toBe('Personal');
    expect(inferCategory('Decode the bookshelf')).toBe('General');
  });
  it('creates seven distinct valid seed ideas', () => {
    const seeds = seedIdeas(NOW);
    expect(seeds).toHaveLength(7);
    expect(new Set(seeds.map(({ id }) => id)).size).toBe(7);
    expect(seeds.some(({ category }) => category === 'Mathematics')).toBe(true);
    expect(seeds.some(({ category }) => category === 'Projects')).toBe(true);
    expect(seeds.some(({ category }) => category === 'Personal')).toBe(true);
    expect(seeds.every(({ priority }) => priority >= 1 && priority <= 10)).toBe(true);
  });
});
