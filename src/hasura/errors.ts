import { match } from 'ts-pattern';

export type GraphqlError = {
  readonly message: string;
  readonly code: string | null;
  readonly path: string | null;
};

export type HasuraFailure =
  /** The endpoint could not be reached at all — wrong URL, engine down, DNS. */
  | { readonly kind: 'unreachable'; readonly detail: string }
  | { readonly kind: 'unauthorized'; readonly detail: string }
  /** A metadata or query API call the engine understood and refused. */
  | {
      readonly kind: 'api';
      readonly code: string;
      readonly message: string;
      readonly path: string | null;
    }
  | { readonly kind: 'graphql'; readonly errors: readonly GraphqlError[] };

export type HasuraResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: HasuraFailure };

export const ok = <T>(data: T): HasuraResult<T> => ({ ok: true, data });
export const err = <T>(failure: HasuraFailure): HasuraResult<T> => ({ ok: false, failure });

type ApiErrorBody = { error?: unknown; code?: unknown; path?: unknown };
type GraphqlBody = { errors?: { message?: unknown; path?: unknown; extensions?: unknown }[] };

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const AUTH_CODES = new Set(['access-denied', 'invalid-headers', 'unauthorized']);

export const classifyApiError = (body: unknown, status: number): HasuraFailure => {
  const { error, code, path } = (body ?? {}) as ApiErrorBody;
  const message = asString(error) ?? `Hasura returned HTTP ${String(status)}`;
  const errorCode = asString(code) ?? 'unknown';

  if (AUTH_CODES.has(errorCode) || status === 401) {
    return { kind: 'unauthorized', detail: message };
  }
  return { kind: 'api', code: errorCode, message, path: asString(path) };
};

export const collectGraphqlErrors = (body: unknown): readonly GraphqlError[] => {
  const { errors } = (body ?? {}) as GraphqlBody;
  if (!Array.isArray(errors)) return [];

  return errors.map((entry) => {
    const extensions = (entry.extensions ?? {}) as { code?: unknown; path?: unknown };
    return {
      message: asString(entry.message) ?? 'Unknown GraphQL error',
      code: asString(extensions.code),
      path: asString(entry.path) ?? asString(extensions.path),
    };
  });
};

/** One sentence a tool can hand to an agent, naming the next move where there is one. */
export const describeFailure = (failure: HasuraFailure): string =>
  match(failure)
    .with(
      { kind: 'unreachable' },
      (f) =>
        `Could not reach the Hasura endpoint (${f.detail}). Check HASURA_ENDPOINT is the base URL ` +
        `of a running instance, not the /v1/graphql path.`,
    )
    .with(
      { kind: 'unauthorized' },
      (f) => `Hasura rejected the admin secret (${f.detail}). Check HASURA_ADMIN_SECRET.`,
    )
    .with({ kind: 'api' }, (f) => (f.path === null ? f.message : `${f.message} (at ${f.path})`))
    .with({ kind: 'graphql' }, (f) =>
      f.errors.map((e) => (e.path === null ? e.message : `${e.message} (at ${e.path})`)).join('; '),
    )
    .exhaustive();
