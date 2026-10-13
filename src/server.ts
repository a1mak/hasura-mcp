import { McpServer } from '@modelcontextprotocol/server';

import type { ServerConfig } from './config.js';
import { createClient, type HasuraClient } from './hasura/client.js';
import { createMetadataReader, type MetadataReader } from './metadata.js';
import {
  listTablesDescription,
  listTablesInput,
  listTablesOutput,
  runListTables,
} from './tools/list-tables.js';
import {
  runServerInfo,
  serverInfoDescription,
  serverInfoInput,
  serverInfoOutput,
} from './tools/server-info.js';

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

/** Hosts auto-approve readOnlyHint tools and prompt on destructive ones, so these
 *  are a safety contract rather than documentation. Everything in v1 is read-only. */
const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

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
const registerTools = (server: McpServer, context: ToolContext): void => {
  server.registerTool(
    'server_info',
    {
      title: 'Server info',
      description: serverInfoDescription,
      inputSchema: serverInfoInput,
      outputSchema: serverInfoOutput,
      annotations: READ_ONLY,
    },
    () => runServerInfo(context),
  );

  server.registerTool(
    'list_tables',
    {
      title: 'List tables',
      description: listTablesDescription,
      inputSchema: listTablesInput,
      outputSchema: listTablesOutput,
      annotations: READ_ONLY,
    },
    (args) => runListTables(context, args),
  );
};
