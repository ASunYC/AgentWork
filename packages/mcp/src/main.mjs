#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentWorkServer } from './server.mjs';

const server = createAgentWorkServer();
await server.connect(new StdioServerTransport());
