import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import type { ToolContext } from '../server.js';
import { fromFailure, toolOk, type ToolResult } from './result.js';

export const serverInfoInput = z.object({});

export const serverInfoOutput = z.object({
  version: z.string(),
  serverType: z.string(),
  sources: z.array(z.object({ name: z.string(), kind: z.string() })),
  metadataConsistent: z.boolean(),
  inconsistentCount: z.number(),
  projectDir: z.string().nullable(),
  projectDirValid: z.boolean(),
  mutationsEnabled: z.boolean(),
});

export const serverInfoDescription =
  'What this server is connected to: Hasura version and edition, the data sources available ' +
  "(these are the valid values for every other tool's `source` parameter), whether metadata is " +
  'consistent, and whether a local Hasura CLI project is configured. Call this first in a new ' +
  'conversation, and whenever another tool fails in a way that might be configuration.';

/** A Hasura CLI project is identified by config.yaml at its root. */
const isHasuraProject = async (dir: string): Promise<boolean> => {
  try {
    await access(join(dir, 'config.yaml'), constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

type InconsistentMetadata = { is_consistent: boolean; inconsistent_objects: unknown[] };

export const runServerInfo = async (context: ToolContext): Promise<ToolResult> => {
  const version = await context.client.version();
  if (!version.ok) return fromFailure(version.failure);

  const metadata = await context.metadata.read();
  if (!metadata.ok) return fromFailure(metadata.failure);

  const consistency = await context.client.metadata<InconsistentMetadata>(
    'get_inconsistent_metadata',
  );
  if (!consistency.ok) return fromFailure(consistency.failure);

  const { projectDir } = context.config;

  return toolOk({
    version: version.data.version,
    serverType: version.data.server_type,
    sources: (metadata.data.sources ?? []).map((source) => ({
      name: source.name,
      kind: source.kind,
    })),
    metadataConsistent: consistency.data.is_consistent,
    inconsistentCount: consistency.data.inconsistent_objects.length,
    projectDir,
    projectDirValid: projectDir === null ? false : await isHasuraProject(projectDir),
    // v1 ships no write path at all; the flag arrives with run_mutation in v1.1.
    mutationsEnabled: false,
  });
};
