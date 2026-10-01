import type { HasuraClient } from './hasura/client.js';
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

/**
 * Metadata is read fresh rather than cached for correctness: a stale copy makes
 * the server answer confidently about a schema that has moved. The window here
 * only de-duplicates reads *within* a single tool call, where several steps need
 * the same document — short enough that nothing observable can change inside it.
 */
export const DEFAULT_METADATA_TTL_MS = 2_000;

export type MetadataReader = {
  readonly read: () => Promise<HasuraResult<Metadata>>;
  readonly invalidate: () => void;
};

export const createMetadataReader = (
  client: HasuraClient,
  options: { readonly ttlMs?: number; readonly now?: () => number } = {},
): MetadataReader => {
  const ttlMs = options.ttlMs ?? DEFAULT_METADATA_TTL_MS;
  const now = options.now ?? Date.now;

  let cached: { readonly at: number; readonly result: HasuraResult<Metadata> } | null = null;
  let inFlight: Promise<HasuraResult<Metadata>> | null = null;

  const read = async (): Promise<HasuraResult<Metadata>> => {
    if (cached !== null && now() - cached.at < ttlMs) return cached.result;
    // Concurrent callers share one request rather than stampeding the engine.
    if (inFlight !== null) return inFlight;

    inFlight = client.metadata<Metadata>('export_metadata').then((result) => {
      // Failures are not cached: the next call should retry, not inherit an outage.
      if (result.ok) cached = { at: now(), result };
      inFlight = null;
      return result;
    });

    return inFlight;
  };

  return {
    read,
    invalidate: () => {
      cached = null;
    },
  };
};

export const findSource = (metadata: Metadata, name: string): MetadataSource | undefined =>
  metadata.sources?.find((source) => source.name === name);

export const findTable = (
  source: MetadataSource | undefined,
  table: TableName,
): MetadataTable | undefined =>
  source?.tables?.find((t) => t.table.name === table.name && t.table.schema === table.schema);

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
