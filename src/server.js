// gifos-meet-mcp: the shared tools from gifos-mcp-core plus the meeting tools.
import { createContext, createServer as composeServer } from 'gifos-mcp-core';
import { registerMeetTools } from './tools.js';

export const NAME = 'gifos-meet-mcp';
export const VERSION = '0.5.0';
export const HTTP_PORT = 19520;
export const README = 'https://github.com/nwcnwc/gifos-meet-mcp#readme';

export const product = { name: NAME, version: VERSION, httpPort: HTTP_PORT, readme: README, register: registerMeetTools };

// One server over its own context (what the unit tests build). The bin
// shares one context between every server it hands out.
export function createServer(args) {
  const ctx = createContext(args);
  return composeServer({ name: NAME, version: VERSION, ctx, register: registerMeetTools });
}
