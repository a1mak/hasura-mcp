import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { beforeAll, describe, expect, it } from 'vitest';

import type { HasuraClient } from '../../src/hasura/client.js';
import { createMetadataReader } from '../../src/metadata.js';
import { createServer, type ToolContext } from '../../src/server.js';

/**
 * A real client wired to a real server in one process — genuine `tools/list` and
 * `tools/call`, no subprocess and no network. Hasura is stubbed, so these assert
 * the protocol surface rather than engine behaviour.
 */

const stubHasura = (): HasuraClient =>
  ({
    version: () => Promise.resolve({ ok: true, data: { server_type: 'ce', version: 'v2.48.5' } }),
    metadata: (type: string) => {
      if (type === 'export_metadata') {
        return Promise.resolve({
          ok: true,
          data: { version: 3, sources: [{ name: 'default', kind: 'postgres', tables: [] }] },
        });
      }
      if (type === 'get_inconsistent_metadata') {
        return Promise.resolve({
          ok: true,
          data: { is_consistent: true, inconsistent_objects: [] },
        });
      }
      if (type === 'pg_get_source_tables') {
        return Promise.resolve({
          ok: true,
          data: [
            { schema: 'public', name: 'invoice' },
            { schema: 'public', name: 'patient_consent' },
            { schema: 'billing', name: 'ledger' },
          ],
        });
      }
      return Promise.resolve({
        ok: false,
        failure: { kind: 'api', code: 'not-supported', message: type, path: null },
      });
    },
    readOnlySql: () => Promise.resolve({ ok: true, data: { result_type: 'TuplesOk', result: [] } }),
    explain: () => Promise.resolve({ ok: true, data: [] }),
  }) as unknown as HasuraClient;

const connect = async (client: HasuraClient = stubHasura()): Promise<Client> => {
  const context: ToolContext = {
    config: { endpoint: 'http://localhost:8299', adminSecret: 'fixture', projectDir: null },
    client,
    metadata: createMetadataReader(client),
  };

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(context).connect(serverTransport);

  const mcp = new Client({ name: 'protocol-test', version: '0' });
  await mcp.connect(clientTransport);
  return mcp;
};

describe('tools/list', () => {
  let tools: Awaited<ReturnType<Client['listTools']>>['tools'];

  beforeAll(async () => {
    tools = (await (await connect()).listTools()).tools;
  });

  it('advertises every tool unconditionally', () => {
    // #17: a tool whose prerequisite is missing still appears and explains itself.
    expect(tools.map((t) => t.name).sort()).toEqual(['list_tables', 'server_info']);
  });

  it('marks every tool read-only, which is what lets a host auto-approve it', () => {
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }
  });

  it('gives every tool a title and a description', () => {
    for (const tool of tools) {
      expect(tool.title ?? '').not.toBe('');
      expect((tool.description ?? '').length).toBeGreaterThan(40);
    }
  });

  it('declares an output schema for every tool, so results are validated', () => {
    for (const tool of tools) expect(tool.outputSchema).toBeDefined();
  });

  it('keeps the advertised surface stable', () => {
    // The tool surface is the public API: a diff here is an API change.
    // Sorted, so reordering registrations is not a false failure.
    expect(
      tools
        .map((t) => ({
          name: t.name,
          title: t.title,
          input: Object.keys((t.inputSchema.properties ?? {}) as Record<string, unknown>).sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toMatchInlineSnapshot(`
      [
        {
          "input": [
            "limit",
            "prefix",
            "schema",
            "source",
          ],
          "name": "list_tables",
          "title": "List tables",
        },
        {
          "input": [],
          "name": "server_info",
          "title": "Server info",
        },
      ]
    `);
  });
});

describe('tools/call', () => {
  it('returns server_info as validated structured content', async () => {
    const result = await (await connect()).callTool({ name: 'server_info', arguments: {} });

    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent).toMatchObject({
      version: 'v2.48.5',
      serverType: 'ce',
      sources: [{ name: 'default', kind: 'postgres' }],
      mutationsEnabled: false,
    });
  });

  it('reports an absent project directory rather than hiding the drift tools', async () => {
    const result = await (await connect()).callTool({ name: 'server_info', arguments: {} });

    expect(result.structuredContent).toMatchObject({ projectDir: null, projectDirValid: false });
  });

  it('lists tables sorted by schema then name', async () => {
    const result = await (await connect()).callTool({ name: 'list_tables', arguments: {} });

    expect(result.structuredContent).toMatchObject({
      tables: [
        { schema: 'billing', name: 'ledger' },
        { schema: 'public', name: 'invoice' },
        { schema: 'public', name: 'patient_consent' },
      ],
      truncated: false,
      totalMatched: 3,
    });
  });

  it('filters by schema', async () => {
    const result = await (
      await connect()
    ).callTool({
      name: 'list_tables',
      arguments: { schema: 'billing' },
    });

    expect(result.structuredContent).toMatchObject({ totalMatched: 1 });
  });

  it('filters by prefix', async () => {
    const result = await (
      await connect()
    ).callTool({
      name: 'list_tables',
      arguments: { prefix: 'patient' },
    });

    expect(result.structuredContent).toMatchObject({
      tables: [{ schema: 'public', name: 'patient_consent' }],
      totalMatched: 1,
    });
  });

  it('caps and reports the full match count, never silently truncating', async () => {
    const result = await (
      await connect()
    ).callTool({
      name: 'list_tables',
      arguments: { limit: 1 },
    });

    expect(result.structuredContent).toMatchObject({ truncated: true, totalMatched: 3 });
    expect((result.structuredContent as { tables: unknown[] }).tables).toHaveLength(1);
  });

  it('surfaces an engine failure as isError, not as an empty result', async () => {
    const failing = {
      ...stubHasura(),
      metadata: () =>
        Promise.resolve({ ok: false, failure: { kind: 'unauthorized', detail: 'denied' } }),
    } as unknown as HasuraClient;

    const result = await (await connect(failing)).callTool({ name: 'list_tables', arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('HASURA_ADMIN_SECRET');
  });
});
