import { describe, expect, it } from 'vitest';
import { availableCategory, bucketColors, categories, inferCategory } from './queue';

describe('bucket presentation and suggestions', () => {
  it('gives every built-in bucket a distinct note color', () => {
    expect(new Set(categories.map(category => bucketColors[category])).size).toBe(categories.length);
  });
  it('routes suggestions for a deleted bucket to General', () => {
    const buckets = categories.filter(category => category !== 'Projects');
    expect(availableCategory(inferCategory('Build a neighborhood app'), buckets)).toBe('General');
    expect(availableCategory(inferCategory('Read a novel'), buckets)).toBe('Reading');
  });
});
