import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

type Rpc = Record<string, unknown>;

/**
 * Speaks JSON-RPC to the built binary over a pipe, exactly as a client does.
 * Everything else in the suite exercises source; only this proves the shipped
 * artifact actually answers.
 */
const callServer = async (requests: Rpc[]): Promise<{ responses: Rpc[]; stderr: string }> => {
  const child = spawn('node', ['dist/index.js'], {
    env: {
      PATH: process.env.PATH ?? '',
      HASURA_ENDPOINT: process.env.HASURA_TEST_ENDPOINT ?? 'http://localhost:8299',
      HASURA_ADMIN_SECRET: process.env.HASURA_TEST_ADMIN_SECRET ?? 'fixture',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

  for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);

  await new Promise((resolve) => setTimeout(resolve, 1500));
  child.kill();
  await new Promise((resolve) => child.on('close', resolve));

  const responses = stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Rpc);

  return { responses, stderr };
};

const toolsList = (id: number): Rpc => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/list',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocol-version': '2026-07-28',
      'io.modelcontextprotocol/client-info': { name: 'smoke-test', version: '0' },
      'io.modelcontextprotocol/client-capabilities': {},
    },
  },
});

describe('the built server over stdio', () => {
  it('answers tools/list', async () => {
    const { responses, stderr } = await callServer([toolsList(1)]);

    expect(stderr).toContain('serving');
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ jsonrpc: '2.0', id: 1 });
  });

  it('writes only JSON-RPC to stdout — every line parses', async () => {
    // A single stray console.log would make one of these lines unparseable and
    // the client would drop the connection.
    const { responses } = await callServer([toolsList(1), toolsList(2)]);

    expect(responses.length).toBeGreaterThanOrEqual(2);
    for (const response of responses) expect(response).toHaveProperty('jsonrpc', '2.0');
  });

  it('reports the endpoint on stderr, never stdout', async () => {
    const { responses, stderr } = await callServer([toolsList(1)]);

    expect(stderr).toContain('8299');
    expect(JSON.stringify(responses)).not.toContain('8299');
  });
});
