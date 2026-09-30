export type ServerConfig = {
  /** Base URL — NOT the `/v1/graphql` path; each path is appended by the caller. */
  readonly endpoint: string;
  readonly adminSecret: string;
  readonly projectDir: string | null;
};

export type ConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

// A trailing slash would make every appended path `//v1/graphql`.
const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const orEmpty = (value: string | undefined): string => value?.trim() ?? '';

export const readConfig = (env: NodeJS.ProcessEnv): ConfigResult => {
  const endpoint = orEmpty(env.HASURA_ENDPOINT);
  const adminSecret = orEmpty(env.HASURA_ADMIN_SECRET);
  const projectDir = orEmpty(env.HASURA_PROJECT_DIR);

  const missing = [
    ...(endpoint === '' ? ['HASURA_ENDPOINT'] : []),
    ...(adminSecret === '' ? ['HASURA_ADMIN_SECRET'] : []),
  ];

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      endpoint: stripTrailingSlash(endpoint),
      adminSecret,
      projectDir: projectDir === '' ? null : projectDir,
    },
  };
};

export const describeMissing = (missing: readonly string[]): string =>
  [
    `Missing required configuration: ${missing.join(', ')}.`,
    '',
    'Set them in your MCP client config, for example:',
    '',
    '  "hasura": {',
    '    "command": "npx",',
    '    "args": ["-y", "@a1mak/hasura-mcp"],',
    '    "env": {',
    '      "HASURA_ENDPOINT": "http://localhost:8080",',
    '      "HASURA_ADMIN_SECRET": "…"',
    '    }',
    '  }',
    '',
    'HASURA_ENDPOINT is the base URL, not the /v1/graphql path.',
  ].join('\n');
