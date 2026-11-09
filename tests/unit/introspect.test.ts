import { describe, expect, it } from 'vitest';

import {
  createQueryRootReader,
  fetchQueryRoot,
  fetchType,
  type GraphqlIntrospector,
} from '../../src/graphql/introspect.js';
import type { HasuraResult } from '../../src/hasura/errors.js';

const stub = (payload: unknown): GraphqlIntrospector & { lastQuery: () => string } => {
  let lastQuery = '';
  return {
    graphql: ((request: { query: string }) => {
      lastQuery = request.query;
      return Promise.resolve({ ok: true, data: { data: payload } });
    }) as GraphqlIntrospector['graphql'],
    lastQuery: () => lastQuery,
  };
};

describe('fetchQueryRoot', () => {
  it('returns the fields, with descriptions and argument names', async () => {
    const client = stub({
      __type: {
        fields: [
          {
            name: 'patient_consent_by_pk',
            description: 'fetch data from the table: "patient_consent" using primary key columns',
            type: { kind: 'OBJECT', name: 'patient_consent', ofType: null },
            args: [{ name: 'id' }],
          },
          {
            name: 'remote_field',
            description: null,
            type: { kind: 'OBJECT', name: 'remote_type', ofType: null },
            args: [],
          },
        ],
      },
    });

    const result = await fetchQueryRoot(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]).toMatchObject({
      name: 'patient_consent_by_pk',
      args: [{ name: 'id' }],
    });
    expect(result.data[1]).toMatchObject({
      name: 'remote_field',
      description: null,
    });
  });

  it('asks only for argument names, never their types, to keep the call small', async () => {
    const client = stub({ __type: { fields: [] } });
    await fetchQueryRoot(client);

    expect(client.lastQuery()).toContain('args { name }');
  });

  it('treats a missing query_root as an empty field list rather than throwing', async () => {
    const result = await fetchQueryRoot(stub({ __type: null }));

    expect(result).toEqual({ ok: true, data: [] });
  });

  it('passes a transport failure through untouched', async () => {
    const failing: GraphqlIntrospector = {
      graphql: () =>
        Promise.resolve({
          ok: false,
          failure: { kind: 'unreachable', detail: 'down' },
        }),
    };

    const result = await fetchQueryRoot(failing);

    expect(result).toMatchObject({ ok: false, failure: { kind: 'unreachable' } });
  });
});

describe('fetchType', () => {
  it('returns the fields and enum values of a named type', async () => {
    const client = stub({
      __type: {
        name: 'consent_state_enum',
        kind: 'ENUM',
        fields: null,
        enumValues: [{ name: 'GRANTED', description: 'Consent given' }],
      },
    });

    const result = await fetchType(client, 'consent_state_enum');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      kind: 'ENUM',
      enumValues: [{ name: 'GRANTED', description: 'Consent given' }],
    });
  });

  it('returns null for a type the schema does not have', async () => {
    const result = await fetchType(stub({ __type: null }), 'nope');

    expect(result).toEqual({ ok: true, data: null });
  });

  it('quotes the type name so an odd name cannot break the query', async () => {
    const client = stub({ __type: null });
    await fetchType(client, 'Type"with\\Backslash');

    expect(client.lastQuery()).toContain('Type\\"with\\\\Backslash');
  });

  it('returns null when the payload contains no __type key', async () => {
    const result = await fetchType(stub({}), 'any_type');

    expect(result).toEqual({ ok: true, data: null });
  });
});

const queryRootPayload = (fieldName: string): HasuraResult<unknown> => ({
  ok: true,
  data: {
    data: {
      __type: {
        fields: [
          {
            name: fieldName,
            description: null,
            args: [],
            type: { kind: 'OBJECT', name: 'T', ofType: null },
          },
        ],
      },
    },
  },
});

const counting = (
  responses: readonly HasuraResult<unknown>[],
): { client: GraphqlIntrospector; calls: () => number } => {
  let calls = 0;
  const client = {
    graphql: () => {
      const response = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return Promise.resolve(response);
    },
  } as GraphqlIntrospector;
  return { client, calls: () => calls };
};

describe('createQueryRootReader', () => {
  it('reads through to the engine on a cold call', async () => {
    const { client, calls } = counting([queryRootPayload('patient_consent')]);

    const result = await createQueryRootReader(client).read();

    expect(result).toMatchObject({ ok: true, data: [{ name: 'patient_consent' }] });
    expect(calls()).toBe(1);
  });

  it('serves a second call within the window from cache', async () => {
    const { client, calls } = counting([queryRootPayload('patient_consent')]);
    const reader = createQueryRootReader(client, { ttlMs: 1000, now: () => 0 });

    await reader.read();
    await reader.read();
    expect(calls()).toBe(1);
  });

  it('re-reads once the window has passed', async () => {
    const { client, calls } = counting([queryRootPayload('patient_consent')]);
    let clock = 0;
    const reader = createQueryRootReader(client, { ttlMs: 100, now: () => clock });

    await reader.read();
    clock = 500;
    await reader.read();
    expect(calls()).toBe(2);
  });

  it('does not cache a failure, so an outage is retried rather than inherited', async () => {
    const { client, calls } = counting([
      { ok: false, failure: { kind: 'unreachable', detail: 'down' } },
      queryRootPayload('patient_consent'),
    ]);
    const reader = createQueryRootReader(client, { ttlMs: 10_000, now: () => 0 });

    await expect(reader.read()).resolves.toMatchObject({ ok: false });
    await expect(reader.read()).resolves.toMatchObject({ ok: true });
    expect(calls()).toBe(2);
  });

  it('shares one request between concurrent callers', async () => {
    const { client, calls } = counting([queryRootPayload('patient_consent')]);
    const reader = createQueryRootReader(client, { ttlMs: 1000, now: () => 0 });

    await Promise.all([reader.read(), reader.read(), reader.read()]);
    expect(calls()).toBe(1);
  });

  it('drops the cache when invalidated', async () => {
    const { client, calls } = counting([queryRootPayload('patient_consent')]);
    const reader = createQueryRootReader(client, { ttlMs: 10_000, now: () => 0 });

    await reader.read();
    reader.invalidate();
    await reader.read();
    expect(calls()).toBe(2);
  });
});
