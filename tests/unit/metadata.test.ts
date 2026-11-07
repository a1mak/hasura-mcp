import { describe, expect, it } from 'vitest';

import type { HasuraResult } from '../../src/hasura/errors.js';
import {
  allTables,
  createMetadataReader,
  permissionMatrix,
  type Metadata,
  type MetadataFetcher,
  type MetadataSource,
} from '../../src/metadata.js';

const EXHAUSTED: HasuraResult<Metadata> = {
  ok: false,
  failure: { kind: 'api', code: 'stub-exhausted', message: 'no response queued', path: null },
};

const stubClient = (
  responses: readonly HasuraResult<Metadata>[],
): { client: MetadataFetcher; calls: () => number } => {
  let calls = 0;
  const client = {
    metadata: () => {
      const response = responses[Math.min(calls, responses.length - 1)] ?? EXHAUSTED;
      calls += 1;
      return Promise.resolve(response);
    },
  };
  return { client, calls: () => calls };
};

describe('createMetadataReader', () => {
  it('reads through to the engine on a cold call', async () => {
    const { client, calls } = stubClient([{ ok: true, data: { version: 3 } }]);
    const reader = createMetadataReader(client);

    await expect(reader.read()).resolves.toEqual({ ok: true, data: { version: 3 } });
    expect(calls()).toBe(1);
  });

  it('serves a second call within the window from cache', async () => {
    const { client, calls } = stubClient([{ ok: true, data: { version: 3 } }]);
    const reader = createMetadataReader(client, { ttlMs: 1000, now: () => 0 });

    await reader.read();
    await reader.read();
    expect(calls()).toBe(1);
  });

  it('re-reads once the window has passed', async () => {
    const { client, calls } = stubClient([{ ok: true, data: { version: 3 } }]);
    let clock = 0;
    const reader = createMetadataReader(client, { ttlMs: 100, now: () => clock });

    await reader.read();
    clock = 500;
    await reader.read();
    expect(calls()).toBe(2);
  });

  it('does not cache a failure, so an outage is retried rather than inherited', async () => {
    const { client, calls } = stubClient([
      { ok: false, failure: { kind: 'unreachable', detail: 'down' } },
      { ok: true, data: { version: 3 } },
    ]);
    const reader = createMetadataReader(client, { ttlMs: 10_000, now: () => 0 });

    await expect(reader.read()).resolves.toMatchObject({ ok: false });
    await expect(reader.read()).resolves.toMatchObject({ ok: true });
    expect(calls()).toBe(2);
  });

  it('shares one request between concurrent callers', async () => {
    const { client, calls } = stubClient([{ ok: true, data: { version: 3 } }]);
    const reader = createMetadataReader(client, { ttlMs: 1000, now: () => 0 });

    await Promise.all([reader.read(), reader.read(), reader.read()]);
    expect(calls()).toBe(1);
  });

  it('drops the cache when invalidated', async () => {
    const { client, calls } = stubClient([{ ok: true, data: { version: 3 } }]);
    const reader = createMetadataReader(client, { ttlMs: 10_000, now: () => 0 });

    await reader.read();
    reader.invalidate();
    await reader.read();
    expect(calls()).toBe(2);
  });
});

describe('permissionMatrix', () => {
  it('collects every operation a role holds', () => {
    expect(
      permissionMatrix({
        table: { schema: 'public', name: 'patient_consent' },
        select_permissions: [{ role: 'patient' }, { role: 'support' }],
        update_permissions: [{ role: 'support' }],
        delete_permissions: [{ role: 'support' }],
      }),
    ).toEqual({ patient: ['select'], support: ['select', 'update', 'delete'] });
  });

  it('returns an empty matrix for a table nobody can reach', () => {
    expect(permissionMatrix({ table: { schema: 'public', name: 'secret' } })).toEqual({});
  });
});

const SOURCE: MetadataSource = {
  name: 'default',
  kind: 'postgres',
  tables: [
    { table: { schema: 'public', name: 'patient_consent' } },
    { table: { schema: 'billing', name: 'ledger' } },
  ],
};

describe('allTables', () => {
  it('lists every tracked table across schemas', () => {
    expect(allTables(SOURCE)).toEqual([
      { schema: 'public', name: 'patient_consent' },
      { schema: 'billing', name: 'ledger' },
    ]);
  });

  it('returns an empty list for a source with no tracked tables', () => {
    expect(allTables({ name: 'warehouse', kind: 'postgres' })).toEqual([]);
  });

  it('returns an empty list for a source that does not exist', () => {
    expect(allTables(undefined)).toEqual([]);
  });
});
