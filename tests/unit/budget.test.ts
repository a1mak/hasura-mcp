import { describe, expect, it } from 'vitest';

import { cap, capCell, truncateText } from '../../src/budget.js';

describe('cap', () => {
  it('returns everything and reports no truncation when under the limit', () => {
    expect(cap([1, 2, 3], 10)).toEqual({ items: [1, 2, 3], truncated: false, totalMatched: 3 });
  });

  it('flags truncation and still reports the full match count', () => {
    // totalMatched is the point: without it, 100 of 2,481 rows reads as all of them.
    expect(
      cap(
        Array.from({ length: 2481 }, (_, i) => i),
        100,
      ),
    ).toMatchObject({
      truncated: true,
      totalMatched: 2481,
    });
  });

  it('does not flag truncation when the list exactly fills the limit', () => {
    expect(cap([1, 2, 3], 3)).toEqual({ items: [1, 2, 3], truncated: false, totalMatched: 3 });
  });

  it('handles an empty list', () => {
    expect(cap([], 10)).toEqual({ items: [], truncated: false, totalMatched: 0 });
  });
});

describe('truncateText', () => {
  it('leaves short text alone', () => {
    expect(truncateText('short', 10)).toEqual({ text: 'short', truncated: false });
  });

  it('marks and ellipsises long text', () => {
    const { text, truncated } = truncateText('a'.repeat(20), 5);
    expect(truncated).toBe(true);
    expect(text).toBe(`${'a'.repeat(5)}…`);
  });
});

describe('capCell', () => {
  it('passes through primitives untouched', () => {
    expect(capCell(42)).toEqual({ value: 42, truncated: false });
    expect(capCell(null)).toEqual({ value: null, truncated: false });
    expect(capCell(true)).toEqual({ value: true, truncated: false });
  });

  it('keeps a small object as an object rather than stringifying it', () => {
    expect(capCell({ a: 1 })).toEqual({ value: { a: 1 }, truncated: false });
  });

  it('serialises and truncates an oversized object', () => {
    // One wide jsonb column would otherwise blow the context budget on its own,
    // however few rows came back.
    const huge = { blob: 'x'.repeat(5000) };
    const { value, truncated } = capCell(huge, 100);

    expect(truncated).toBe(true);
    expect(typeof value).toBe('string');
    expect((value as string).length).toBe(101);
  });

  it('truncates a long string cell', () => {
    const { value, truncated } = capCell('y'.repeat(900), 100);
    expect(truncated).toBe(true);
    expect(value).toBe(`${'y'.repeat(100)}…`);
  });
});
