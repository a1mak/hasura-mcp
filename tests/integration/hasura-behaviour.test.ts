import { describe, expect, it } from 'vitest';

import { explain, graphql, metadata, readSql, sqlRows, version } from './hasura.js';

/**
 * Each test pins one Hasura behaviour the tool implementations depend on. They
 * are assumptions about someone else's software, so they can stop being true
 * without anyone touching this repo — that is the whole point of asserting them.
 */

describe('server identity', () => {
  it('reports a v2 community engine', async () => {
    const { body } = await version();
    expect(body).toMatchObject({ server_type: 'ce', version: expect.stringMatching(/^v2\./) });
  });
});

describe('/v1/graphql/explain', () => {
  it('validates: an unknown field is rejected with a path to the offending selection', async () => {
    const { status, body } = await explain('query { patient_consent { id nonexistent_column } }');

    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'validation-failed',
      path: expect.stringContaining('nonexistent_column'),
    });
  });

  it('refuses mutations outright', async () => {
    const { status, body } = await explain(
      'mutation { delete_patient_consent(where: {}) { affected_rows } }',
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: expect.stringContaining('only queries can be explained') });
  });

  it('returns an array of root fields for a query', async () => {
    const { status, body } = await explain('query { patient_consent { id } }');

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[])[0]).toMatchObject({
      field: 'patient_consent',
      plan: expect.any(Array),
      sql: expect.any(String),
    });
  });

  it('returns a single object for a subscription — a different shape from a query', async () => {
    const { status, body } = await explain('subscription { patient_consent { id } }');

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(false);
    expect(body).toMatchObject({ sql: expect.any(String), plan: expect.any(Array) });
  });

  it("injects a role's row filter into the generated SQL, making permissions debuggable", async () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const { status, body } = await explain('query { patient_consent { id } }', {
      user: { 'x-hasura-role': 'patient', 'x-hasura-user-id': userId },
    });

    expect(status).toBe(200);
    const [first] = body as { sql: string; plan: string[] }[];
    expect(first?.sql).toContain(userId);
    expect(first?.sql).toContain('LIMIT 100');
  });

  it('cannot validate a parameterised query without variable values', async () => {
    // This is why validate_query is local rather than a thin wrapper over explain.
    const { status, body } = await explain(
      'query Q($pid: uuid!) { patient_consent(where: {patient_id: {_eq: $pid}}) { id } }',
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: expect.stringContaining('non-nullable variable') });
  });

  it('reports a permission-hidden field as nonexistent, indistinguishable from a typo', async () => {
    // The tool layer must cross-check metadata and rewrite this message, or it
    // tells the agent a table does not exist when it does.
    const { status, body } = await explain('query { patient_consent { id } }', {
      user: { 'x-hasura-role': 'nobody' },
    });

    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'validation-failed',
      error: expect.stringContaining("not found in type: 'query_root'"),
    });
  });
});

describe('where schema information actually lives', () => {
  it('export_metadata does not carry table columns', async () => {
    const { body } = await metadata('export_metadata');
    const table = (body as { sources: { tables: Record<string, unknown>[] }[] }).sources[0]
      ?.tables[0];

    expect(table).toBeDefined();
    expect(table).not.toHaveProperty('columns');
  });

  it('pg_get_source_tables returns names and schemas only', async () => {
    const { body } = await metadata('pg_get_source_tables', { source: 'default' });
    const tables = body as Record<string, unknown>[];

    expect(tables.length).toBeGreaterThan(0);
    expect(Object.keys(tables[0] ?? {}).sort()).toEqual(['name', 'schema']);
  });

  it('information_schema is the only source of columns, types and nullability', async () => {
    const { body } = await readSql(
      'select column_name, data_type, is_nullable from information_schema.columns ' +
        "where table_schema = 'public' and table_name = 'patient_consent' order by ordinal_position",
    );

    expect(sqlRows(body).map(([name]) => name)).toContain('granted_at');
  });

  it('a computed field is queryable but absent from information_schema', async () => {
    // describe_table reads columns from information_schema, so it must merge
    // computed_fields from metadata or it hides a field the agent can query.
    const { body: columns } = await readSql(
      'select column_name from information_schema.columns ' +
        "where table_schema = 'public' and table_name = 'patient_consent'",
    );
    expect(sqlRows(columns).map(([name]) => name)).not.toContain('is_active');

    const { body: queried } = await graphql('query { patient_consent(limit: 1) { id is_active } }');
    expect(queried).not.toHaveProperty('errors');
  });
});

