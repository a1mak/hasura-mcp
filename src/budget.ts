/**
 * Output budget. Every list a tool returns is capped, and a capped list says so
 * — a truncated answer that does not admit it reads as a complete one, which is
 * worse than an error because nothing downstream can tell.
 */

export type Capped<T> = {
  readonly items: readonly T[];
  readonly truncated: boolean;
  readonly totalMatched: number;
};

export const cap = <T>(items: readonly T[], limit: number): Capped<T> => ({
  items: items.slice(0, limit),
  truncated: items.length > limit,
  totalMatched: items.length,
});

export const DEFAULT_CELL_CHARS = 500;

export type TruncatedText = { readonly text: string; readonly truncated: boolean };

export const truncateText = (value: string, maxChars = DEFAULT_CELL_CHARS): TruncatedText =>
  value.length <= maxChars
    ? { text: value, truncated: false }
    : { text: `${value.slice(0, maxChars)}…`, truncated: true };

/**
 * Caps one cell of row data. A single jsonb column can carry megabytes, so a row
 * limit alone does not bound the output.
 */
export const capCell = (
  value: unknown,
  maxChars = DEFAULT_CELL_CHARS,
): { readonly value: unknown; readonly truncated: boolean } => {
  if (typeof value === 'string') {
    const { text, truncated } = truncateText(value, maxChars);
    return { value: text, truncated };
  }
  if (value === null || typeof value !== 'object') return { value, truncated: false };

  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return { value, truncated: false };
  return { value: `${serialized.slice(0, maxChars)}…`, truncated: true };
};
