import type { GraphqlRequest } from '../hasura/client.js';
import { ok, type HasuraResult } from '../hasura/errors.js';
import type { TypeRef } from './type-ref.js';

/** Stated non-generically so a test double is a plain object rather than a cast. */
export type GraphqlIntrospector = {
  readonly graphql: <T>(request: GraphqlRequest) => Promise<HasuraResult<T>>;
};

export type IntrospectionField = {
  readonly name: string;
  readonly description: string | null;
  readonly type: TypeRef;
  readonly args: readonly { readonly name: string }[];
};

export type IntrospectedEnumValue = {
  readonly name: string;
  readonly description: string | null;
};

export type IntrospectedType = {
  readonly name: string;
  readonly kind: string;
  readonly fields: readonly IntrospectionField[];
  readonly enumValues: readonly IntrospectedEnumValue[];
};

/** Four levels of wrapper covers `[Type!]!`, which is the deepest Hasura produces. */
const TYPE_REF = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';

/**
 * Argument names alone — a `_by_pk` field's arguments are the primary key. Their
 * types would multiply the response by the argument list of every other field.
 */
const QUERY_ROOT = `{ __type(name: "query_root") { fields {
  name description args { name } type { ${TYPE_REF} }
} } }`;

const namedTypeQuery = (name: string): string =>
  `{ __type(name: ${JSON.stringify(name)}) {
    name kind
    enumValues { name description }
    fields { name description args { name } type { ${TYPE_REF} } }
  } }`;

type FieldPayload = {
  name?: unknown;
  description?: unknown;
  args?: { name?: unknown }[] | null;
  type?: TypeRef | null;
};

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const readField = (raw: FieldPayload): IntrospectionField => ({
  name: asString(raw.name) ?? '',
  description: asString(raw.description),
  type: raw.type ?? { kind: 'SCALAR', name: null, ofType: null },
  args: (raw.args ?? []).map((arg) => ({ name: asString(arg.name) ?? '' })),
});

export const fetchQueryRoot = async (
  client: GraphqlIntrospector,
): Promise<HasuraResult<readonly IntrospectionField[]>> => {
  const result = await client.graphql<{ __type?: { fields?: FieldPayload[] | null } | null }>({
    query: QUERY_ROOT,
  });
  if (!result.ok) return result;

  return ok((result.data.__type?.fields ?? []).map(readField));
};

export const fetchType = async (
  client: GraphqlIntrospector,
  name: string,
): Promise<HasuraResult<IntrospectedType | null>> => {
  const result = await client.graphql<{
    __type?: {
      name?: unknown;
      kind?: unknown;
      fields?: FieldPayload[] | null;
      enumValues?: { name?: unknown; description?: unknown }[] | null;
    } | null;
  }>({ query: namedTypeQuery(name) });
  if (!result.ok) return result;

  const raw = result.data.__type;
  // Wire payload may omit the __type key entirely.
  if (raw == null) return ok(null);

  return ok({
    name: asString(raw.name) ?? name,
    kind: asString(raw.kind) ?? 'OBJECT',
    fields: (raw.fields ?? []).map(readField),
    enumValues: (raw.enumValues ?? []).map((value) => ({
      name: asString(value.name) ?? '',
      description: asString(value.description),
    })),
  });
};
