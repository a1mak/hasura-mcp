import { z } from 'zod';

import { cap } from '../budget.js';
import type { ToolContext } from '../server.js';
import type { TableName } from '../metadata.js';
import { fromFailure, toolOk, type ToolResult } from './result.js';

export const listTablesInput = z.object({
  schema: z.string().optional().describe('Restrict to one Postgres schema. Omit for all.'),
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
  'Returns tracked tables only — a table that exists in Postgres but is untracked is not ' +
  'queryable through GraphQL and does not appear here.';

export type ListTablesArgs = z.infer<typeof listTablesInput>;

const bySchemaThenName = (a: TableName, b: TableName): number =>
  a.schema === b.schema ? a.name.localeCompare(b.name) : a.schema.localeCompare(b.schema);

export const runListTables = async (
  context: ToolContext,
  args: ListTablesArgs,
): Promise<ToolResult> => {
  // pg_get_source_tables is authoritative. Deriving the list from query_root field
  // names instead would drop a table named e.g. `payment_stream`, break under
  // per-table root-field renaming, and hide insert-only tables.
  const result = await context.client.metadata<TableName[]>('pg_get_source_tables', {
    source: args.source,
  });
  if (!result.ok) return fromFailure(result.failure);

  const matched = result.data
    .filter((table) => args.schema === undefined || table.schema === args.schema)
    .filter((table) => args.prefix === undefined || table.name.startsWith(args.prefix))
    .sort(bySchemaThenName);

  const { items, truncated, totalMatched } = cap(matched, args.limit);

  return toolOk({
    tables: items.map((table) => ({ schema: table.schema, name: table.name })),
    truncated,
    totalMatched,
  });
};
