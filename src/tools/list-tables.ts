import { z } from 'zod';

import { cap } from '../budget.js';
import type { ToolContext } from '../server.js';
import { allTables, findSource, type TableName } from '../metadata.js';
import { fromFailure, toolError, toolOk, type ToolResult } from './result.js';

export const listTablesInput = z.object({
  schema: z.string().optional().describe('Restrict to one schema. Omit for all.'),
  prefix: z.string().optional().describe('Only tables whose name starts with this.'),
  source: z.string().default('default').describe('Data source name, from server_info.'),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listTablesOutput = z.object({
  tables: z.array(z.object({ schema: z.string(), name: z.string() })),
  truncated: z.boolean(),
  totalMatched: z.number(),
});

export const listTablesDescription =
  'Every table tracked by this Hasura instance, by name. The orientation call for an ' +
  'unfamiliar database, and the way to find the exact name to pass to describe_table. ' +
  'Returns tracked tables only — a table that exists in the database but is untracked is not ' +
  'queryable through GraphQL and does not appear here.';

export type ListTablesArgs = z.infer<typeof listTablesInput>;

const bySchemaThenName = (a: TableName, b: TableName): number =>
  a.schema === b.schema ? a.name.localeCompare(b.name) : a.schema.localeCompare(b.schema);

const hasSchemaAndName = (table: unknown): table is TableName =>
  typeof table === 'object' &&
  table !== null &&
  typeof (table as Record<string, unknown>).schema === 'string' &&
  typeof (table as Record<string, unknown>).name === 'string';

const matching =
  (args: ListTablesArgs) =>
  (table: TableName): boolean =>
    (args.schema === undefined || table.schema === args.schema) &&
    (args.prefix === undefined || table.name.startsWith(args.prefix));

export const runListTables = async (
  context: ToolContext,
  args: ListTablesArgs,
): Promise<ToolResult> => {
  const metadata = await context.metadata.read();
  if (!metadata.ok) return fromFailure(metadata.failure);

  const source = findSource(metadata.data, args.source);
  if (source === undefined) {
    const names = (metadata.data.sources ?? []).map((s) => s.name).join(', ');
    return toolError(
      `No data source named '${args.source}'. This instance has: ${names || 'none'}.`,
    );
  }

  const tables: unknown[] = allTables(source);
  if (!tables.every(hasSchemaAndName)) {
    return toolError(
      `This tool cannot express table identifiers for a '${source.kind}' source: its tables are ` +
        'not identified by a schema and a name.',
    );
  }

  // Deriving the list from query_root field names instead would drop a table
  // named e.g. `payment_stream`, break under per-table root-field renaming, and
  // hide insert-only tables.
  const matched = tables.filter(matching(args)).sort(bySchemaThenName);

  const { items, truncated, totalMatched } = cap(matched, args.limit);

  return toolOk({
    tables: items.map((table) => ({ schema: table.schema, name: table.name })),
    truncated,
    totalMatched,
  });
};
