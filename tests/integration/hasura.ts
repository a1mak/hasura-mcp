const endpoint = process.env.HASURA_TEST_ENDPOINT ?? 'http://localhost:8299';
const adminSecret = process.env.HASURA_TEST_ADMIN_SECRET ?? 'fixture';

export type HasuraResponse = {
  readonly status: number;
  readonly body: unknown;
};

const post = async (path: string, payload: unknown): Promise<HasuraResponse> => {
  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hasura-admin-secret': adminSecret },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
};

export const graphql = (query: string, variables?: Record<string, unknown>) =>
  post('/v1/graphql', { query, ...(variables ? { variables } : {}) });

export const metadata = (type: string, args: Record<string, unknown> = {}) =>
  post('/v1/metadata', { type, args });

/** Always `read_only`, so an integration run can never mutate the fixture's schema. */
export const readSql = (sql: string) =>
  post('/v2/query', { type: 'run_sql', args: { source: 'default', read_only: true, sql } });

export const explain = (
  query: string,
  extra: { variables?: Record<string, unknown>; user?: Record<string, string> } = {},
) =>
  post('/v1/graphql/explain', {
    query: { query, ...(extra.variables ? { variables: extra.variables } : {}) },
    ...(extra.user ? { user: extra.user } : {}),
  });

export const version = async (): Promise<HasuraResponse> => {
  const response = await fetch(`${endpoint}/v1/version`);
  return { status: response.status, body: await response.json() };
};

export const sqlRows = (body: unknown): string[][] => {
  const result = (body as { result?: string[][] }).result;
  return result ? result.slice(1) : [];
};
