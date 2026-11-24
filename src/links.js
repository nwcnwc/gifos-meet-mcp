// meet.gifos.app is a redirect to gifos.app/meet (one origin keeps each
// visitor's saved settings in one place). A meet.gifos.app/<room>[/<verifier>]
// link is rewritten here, before any tool sees it, to the link GifOS hands out:
// gifos.app/meet#room=<room>[&v=<verifier>], the room in the fragment so no
// server or log reads it. Anything else passes through untouched.
export function normalizeMeetLink(link) {
  if (typeof link !== 'string') return link;
  let u;
  try { u = new URL(link.trim()); } catch (e) { return link; }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'meet.gifos.app') return link;
  const m = /^\/+([A-Za-z0-9-]{1,64})(?:\/([a-fA-F0-9]{16,64}))?\/?$/.exec(u.pathname);
  const out = new URL('https://gifos.app/meet');
  out.search = u.search;
  const h = u.hash.replace(/^#/, '');
  if (m) out.hash = 'room=' + m[1] + (m[2] ? '&v=' + m[2].toLowerCase() : '') + (h ? '&' + h : '');
  else { out.pathname = '/meet/' + u.pathname.replace(/^\/+/, ''); out.hash = h; }
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
