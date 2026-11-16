// meet.gifos.app is a redirect to gifos.app/meet (one origin keeps each
// visitor's saved settings in one place). The shared link code only knows the
// gifos.app/meet/<room> form, so a meet.gifos.app link is rewritten to it here
// before any tool sees it. Anything else passes through untouched.
export function normalizeMeetLink(link) {
  if (typeof link !== 'string') return link;
  let u;
  try { u = new URL(link.trim()); } catch (e) { return link; }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'meet.gifos.app') return link;
  const rest = u.pathname.replace(/^\/+/, '');
  const out = new URL('https://gifos.app/meet/' + rest);
  out.search = u.search;
  out.hash = u.hash;
  return out.toString();
}

// Wrap every registered tool so its `link` argument is normalised. Tools are
// registered by gifos-mcp-core and by this package; the wrap runs after both.
export function normalizeLinksInTools(server) {
  const tools = server._registeredTools;
  if (!tools || typeof tools !== 'object') throw new Error('MCP SDK changed: cannot wrap tool handlers for meet.gifos.app links.');
  for (const t of Object.values(tools)) {
    const h = t.handler;
    if (typeof h !== 'function' || h.__meetLinks) continue;
    const w = (args, ...rest) => h((args && typeof args.link === 'string') ? { ...args, link: normalizeMeetLink(args.link) } : args, ...rest);
    w.__meetLinks = true;
    t.handler = w;
  }
}
