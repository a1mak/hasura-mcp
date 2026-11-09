import { describe, expect, it } from 'vitest';

import {
  fetchQueryRoot,
  fetchType,
  type GraphqlIntrospector,
} from '../../src/graphql/introspect.js';

const stub = (payload: unknown): GraphqlIntrospector & { lastQuery: () => string } => {
  let lastQuery = '';
  return {
    graphql: ((request: { query: string }) => {
      lastQuery = request.query;
      return Promise.resolve({ ok: true, data: payload });
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
