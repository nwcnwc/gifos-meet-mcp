#!/usr/bin/env node
// gifos-meet-mcp: GifOS meetings for Grok Bot, run on your own computer.
//
//   gifos-meet-mcp                 MCP over stdio (what Grok Bot launches)
//   gifos-meet-mcp --http [port]   MCP over streamable HTTP on 127.0.0.1 (default port 19520)
import { runMain } from 'gifos-mcp-core';
import { product } from '../src/server.js';

await runMain(product);
