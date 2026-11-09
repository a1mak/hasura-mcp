import { createCachedReader, type CacheOptions, type CachedReader } from './cache.js';
import type { HasuraResult } from './hasura/errors.js';

export type TableName = { readonly schema: string; readonly name: string };

export type MetadataTable = {
  readonly table: TableName;
  readonly select_permissions?: readonly { readonly role: string }[];
  readonly insert_permissions?: readonly { readonly role: string }[];
  readonly update_permissions?: readonly { readonly role: string }[];
  readonly delete_permissions?: readonly { readonly role: string }[];
  readonly computed_fields?: readonly { readonly name: string }[];
  readonly event_triggers?: readonly { readonly name: string }[];
};

export type MetadataSource = {
  readonly name: string;
  readonly kind: string;
  readonly tables?: readonly MetadataTable[];
};

export type Metadata = {
  readonly version: number;
  readonly sources?: readonly MetadataSource[];
  readonly actions?: readonly { readonly name: string }[];
  readonly remote_schemas?: readonly { readonly name: string }[];
  readonly cron_triggers?: readonly { readonly name: string }[];
};

/** The single call this reader makes. Stated non-generically so the dependency
 *  is the one method, and a test double is a plain object rather than a cast. */
export type MetadataFetcher = {
  readonly metadata: (type: string) => Promise<HasuraResult<Metadata>>;
};

export type MetadataReader = CachedReader<Metadata>;

export const createMetadataReader = (
  client: MetadataFetcher,
  options: CacheOptions = {},
): MetadataReader => createCachedReader(() => client.metadata('export_metadata'), options);

export const tableKey = (table: TableName): string => `${table.schema}.${table.name}`;

export const findSource = (metadata: Metadata, name: string): MetadataSource | undefined =>
  metadata.sources?.find((source) => source.name === name);

export const findTable = (
  source: MetadataSource | undefined,
  table: TableName,
): MetadataTable | undefined =>
  source?.tables?.find((t) => t.table.name === table.name && t.table.schema === table.schema);

export const allTables = (source: MetadataSource | undefined): TableName[] =>
  (source?.tables ?? []).map((entry) => entry.table);

const PERMISSION_KEYS = [
  ['select_permissions', 'select'],
  ['insert_permissions', 'insert'],
  ['update_permissions', 'update'],
  ['delete_permissions', 'delete'],
] as const;

export type Operation = 'select' | 'insert' | 'update' | 'delete';

/** Role → operations it holds on this table, from metadata alone. */
export const permissionMatrix = (table: MetadataTable): Record<string, Operation[]> => {
  const matrix: Record<string, Operation[]> = {};

  for (const [key, operation] of PERMISSION_KEYS) {
    for (const entry of table[key] ?? []) {
      matrix[entry.role] = [...(matrix[entry.role] ?? []), operation];
    }
  }

  return matrix;
};
