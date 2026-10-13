import { describeFailure, type HasuraFailure } from '../hasura/errors.js';

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * The SDK validates `structuredContent` against the tool's `outputSchema`, and
 * the text block is what a client without structured support renders, so both
 * carry the same payload.
 */
export const toolOk = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

/**
 * Reserved for genuine failures — unreachable, auth, malformed input. A
 * recoverable miss, such as a table that does not exist, is an ordinary result
 * carrying candidates, not an error.
 */
export const toolError = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

export const fromFailure = (failure: HasuraFailure): ToolResult =>
  toolError(describeFailure(failure));
