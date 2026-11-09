import { describe, expect, it } from 'vitest';

import { fetchType } from '../../src/graphql/introspect.js';
import { renderType } from '../../src/graphql/type-ref.js';
import { createClient } from '../../src/hasura/client.js';

/**
 * A hand-written stub agrees with whatever shape the code expects, which is how
 * a reader that cannot reach through the real response body passes anyway. This
 * runs the entry point against the engine.
 */
const client = createClient({
  endpoint: process.env.HASURA_TEST_ENDPOINT ?? 'http://localhost:8299',
  adminSecret: process.env.HASURA_TEST_ADMIN_SECRET ?? 'fixture',
  projectDir: null,
});

describe('fetchType against a live engine', () => {
  it('reads a real table type, its fields and their rendered GraphQL types', async () => {
    const result = await fetchType(client, 'patient_consent');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ name: 'patient_consent', kind: 'OBJECT' });
    expect(result.data?.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['id', 'granted_at']),
    );
    expect(renderType(result.data?.fields.find((f) => f.name === 'id')?.type)).toBe('uuid!');
  });
});
