import { describe, expect, it } from 'vitest';

import { isNullable, namedType, renderType, type TypeRef } from '../../src/graphql/type-ref.js';

const scalar = (name: string): TypeRef => ({ kind: 'SCALAR', name, ofType: null });
const nonNull = (of: TypeRef): TypeRef => ({ kind: 'NON_NULL', name: null, ofType: of });
const list = (of: TypeRef): TypeRef => ({ kind: 'LIST', name: null, ofType: of });

describe('renderType', () => {
  it('renders a plain scalar', () => {
    expect(renderType(scalar('uuid'))).toBe('uuid');
  });

  it('renders a non-null scalar with the marker an agent must type', () => {
    expect(renderType(nonNull(scalar('String')))).toBe('String!');
  });

  it('renders a nullable list of non-null elements', () => {
    expect(renderType(list(nonNull(scalar('String'))))).toBe('[String!]');
  });

  it('renders a non-null list of non-null elements', () => {
    expect(renderType(nonNull(list(nonNull(scalar('String')))))).toBe('[String!]!');
  });

  it('returns null for an absent reference rather than an empty string', () => {
    expect(renderType(null)).toBeNull();
  });
});

describe('namedType', () => {
  it('unwraps every wrapper to reach the named type', () => {
    expect(namedType(nonNull(list(nonNull(scalar('ProbeTypes')))))).toBe('ProbeTypes');
  });

  it('returns null for an absent reference', () => {
    expect(namedType(undefined)).toBeNull();
  });
});

describe('isNullable', () => {
  it('reads optionality from the outermost wrapper only', () => {
    // [String!] is an optional list whose elements are not optional.
    expect(isNullable(list(nonNull(scalar('String'))))).toBe(true);
    expect(isNullable(nonNull(list(nonNull(scalar('String')))))).toBe(false);
  });
});
