// tests/unit/name-map.test.ts
import { describe, expect, it } from 'vitest';

import type { IntrospectionField } from '../../src/graphql/introspect.js';
import {
  buildNameMap,
  lookupByFieldName,
  lookupByNormalised,
  lookupTable,
  matchByNormalised,
  normalise,
  reverseLookup,
} from '../../src/graphql/name-map.js';

const field = (
  name: string,
  typeName: string,
  description: string | null,
  args: string[] = [],
): IntrospectionField => ({
  name,
  description,
  type: {
    kind: 'NON_NULL',
    name: null,
    ofType: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: typeName, ofType: null } },
  },
  args: args.map((a) => ({ name: a })),
});

const CAMEL = [
  field('probeTypes', 'ProbeTypes', 'fetch data from the table: "probe_types"'),
  field(
    'probeTypesAggregate',
    'ProbeTypesAggregate',
    'fetch aggregated fields from the table: "probe_types"',
  ),
  field(
    'probeTypesByPk',
    'ProbeTypes',
    'fetch data from the table: "probe_types" using primary key columns',
    ['id'],
  ),
];

describe('normalise', () => {
  it('strips underscores and case so naming style cannot cause a miss', () => {
    expect(normalise('probe_types')).toBe('probetypes');
    expect(normalise('probeTypes')).toBe('probetypes');
    expect(normalise('ProbeTypes')).toBe('probetypes');
  });
});

describe('matchByNormalised', () => {
  it('finds the single item that normalises the same', () => {
    expect(matchByNormalised('granted_at', ['id', 'grantedAt'], (s) => s)).toBe('grantedAt');
  });

  it('refuses when two items normalise identically', () => {
    // picking one would describe the wrong thing confidently.
    expect(matchByNormalised('user_account', ['user_account', 'useraccount'], (s) => s)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchByNormalised('nope', ['id'], (s) => s)).toBeNull();
  });
});

describe('buildNameMap', () => {
  it('reads the table name out of the generated description', () => {
    const entry = lookupTable(buildNameMap(CAMEL), { schema: 'public', name: 'probe_types' });

    expect(entry).toMatchObject({ queryField: 'probeTypes', typeName: 'ProbeTypes' });
  });

  it('takes the primary key from the by_pk arguments', () => {
    const entry = lookupTable(buildNameMap(CAMEL), { schema: 'public', name: 'probe_types' });

    expect(entry?.pkArgs).toEqual(['id']);
  });

  it('ignores the aggregate field when choosing the row type', () => {
    const entry = lookupTable(buildNameMap(CAMEL), { schema: 'public', name: 'probe_types' });

    expect(entry?.typeName).not.toContain('Aggregate');
  });

  it('matches a schema-qualified description', () => {
    // public tables are described bare, others qualified.
    const qualified = [
      field('billingLedger', 'BillingLedger', 'fetch data from the table: "billing.ledger"'),
    ];
    const entry = lookupTable(buildNameMap(qualified), { schema: 'billing', name: 'ledger' });

    expect(entry).toMatchObject({ typeName: 'BillingLedger' });
  });

  it('ignores a field that describes no table', () => {
    // remote schemas and actions sit on query_root too.
    const mixed = [
      ...CAMEL,
      {
        name: 'remote',
        description: null,
        type: { kind: 'OBJECT', name: 'remote_query', ofType: null },
        args: [],
      },
    ];

    expect(reverseLookup(buildNameMap(mixed), 'remote_query')).toBeNull();
  });
});

describe('lookupByNormalised', () => {
  it('resolves without any description, so a reworded description cannot break it', () => {
    const bare = [field('probeTypes', 'ProbeTypes', null)];
    const entry = lookupByNormalised(bare, { schema: 'public', name: 'probe_types' });

    expect(entry).toMatchObject({ queryField: 'probeTypes', typeName: 'ProbeTypes' });
  });

  it('refuses when two fields normalise the same', () => {
    const clashing = [
      field('userAccount', 'UserAccount', null),
      field('user_account', 'UserAccount2', null),
    ];

    expect(lookupByNormalised(clashing, { schema: 'public', name: 'user_account' })).toBeNull();
  });
});

describe('lookupByFieldName', () => {
  it('finds the entry for an exact field name, which is what custom_name gives', () => {
    // a custom name follows no convention and is used raw.
    const custom = [
      field('widget_thing', 'widget_thing', null),
      field(
        'widget_thingByPk',
        'widget_thing',
        'fetch data from the table: "probe_types" using primary key columns',
        ['id'],
      ),
    ];

    expect(lookupByFieldName(custom, 'widget_thing')).toMatchObject({
      queryField: 'widget_thing',
      typeName: 'widget_thing',
      pkArgs: ['id'],
    });
  });

  it('returns null when no field carries that exact name', () => {
    expect(lookupByFieldName(CAMEL, 'nope')).toBeNull();
  });
});

describe('reverseLookup', () => {
  it('maps a GraphQL type back to its schema-qualified table', () => {
    const qualified = [
      field('billingLedger', 'BillingLedger', 'fetch data from the table: "billing.ledger"'),
    ];

    expect(reverseLookup(buildNameMap(qualified), 'BillingLedger')).toBe('billing.ledger');
  });

  it('resolves a bare-described public table to its bare key', () => {
    const bare = [
      field('patientConsent', 'PatientConsent', 'fetch data from the table: "patient_consent"'),
    ];

    expect(reverseLookup(buildNameMap(bare), 'PatientConsent')).toBe('patient_consent');
  });

  it('returns null for a type that is not a table', () => {
    expect(reverseLookup(buildNameMap(CAMEL), 'String')).toBeNull();
  });
});
