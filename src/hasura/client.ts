import type { ServerConfig } from '../config.js';

import { classifyApiError, collectGraphqlErrors, err, ok, type HasuraResult } from './errors.js';

export type SessionVariables = Readonly<Record<string, string>>;

export type GraphqlRequest = {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly role?: string;
  readonly sessionVariables?: SessionVariables;
};

export type ExplainRequest = Omit<GraphqlRequest, 'role' | 'sessionVariables'> & {
  readonly role?: string;
  readonly sessionVariables?: SessionVariables;
};

/** Hasura's run_sql shape: a header row followed by data rows, all stringified. */
export type SqlResult = { readonly result_type: string; readonly result: string[][] | null };

export type HasuraClient = {
  readonly version: () => Promise<HasuraResult<{ server_type: string; version: string }>>;
  readonly graphql: <T = unknown>(request: GraphqlRequest) => Promise<HasuraResult<T>>;
  readonly metadata: <T = unknown>(
    type: string,
    args?: Readonly<Record<string, unknown>>,
  ) => Promise<HasuraResult<T>>;
  readonly readOnlySql: (sql: string, source?: string) => Promise<HasuraResult<SqlResult>>;
  readonly explain: <T = unknown>(request: ExplainRequest) => Promise<HasuraResult<T>>;
};

const DEFAULT_TIMEOUT_MS = 30_000;

const roleHeaders = (
  role?: string,
  sessionVariables?: SessionVariables,
): Record<string, string> => {
  if (role === undefined) return {};
  return { 'x-hasura-role': role, ...(sessionVariables ?? {}) };
};

/** The `user` object explain takes, which is how a role gets simulated. */
const explainUser = (
  role?: string,
  sessionVariables?: SessionVariables,
): Record<string, string> | undefined => {
  if (role === undefined) return undefined;
  return { 'x-hasura-role': role, ...(sessionVariables ?? {}) };
};

export const createClient = (
  config: ServerConfig,
  options: { readonly timeoutMs?: number; readonly fetchImpl?: typeof fetch } = {},
): HasuraClient => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  const send = async <T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<HasuraResult<T>> => {
    let response: Response;
    try {
      response = await doFetch(`${config.endpoint}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hasura-admin-secret': config.adminSecret,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      return err({ kind: 'unreachable', detail: (cause as Error).message });
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return err({
        kind: 'api',
        code: 'invalid-response',
        message: `Hasura returned HTTP ${String(response.status)} with a non-JSON body`,
        path: null,
      });
    }

    if (!response.ok) return err(classifyApiError(parsed, response.status));
    return ok(parsed as T);
  };

  return {
    version: async () => {
      try {
        const response = await doFetch(`${config.endpoint}/v1/version`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        return ok((await response.json()) as { server_type: string; version: string });
      } catch (cause) {
        return err({ kind: 'unreachable', detail: (cause as Error).message });
      }
    },

    graphql: async <T>(request: GraphqlRequest) => {
      const result = await send<T>(
        '/v1/graphql',
        { query: request.query, ...(request.variables ? { variables: request.variables } : {}) },
        roleHeaders(request.role, request.sessionVariables),
      );
      if (!result.ok) return result;

      // GraphQL reports failures in the body with HTTP 200, so a successful
      // transport does not mean a successful query.
      const errors = collectGraphqlErrors(result.data);
      if (errors.length > 0) return err<T>({ kind: 'graphql', errors });
      return result;
    },

    metadata: (type, args = {}) => send('/v1/metadata', { type, args }),

    // Always read_only: this is internal plumbing, never an exposed SQL path.
    readOnlySql: (sql, source = 'default') =>
      send<SqlResult>('/v2/query', {
        type: 'run_sql',
        args: { source, sql, read_only: true },
      }),

    explain: (request) =>
      send('/v1/graphql/explain', {
        query: {
          query: request.query,
          ...(request.variables ? { variables: request.variables } : {}),
        },
        ...(explainUser(request.role, request.sessionVariables)
          ? { user: explainUser(request.role, request.sessionVariables) }
          : {}),
      }),
  };
};

/** Drops run_sql's header row and returns the data rows. */
export const sqlRows = (result: SqlResult): string[][] => (result.result ?? []).slice(1);
