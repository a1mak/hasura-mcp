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
 * Runs the built artifact the way a client does. Everything else in the suite
 * tests source; only this catches a package that is broken as shipped.
 */
describe('the built CLI', () => {
  it('exits non-zero and explains itself on stderr when unconfigured', async () => {
    const { code, stderr } = await runCli({});

    expect(code).toBe(1);
    expect(stderr).toContain('HASURA_ENDPOINT');
    expect(stderr).toContain('not the /v1/graphql path');
  });

  it('writes nothing to stdout when unconfigured', async () => {
    const { stdout } = await runCli({});

    expect(stdout).toBe('');
  });

  it('writes nothing to stdout when configured', async () => {
    // stdout carries the protocol. A single stray write corrupts the stream and
    // the client drops the connection, so this holds on every path.
    const { code, stdout } = await runCli({
      HASURA_ENDPOINT: 'http://localhost:8299',
      HASURA_ADMIN_SECRET: 'fixture',
    });

    expect(code).toBe(0);
    expect(stdout).toBe('');
  });

  it('is executable directly, so npx can run it', async () => {
    const { code } = await runCli({
      HASURA_ENDPOINT: 'http://localhost:8299',
      HASURA_ADMIN_SECRET: 'fixture',
    });

    expect(code).toBe(0);
  });
});
