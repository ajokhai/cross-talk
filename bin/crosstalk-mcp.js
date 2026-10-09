#!/usr/bin/env node
import { runMcpServer } from '../dist/mcp/server.js';

runMcpServer().catch(err => {
  console.error('[crosstalk-mcp] fatal:', err);
  process.exit(1);
});
