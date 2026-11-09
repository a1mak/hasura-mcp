import { tableKey, type TableName } from '../metadata.js';
import type { IntrospectionField } from './introspect.js';
import { namedType } from './type-ref.js';

export const normalise = (value: string): string => value.replace(/_/g, '').toLowerCase();

/**
 * A match only when exactly one item normalises the same. Two items collapsing to
 * one string is unresolvable, and choosing between them would mean naming the
 * wrong object with full confidence.
 */
export const matchByNormalised = <T>(
  target: string,
  items: readonly T[],
  key: (item: T) => string,
): T | null => {
  const wanted = normalise(target);
  const hits = items.filter((item) => normalise(key(item)) === wanted);
  return hits.length === 1 ? (hits[0] ?? null) : null;
};

export type GraphqlTableName = {
  readonly queryField: string;
  readonly typeName: string;
  readonly pkArgs: readonly string[];
};

/** Hasura generates `fetch data from the table: "x"`; the aggregate and by-pk
 *  fields carry their own wording around the same quoted name. */
const TABLE_IN_DESCRIPTION = /from the table: "([^"]+)"/;
const BY_PK = 'using primary key columns';
const AGGREGATED = 'fetch aggregated fields';

const isAggregate = (field: IntrospectionField): boolean =>
  (field.description ?? '').startsWith(AGGREGATED);

const isByPk = (field: IntrospectionField): boolean => (field.description ?? '').includes(BY_PK);

const pkArgsFor = (fields: readonly IntrospectionField[], typeName: string): readonly string[] =>
  fields.find((f) => isByPk(f) && namedType(f.type) === typeName)?.args.map((a) => a.name) ?? [];

/**
 * Keyed by the table name exactly as the description reports it — bare for a
 * public table, schema-qualified elsewhere — so both spellings resolve.
 */
export const buildNameMap = (
  fields: readonly IntrospectionField[],
): Map<string, GraphqlTableName> => {
  const map = new Map<string, GraphqlTableName>();

  for (const field of fields.filter((f) => !isAggregate(f))) {
    const described = TABLE_IN_DESCRIPTION.exec(field.description ?? '')?.[1];
    if (described === undefined) continue;

    const typeName = namedType(field.type);
    if (typeName === null) continue;

    const existing = map.get(described);
    const byPk = isByPk(field);

    map.set(described, {
      queryField: byPk ? (existing?.queryField ?? field.name) : field.name,
      typeName: existing?.typeName ?? typeName,
      pkArgs: byPk ? field.args.map((a) => a.name) : (existing?.pkArgs ?? []),
    });
  }

  return map;
};

/**
 * The bare key is tried only for `public`: a bare description means the schema
 * was omitted, and `public` is the one case verified. Trying it for any schema
 * would let a hidden `billing.ledger` resolve to `public.ledger`'s names. A
 * non-public table described bare yields null here and falls through to the
 * caller's normalised matching, which refuses a tie.
 */
export const lookupTable = (
  map: Map<string, GraphqlTableName>,
  table: TableName,
): GraphqlTableName | null =>
  map.get(tableKey(table)) ?? (table.schema === 'public' ? map.get(table.name) : undefined) ?? null;

/**
 * Descriptions are generated prose, not a documented contract, so a future
 * reword must not break resolution. This rebuilds the lookup from field names
 * alone, which survives any wording change.
 */
export const lookupByNormalised = (
  fields: readonly IntrospectionField[],
  table: TableName,
): GraphqlTableName | null => {
  const rows = fields.filter((f) => !isAggregate(f) && !isByPk(f));
  const match = matchByNormalised(table.name, rows, (f) => f.name);
  if (match === null) return null;

  const typeName = namedType(match.type);
  if (typeName === null) return null;

  return { queryField: match.name, typeName, pkArgs: pkArgsFor(fields, typeName) };
};

/**
 * A `custom_name` is the GraphQL field name verbatim — Hasura does not transform
 * it. Looking the field up by that name also yields the type name and the
 * primary-key arguments, which the configured name alone cannot give.
 */
export const lookupByFieldName = (
  fields: readonly IntrospectionField[],
  fieldName: string,
): GraphqlTableName | null => {
  const field = fields.find((f) => f.name === fieldName);
  if (field === undefined) return null;

  const typeName = namedType(field.type);
  if (typeName === null) return null;

  return { queryField: fieldName, typeName, pkArgs: pkArgsFor(fields, typeName) };
};

/** The key exactly as the description spelled it: bare for a public table,
 *  schema-qualified elsewhere. Callers must not assume a schema prefix. */
export const reverseLookup = (
  map: Map<string, GraphqlTableName>,
  typeName: string,
): string | null => {
  for (const [table, entry] of map) {
    if (entry.typeName === typeName) return table;
  }
  return null;
};
