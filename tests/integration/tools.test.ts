import { describe, expect, it } from 'vitest';

import { createClient } from '../../src/hasura/client.js';
import { createMetadataReader } from '../../src/metadata.js';
import { runListTables } from '../../src/tools/list-tables.js';
import { runServerInfo } from '../../src/tools/server-info.js';
import type { ToolContext } from '../../src/server.js';

const contextFor = (projectDir: string | null = null): ToolContext => {
  const config = {
    endpoint: process.env.HASURA_TEST_ENDPOINT ?? 'http://localhost:8299',
    adminSecret: process.env.HASURA_TEST_ADMIN_SECRET ?? 'fixture',
    projectDir,
  };
  const client = createClient(config);
  return { config, client, metadata: createMetadataReader(client) };
};

const structured = (result: { structuredContent?: Record<string, unknown> }) =>
  result.structuredContent ?? {};

describe('server_info against a live engine', () => {
  it('reports the version, edition and the source names other tools accept', async () => {
    const result = await runServerInfo(contextFor());

    expect(result.isError ?? false).toBe(false);
    expect(structured(result)).toMatchObject({
      serverType: 'ce',
      sources: [{ name: 'default', kind: 'postgres' }],
      metadataConsistent: true,
      inconsistentCount: 0,
    });
    expect(structured(result).version).toMatch(/^v2\./);
  });

  it('rejects an invalid project directory rather than claiming it works', async () => {
    const result = await runServerInfo(contextFor('/definitely/not/a/hasura/project'));

    expect(structured(result)).toMatchObject({
      projectDir: '/definitely/not/a/hasura/project',
      projectDirValid: false,
    });
  });

  it('reports a bad admin secret as an auth failure naming the variable to fix', async () => {
    const config = {
      endpoint: process.env.HASURA_TEST_ENDPOINT ?? 'http://localhost:8299',
      adminSecret: 'wrong',
      projectDir: null,
    };
    const client = createClient(config);
    const result = await runServerInfo({ config, client, metadata: createMetadataReader(client) });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('HASURA_ADMIN_SECRET');
  });
});

describe('list_tables against a live engine', () => {
  it('finds the tracked fixture table', async () => {
    const result = await runListTables(contextFor(), { source: 'default', limit: 200 });

    expect(result.isError ?? false).toBe(false);
    expect(structured(result).tables).toContainEqual({ schema: 'public', name: 'patient_consent' });
  });

  it('reports an unknown source as an engine failure, not an empty list', async () => {
    const result = await runListTables(contextFor(), { source: 'nope', limit: 200 });

    expect(result.isError).toBe(true);
  });

  it('filters by prefix', async () => {
    const all = await runListTables(contextFor(), { source: 'default', limit: 200 });
    const filtered = await runListTables(contextFor(), {
      source: 'default',
      limit: 200,
      prefix: 'patient',
    });

    expect(structured(filtered).totalMatched).toBeLessThanOrEqual(
      structured(all).totalMatched as number,
    );
    expect(structured(filtered).tables).toContainEqual({
      schema: 'public',
      name: 'patient_consent',
    });
  });

  it('does not list the computed field as if it were a table', async () => {
    const result = await runListTables(contextFor(), { source: 'default', limit: 200 });
    const names = (structured(result).tables as { name: string }[]).map((t) => t.name);

    expect(names).not.toContain('is_active');
    expect(names).not.toContain('consent_is_active');
  });
});
