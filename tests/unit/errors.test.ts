import { describe, expect, it } from 'vitest';

import {
  classifyApiError,
  collectGraphqlErrors,
  describeFailure,
  type HasuraFailure,
} from '../../src/hasura/errors.js';

describe('classifyApiError', () => {
  it('reads the engine error shape', () => {
    expect(
      classifyApiError({ error: 'no such table', code: 'not-exists', path: '$.args' }, 400),
    ).toEqual({ kind: 'api', code: 'not-exists', message: 'no such table', path: '$.args' });
  });

  it('separates auth failures, which need a different fix from the user', () => {
    expect(
      classifyApiError({ error: 'secret required', code: 'access-denied' }, 401),
    ).toMatchObject({ kind: 'unauthorized' });
  });

  it('treats any 401 as auth even when the code is unfamiliar', () => {
    expect(classifyApiError({ error: 'nope', code: 'something-new' }, 401)).toMatchObject({
      kind: 'unauthorized',
    });
  });

  it('survives a body that is not the shape we expect', () => {
    expect(classifyApiError('a string', 500)).toEqual({
      kind: 'api',
      code: 'unknown',
      message: 'Hasura returned HTTP 500',
      path: null,
    });
  });
});

describe('collectGraphqlErrors', () => {
  it('pulls the code out of extensions, where Hasura puts it', () => {
    expect(
      collectGraphqlErrors({
        errors: [{ message: 'field not found', extensions: { code: 'validation-failed' } }],
      }),
    ).toEqual([{ message: 'field not found', code: 'validation-failed', path: null }]);
  });

  it('returns nothing for a successful body', () => {
    expect(collectGraphqlErrors({ data: { x: 1 } })).toEqual([]);
  });
});

describe('describeFailure', () => {
  const cases: [HasuraFailure, string][] = [
    [{ kind: 'unreachable', detail: 'ECONNREFUSED' }, 'not the /v1/graphql path'],
    [{ kind: 'unauthorized', detail: 'denied' }, 'HASURA_ADMIN_SECRET'],
    [{ kind: 'api', code: 'x', message: 'boom', path: '$.args' }, 'boom (at $.args)'],
    [
      { kind: 'graphql', errors: [{ message: 'bad field', code: null, path: '$.sel' }] },
      'bad field (at $.sel)',
    ],
  ];

  it.each(cases)('names the next move for %o', (failure, expected) => {
    expect(describeFailure(failure)).toContain(expected);
  });

  it('omits the location when there is none', () => {
    expect(describeFailure({ kind: 'api', code: 'x', message: 'boom', path: null })).toBe('boom');
  });
});
