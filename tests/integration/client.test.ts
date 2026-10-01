import { describe, expect, it } from 'vitest';

import { createClient, sqlRows } from '../../src/hasura/client.js';
import {
  createMetadataReader,
  findSource,
  findTable,
  permissionMatrix,
} from '../../src/metadata.js';

const config = {
  endpoint: process.env.HASURA_TEST_ENDPOINT ?? 'http://localhost:8299',
  adminSecret: process.env.HASURA_TEST_ADMIN_SECRET ?? 'fixture',
  projectDir: null,
};

const client = createClient(config);

describe('version', () => {
  it('reads the engine identity', async () => {
    const result = await client.version();

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.server_type).toBe('ce');
  });
});

describe('graphql', () => {
  it('returns data for a valid query', async () => {
    const result = await client.graphql<{ data: { patient_consent: unknown[] } }>({
      query: '{ patient_consent(limit: 1) { id } }',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.data.patient_consent).toHaveLength(1);
  });

  it('surfaces in-body GraphQL errors even though the transport succeeded', async () => {
    // Hasura answers HTTP 200 with an errors array, so a 2xx is not success.
    const result = await client.graphql({ query: '{ patient_consent { nope } }' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('graphql');
  });

  it('applies a role, so permissions take effect', async () => {
    const result = await client.graphql<{ data: { patient_consent: unknown[] } }>({
      query: '{ patient_consent { id } }',
      role: 'patient',
      sessionVariables: { 'x-hasura-user-id': '11111111-1111-1111-1111-111111111111' },
    });

    expect(result.ok).toBe(true);
    // Two of the three seeded rows belong to this patient.
    expect(result.ok && result.data.data.patient_consent).toHaveLength(2);
  });
});

describe('metadata', () => {
  it('exports the document', async () => {
    const result = await client.metadata<{ version: number }>('export_metadata');

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.version).toBe(3);
  });

  it('classifies an unknown metadata type as an api failure', async () => {
    const result = await client.metadata('no_such_metadata_call');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('api');
  });
});

describe('readOnlySql', () => {
  it('reads from information_schema', async () => {
    const result = await client.readOnlySql(
      "select column_name from information_schema.columns where table_name = 'patient_consent'",
    );

    expect(result.ok).toBe(true);
    expect(result.ok && sqlRows(result.data).flat()).toContain('granted_at');
  });

  it('refuses a write, because read_only is always set', async () => {
    const result = await client.readOnlySql('create table should_not_exist (id int)');

    expect(result.ok).toBe(false);
  });
});

describe('explain', () => {
  it('returns a plan for a query', async () => {
    const result = await client.explain<{ field: string; sql: string }[]>({
      query: '{ patient_consent { id } }',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data[0]?.field).toBe('patient_consent');
  });

  it('puts a simulated role into the generated SQL', async () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const result = await client.explain<{ sql: string }[]>({
      query: '{ patient_consent { id } }',
      role: 'patient',
      sessionVariables: { 'x-hasura-user-id': userId },
    });

    expect(result.ok && result.data[0]?.sql).toContain(userId);
  });
});

describe('unreachable endpoint', () => {
  it('is reported as unreachable rather than as an api error', async () => {
    const offline = createClient(
      { ...config, endpoint: 'http://localhost:9' },
      { timeoutMs: 2000 },
    );
    const result = await offline.metadata('export_metadata');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('unreachable');
  });
});

describe('metadata reader against the engine', () => {
  it('finds the fixture table and its permission matrix', async () => {
    const reader = createMetadataReader(client);
    const result = await reader.read();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const table = findTable(findSource(result.data, 'default'), {
      schema: 'public',
      name: 'patient_consent',
    });

    expect(table).toBeDefined();
    expect(permissionMatrix(table!)).toEqual({ patient: ['select'] });
  });
});
