// Host (admin) passwords this server made. An ADMIN room cannot exist without one: its signature goes into the room
// link and makes the room an admin room. When a user asks for an admin room and gives no password, create_meeting
// makes a strong random one and keeps it here, in <home>/host-passwords.json (mode 0600, written to a temp file then
// renamed). The bot signs in with it on start_meeting, join_meeting and sign_in_as_host. It is never returned, except
// by get_host_password, which an agent calls only when the user asks to see it.
// A host password the user GIVES is used for that call only and never kept.
import crypto from 'node:crypto';
import path from 'node:path';
import { readPrivate, writePrivate } from 'gifos-mcp-core/src/private-file.js';

// 18 random bytes: 24 characters of base64url, 144 bits.
export function strongPassword() { return crypto.randomBytes(18).toString('base64url'); }

export class HostPasswords {
  constructor(home) { this.file = path.join(home, 'host-passwords.json'); }
  all() { return readPrivate(this.file, 'host passwords start empty', (v) => !!v && typeof v === 'object' && !Array.isArray(v)) || {}; }
  get(room) { const r = room ? this.all()[room] : null; return r && typeof r.password === 'string' ? r.password : ''; }
  keep(room, password, meta = {}) {
    const all = this.all();
    all[room] = { password, kept_at: new Date().toISOString(), ...meta };
    writePrivate(this.file, JSON.stringify(all, null, 1) + '\n');
  }
}
