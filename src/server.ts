import { McpServer } from '@modelcontextprotocol/server';

import type { ServerConfig } from './config.js';
import { createClient, type HasuraClient } from './hasura/client.js';
import { createMetadataReader, type MetadataReader } from './metadata.js';

export const SERVER_NAME = 'hasura-mcp';
export const SERVER_VERSION = '0.0.0';

/** What every tool handler is given. Tools take no `instance` parameter: one
 *  Hasura instance per server process, so two environments are two client-config
 *  entries, each with its own admin secret. */
export type ToolContext = {
  readonly config: ServerConfig;
  readonly client: HasuraClient;
  readonly metadata: MetadataReader;
};

export const createContext = (config: ServerConfig): ToolContext => {
  const client = createClient(config);
  return { config, client, metadata: createMetadataReader(client) };
};

export const createServer = (context: ToolContext): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  registerTools(server, context);
  return server;
};

/**
 * Every tool registers unconditionally. A tool whose prerequisite is missing
 * answers and says what is missing rather than disappearing — an absent tool
 * leaves the agent no way to learn why.
 */
const registerTools = (_server: McpServer, _context: ToolContext): void => {
  // Tools land in #5, #6 and #8.
};
