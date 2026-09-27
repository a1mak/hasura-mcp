#!/usr/bin/env node
/**
 * Entry point for the stdio MCP server.
 *
 * NOTHING may be written to stdout except protocol messages — that channel is
 * the transport, and a stray `console.log` corrupts the stream and drops the
 * client's connection. All diagnostics go to stderr.
 */

import { describeMissing, readConfig } from './config.js';

const result = readConfig(process.env);

if (!result.ok) {
  process.stderr.write(`${describeMissing(result.missing)}\n`);
  process.exit(1);
}

// Tool registration and the stdio transport land in #4 and #5.
process.stderr.write(`hasura-mcp: configured for ${result.config.endpoint}\n`);
