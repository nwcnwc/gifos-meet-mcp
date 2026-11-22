# Recipe: the Meeting Bot with no browser

**Who reads this:** whoever runs `gifos-meet-mcp` on a small server, a container or a laptop with no Chrome.

**What it does:** with `GIFOS_BOT_MODE=core` the bot joins meetings with no browser at all. Each meeting is the
meeting's own code (the GifOS core) running inside the server process, loaded from the meeting's site the way a
browser loads the meeting page, over real WebRTC data channels. It needs Node 22 or later. Chrome, Kokoro and
the speech-to-text app are not used.

**What it can do:**
- Join a meeting and leave it, with every room rule kept: proof of work, the password, slow mode.
- Read people (`get_meeting_state`) and chat.
- Read the captions that people in the room share (`get_transcript`, `tail_lines`, `wait_lines`).
- Post chat (`send_chat`) and raise its hand.

**What it cannot do yet:**
- It has no voice (`say`), camera, recording or snapshot. Those tools answer that they need the browser bot.
- It does no speech-to-text of its own: a person whose page shares no captions is not written down.
- It cannot take room actions such as host sign-in, the guard, stage grants or agenda edits.

## Setup

```sh
GIFOS_BOT_MODE=core GIFOS_BOT_NAME="Meeting notes" npx gifos-meet-mcp
```

Join and read as usual: `join_meeting` with the link, then `get_transcript` and `tail_lines`; `send_chat` to post.
`status` shows `mode: "core"` on the bot.

## Check it

`npm run test:e2e:core` runs the bot against a local GifOS site and relay with one person in Chromium (see
`test/e2e/core.js` for the variables it needs).
