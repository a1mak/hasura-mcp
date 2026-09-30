import { describe, expect, it } from 'vitest';

import { describeMissing, readConfig } from '../../src/config.js';

describe('readConfig', () => {
  it('reads a minimal endpoint-only configuration', () => {
    const result = readConfig({
      HASURA_ENDPOINT: 'http://localhost:8299',
      HASURA_ADMIN_SECRET: 'fixture',
    });

    expect(result).toEqual({
      ok: true,
      config: {
        endpoint: 'http://localhost:8299',
        adminSecret: 'fixture',
        projectDir: null,
      },
    });
  });

  it('reports every missing variable at once, not just the first', () => {
    const result = readConfig({});

    expect(result).toEqual({
      ok: false,
      missing: ['HASURA_ENDPOINT', 'HASURA_ADMIN_SECRET'],
    });
  });

  it('treats blank and whitespace-only values as missing', () => {
    const result = readConfig({ HASURA_ENDPOINT: '   ', HASURA_ADMIN_SECRET: '' });

    expect(result).toEqual({
      ok: false,
      missing: ['HASURA_ENDPOINT', 'HASURA_ADMIN_SECRET'],
    });
  });

  it('strips trailing slashes so appended paths cannot double up', () => {
    const result = readConfig({
      HASURA_ENDPOINT: 'http://localhost:8299///',
      HASURA_ADMIN_SECRET: 'fixture',
    });

    expect(result.ok && result.config.endpoint).toBe('http://localhost:8299');
  });

  it('carries a project directory when one is set', () => {
    const result = readConfig({
      HASURA_ENDPOINT: 'http://localhost:8299',
      HASURA_ADMIN_SECRET: 'fixture',
      HASURA_PROJECT_DIR: '/app/hasura',
    });

    expect(result.ok && result.config.projectDir).toBe('/app/hasura');
  });

  it('treats a blank project directory as absent, so the drift tools stay unregistered', () => {
    const result = readConfig({
      HASURA_ENDPOINT: 'http://localhost:8299',
      HASURA_ADMIN_SECRET: 'fixture',
      HASURA_PROJECT_DIR: '  ',
    });

    expect(result.ok && result.config.projectDir).toBeNull();
  });
});

describe('describeMissing', () => {
  it('names the missing variables and states that the endpoint is a base URL', () => {
    const message = describeMissing(['HASURA_ENDPOINT']);

    expect(message).toContain('HASURA_ENDPOINT');
    expect(message).toContain('not the /v1/graphql path');
  });
});
