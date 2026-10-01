#!/usr/bin/env node
// stdout is the protocol transport: anything written there that is not a
// protocol message corrupts the stream and drops the client. Diagnostics go to
// stderr, always.

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { describeMissing, readConfig } from './config.js';
import { createContext, createServer } from './server.js';

const result = readConfig(process.env);

if (!result.ok) {
  process.stderr.write(`${describeMissing(result.missing)}\n`);
  process.exit(1);
}

const context = createContext(result.config);

// One factory serves every era; the entry owns the transport and pins one
// instance per connection.
serveStdio(() => createServer(context), {
  onerror: (error) => process.stderr.write(`hasura-mcp: ${error.message}\n`),
});

process.stderr.write(`hasura-mcp: serving ${result.config.endpoint}\n`);