describe('metadata objects that are not tables', () => {
  it('keeps action permissions outside the table permission keys', async () => {
    const { body } = await metadata('export_metadata');
    const actions = (body as { actions?: { name: string; permissions?: unknown[] }[] }).actions;

    expect(actions?.[0]).toMatchObject({ permissions: [{ role: 'patient' }] });
  });

  it('carries action argument and output shapes in custom_types', async () => {
    const { body } = await metadata('export_metadata');
    const custom = (body as { custom_types?: { input_objects?: { name: string }[] } }).custom_types;

    expect(custom?.input_objects?.map((o) => o.name)).toContain('RevokeConsentInput');
  });

  it('returns remote-schema header values in plaintext, so they must never be surfaced', async () => {
    const { body } = await metadata('export_metadata');
    const remote = (
      body as { remote_schemas?: { definition: { headers?: { name: string; value: string }[] } }[] }
    ).remote_schemas?.[0];

    const secret = remote?.definition.headers?.find((h) => h.name === 'x-hasura-admin-secret');
    expect(secret?.value).toBeTypeOf('string');
    expect(secret?.value.length).toBeGreaterThan(0);
  });

  it('does not describe the fields a remote schema contributes', async () => {
    const { body } = await metadata('export_metadata');
    const remote = (body as { remote_schemas?: Record<string, unknown>[] }).remote_schemas?.[0];

    expect(Object.keys(remote ?? {}).sort()).toEqual(['definition', 'name']);
  });

  it('exposes a remote schema introspection endpoint', async () => {
    const { status, body } = await metadata('introspect_remote_schema', { name: 'self_remote' });

    expect(status).toBe(200);
    expect(body).toHaveProperty('data.__schema');
  });
});

describe('migration state', () => {
  it('has no hdb_catalog.schema_migrations — that is a v1-era table', async () => {
    const { body } = await readSql(
      'select table_name from information_schema.tables ' +
        "where table_schema = 'hdb_catalog' and table_name = 'schema_migrations'",
    );

    expect(sqlRows(body)).toHaveLength(0);
  });

  it('keeps CLI migration state in the catalog-state API instead', async () => {
    const { status, body } = await metadata('get_catalog_state');

    expect(status).toBe(200);
    expect(body).toHaveProperty('cli_state');
  });

  it('reports metadata consistency cheaply', async () => {
    const { body } = await metadata('get_inconsistent_metadata');

    expect(body).toMatchObject({ is_consistent: true, inconsistent_objects: [] });
  });
});

describe('event delivery logging', () => {
  it('creates the delivery log tables once a trigger exists', async () => {
    const { body } = await readSql(
      'select table_name from information_schema.tables ' +
        "where table_schema = 'hdb_catalog' order by table_name",
    );
    const tables = sqlRows(body).map(([name]) => name);

    expect(tables).toEqual(expect.arrayContaining(['event_log', 'event_invocation_logs']));
  });

  it('stores request headers and session variables on action logs, so they must be redacted', async () => {
    const { body } = await readSql(
      'select column_name from information_schema.columns ' +
        "where table_schema = 'hdb_catalog' and table_name = 'hdb_action_log'",
    );
    const columns = sqlRows(body).map(([name]) => name);

    expect(columns).toEqual(expect.arrayContaining(['request_headers', 'session_variables']));
  });
});

describe('mutation dry-run', () => {
  it('predicts affected rows by rewriting the where clause into an aggregate count', async () => {
    const patientId = '11111111-1111-1111-1111-111111111111';
    const where = `{patient_id: {_eq: "${patientId}"}}`;

    const { body: predicted } = await graphql(
      `query { patient_consent_aggregate(where: ${where}) { aggregate { count } } }`,
    );
    const count = (
      predicted as { data: { patient_consent_aggregate: { aggregate: { count: number } } } }
    ).data.patient_consent_aggregate.aggregate.count;

    // Without this the assertion below passes on an empty fixture, proving nothing.
    expect(count).toBeGreaterThan(0);

    // _set to the value already held, so the prediction is checked without
    // changing what a re-run would predict.
    const { body: actual } = await graphql(
      `mutation { update_patient_consent(where: ${where}, _set: {patient_id: "${patientId}"}) { affected_rows } }`,
    );
    const affected = (actual as { data: { update_patient_consent: { affected_rows: number } } })
      .data.update_patient_consent.affected_rows;

    expect(affected).toBe(count);
  });
});
