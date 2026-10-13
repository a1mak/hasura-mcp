import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

type Run = { code: number; stdout: string; stderr: string };

const runCli = async (env: Record<string, string>): Promise<Run> => {
  try {
    const { stdout, stderr } = await run('node', ['dist/index.js'], {
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

/**
 * Only the paths that terminate. A configured server runs until the client
 * closes the pipe, so its behaviour is asserted in stdio.test.ts instead.
 */
describe('the built CLI, misconfigured', () => {
  it('exits non-zero and explains itself on stderr', async () => {
    const { code, stderr } = await runCli({});

    expect(code).toBe(1);
    expect(stderr).toContain('HASURA_ENDPOINT');
    expect(stderr).toContain('not the /v1/graphql path');
  });

  it('writes nothing to stdout, even when failing', async () => {
    const { stdout } = await runCli({});

    expect(stdout).toBe('');
  });

  it('names every missing variable at once', async () => {
    const { stderr } = await runCli({ HASURA_ENDPOINT: 'http://localhost:8299' });

    expect(stderr).toContain('HASURA_ADMIN_SECRET');
    expect(stderr).not.toContain('HASURA_ENDPOINT,');
  });
});
