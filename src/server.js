// gifos-meet-mcp: the shared tools from gifos-mcp-core plus the meeting tools.
import { createContext, createServer as composeServer } from 'gifos-mcp-core';
import { registerMeetTools } from './tools.js';
import { INSTRUCTIONS } from './briefing.js';
import { normalizeLinksInTools } from './links.js';
import { createRequire } from 'node:module';

export const NAME = 'gifos-meet-mcp';
export const VERSION = createRequire(import.meta.url)('../package.json').version;   // the banner names the build that runs
export const HTTP_PORT = 19520;
export const README = 'https://github.com/nwcnwc/gifos-meet-mcp#readme';

// Shared tools are registered before this runs, so the link wrap sees them all.
export function register(server, ctx) { registerMeetTools(server, ctx); normalizeLinksInTools(server); }

export const product = { name: NAME, version: VERSION, httpPort: HTTP_PORT, readme: README, instructions: INSTRUCTIONS, register,
  onClose: (ctx) => (ctx.archive ? ctx.archive.flushAll() : null) };

// One server over its own context (what the unit tests build). The bin
// shares one context between every server it hands out.
export function createServer(args) {
  const ctx = createContext(args);
  return composeServer({ name: NAME, version: VERSION, ctx, register, instructions: INSTRUCTIONS });
}
