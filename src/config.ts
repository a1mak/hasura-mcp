/**
 * Server configuration, read from the environment.
 *
 * One Hasura instance per server process: two environments means two entries in
 * the client's MCP config, each with its own admin secret. There is deliberately
 * no `instance` parameter anywhere in the tool surface.
 */

export type ServerConfig = {
  /** Base URL of the Hasura instance — NOT the `/v1/graphql` path. */
  readonly endpoint: string;
  readonly adminSecret: string;
  /** Hasura CLI project directory, when one is configured. Enables drift tools. */
  readonly projectDir: string | null;
};

export type ConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

/**
 * The server needs `/v1/graphql`, `/v1/metadata`, `/v2/query`,
 * `/v1/graphql/explain` and `/v1/version`, so it holds the base URL and appends
 * each path itself. A trailing slash would produce `//v1/graphql`.
 */
const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const orEmpty = (value: string | undefined): string => value?.trim() ?? '';

export const readConfig = (env: NodeJS.ProcessEnv): ConfigResult => {
  const endpoint = orEmpty(env.HASURA_ENDPOINT);
  const adminSecret = orEmpty(env.HASURA_ADMIN_SECRET);
  const projectDir = orEmpty(env.HASURA_PROJECT_DIR);

  // Report every missing variable at once — one round of "and now this one too"
  // per restart is a miserable way to configure a server.
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
