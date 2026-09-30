#!/usr/bin/env node
// stdout is the protocol transport: anything written there that is not a
// protocol message corrupts the stream and drops the client. Diagnostics go to
// stderr, always.

import { describeMissing, readConfig } from './config.js';

const result = readConfig(process.env);

if (!result.ok) {
  process.stderr.write(`${describeMissing(result.missing)}\n`);
  process.exit(1);
}

process.stderr.write(`hasura-mcp: configured for ${result.config.endpoint}\n`);
