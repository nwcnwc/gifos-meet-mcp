<p align="center"><img src="assets/logo-512.png" width="128" height="128" alt="gifos-meet-mcp logo"></p>

# gifos-meet-mcp: GifOS meetings for Grok Bot

MCP server for hosting and running bot-led video calls on **GifOS Meet**, free browser meetings at **https://meet.gifos.app** (the same as https://gifos.app/meet). Links in either form work. Ask your agent "set up meet.gifos.app for me" and point it here.

> **In short, for agents** (the [full briefing](#how-gifos-meetings-work-for-agents) is below):
> 1. **Rooms** are open (anyone with the link) or admin (a host; the admin password's signature is in the link). Asked for an admin room with no password? Leave `host_password` out: the server makes a strong one, keeps it (0600) and signs the bot in.
> 2. **Links are capabilities**: share them only with invitees. Never put a password in chat, an invite or a link unless the user asks, and keep every password (admin/host and room) in a secrets vault, never in prompts, notes or logs.
> 3. **The user's credentials GIF** (subscription or pass) unlocks their plan: hand it over by path (`use_credentials`, `guard_room`). It works in one meeting at a time.
> 4. **You are the bot's brain**: `wait_lines` to listen, then `send_chat` or `say` to answer.
> 5. **Something failed?** See the [failure table](#failure-modes).

**What people say, and what to do.** Map requests by meaning, in any language ("una llamada", "ein Meeting", "uma
reunião" are all "a call"); answer in the user's language. Don't ask what these defaults answer. "Room password" =
who may enter; "admin password" = the host's, kept private by the server.

| The user says | Do this |
|---|---|
| "a call", "a meeting", "set up a zoom / hangout / video chat / conference", "a quick call", "a test call" | `create_meeting` `{name, type: "admin"}` with no `host_password` (a free admin room; the server makes the admin password). Name: the user's, or a short one ("Test call"). Then `start_meeting` if they want it now. |
| "with a password", "a private call", "a call nobody else can get into" | Also `room_password`: the user's, or a readable one you make (three words: `maple-river-lamp`). It goes in the join info. |
| "send me info to join", "send me the link" | The join link + the room password (if any) + one line: "Open the link in a browser, type the password when asked." Or the `invite.text` from `create_meeting`. Never the admin password. |
| "a meeting for my team at 3pm tomorrow" | `create_meeting` with `start` (e.g. `2026-11-16T15:00`) and `timezone` (the user's if known, else this computer's local zone, e.g. from `date +%Z`), then `schedule_meeting` `{link, room_password, start}` so the bot joins on time. Send `invite.text`; this server sends nothing itself. |
| "a recurring weekly standup" | As above, plus `recurrence` on `schedule_meeting` (`FREQ=WEEKLY;BYDAY=MO`). |
| "make it public", "anyone can join" | An open room: `create_meeting` `{name}` (no `type`). Anyone with the link joins; no door limit. |
| "a big call", "a webinar", "30 people" | An open room (no limit), or an admin room with the user's $5/$10 plan (`use_credentials`). A free admin room lets in 5 people, $2 lets in 20. Say so. |
| "it says the room is full" | A free admin room is at 5 (or $2 at 20). Use an open room, or the user's $5/$10 plan (`use_credentials`, then rejoin). |
| "lock it", "change the password" | Set the room password with `guard_room` `{link, mode: "admin", password: "<new>"}` (a room this server made needs no `host_password`), then send the new password to the people who should have it. Open rooms: anyone inside may set one unless someone holds the room. |
| "kick someone out", "remove X" | No remove tool here, and GifOS keeps no ban list. In an admin room the host taps Remove on that person's tile: the room password changes and everyone else gets the new one. Tell the user how, or lock the room for newcomers (row above). |
| "who's in the call?" | `get_meeting_state` `{meeting_id}`. |
| "take notes", "transcribe", "what did they say?", "summarize the meeting" | The bot transcribes from the moment it joins. `get_transcript` (or `wait_lines` while live), then you write the summary. |
| "record it" | Recording is on by default (`GIFOS_ALWAYS_RECORD=1`; everyone sees ⏺ recording); else `start_recording`. `get_recording` saves the file. Mention the indicator. |
| "send me the notes" | Put them in your reply, or send them with the user's own mail connector; this server sends nothing. |
| "join my meeting at <link>" | `join_meeting` `{link, password}` (ask for the room password only if the door asks). |
| "join and say hi", "introduce yourself", "answer questions" | `join_meeting`, then `send_chat` / `say` with your words. To answer: `wait_lines` and reply, or `talk: true` with `wait_for_speech`. Open-room chat: one line per 10 s. |
| "be quiet", "stop listening", "leave" | Quiet: just don't `say` (talk is off unless you turned it on). Stop listening: `mute`. Leave: `leave_meeting`. |
| "end the meeting", "close the room" | `end_meeting` takes the bot out; others stay. An admin room closes 5 minutes after the last host leaves; an open room lasts while anyone is in it. |
| "use my subscription", "here's my GifOS file", "I have a pass" | `use_credentials` `{path}` (or `gif_b64`). Never paste the file's bytes into chat. One meeting at a time. |
| "why can't they see video?" | With no room password, everyone stays blurred: set one. On a network that blocks direct links, the free plan carries sound but not video over TURN; a paid plan carries video. |
| "make me the host", "give me admin" | `get_host_password` `{meeting_id}` (only now, since they asked); they open the link and use Admin > Sign in. For someone else's room, it's that room's admin password. |
| "share my screen" | A person's own action: the Share screen button (Alt+S) in their meeting. In an admin room the host may first need to allow guests to share. The bot cannot share a screen for them. |

## How GifOS meetings work, for agents

Read this before calling any tool. The tool descriptions and the server's MCP instructions say the same, shorter.

**Rooms.** A GifOS meeting is a room, reached by its link. There are two kinds:

- An **open room**: anyone with the link joins. It has no host and no door limit. Anyone inside may set its room
  password while nobody holds it. A subscriber on the $5 or $10 plan, or a staff pass, can *capture* it ("Make me
  admin"); from then on only the captor sets its password, until the captor's ticket stops renewing.
- An **admin room**: a room with a host. What makes it one is the **admin (host) password**: its signature goes into
  the link (`/meet/<room>/<verifier>`). There is no admin room without one. Only the host sets the room password,
  lets people on the stage, runs the agenda and blurs guests. The door lets in 5 people on the free plan, 20 on $2,
  no limit on $5 and $10. The room closes 5 minutes after the last host leaves.
  - The user gave an admin password: pass it as `host_password`. It is used for that call only, never kept.
  - The user gave none: **do not invent one and do not ask.** Leave `host_password` out. The server makes a strong
    random one, keeps it in `<GIFOS_MCP_HOME>/host-passwords.json` (mode 0600) and signs the bot in with it. Tell the
    user it was made and where it is kept. Show it only if the user asks (`get_host_password`).
- The **room password** is a different thing: it decides who may ENTER, in either kind of room. Guests type it. It
  goes in the invite text, never in the link. With no room password, GifOS shows nobody clear video (everyone is
  blurred); a room password is what makes clear video possible.

**Links.** A meeting link is a capability: anyone holding it can join. Share it only with the people the user
invites, through the user's own mail or calendar (this server sends nothing). An admin room's link carries only
the verifier, never the admin password. Never put any password (admin, room, the bot's own) in chat, an invite or
a link unless the user asks for that.

**Passwords are secrets** (the admin/host password and every room password): the moment you have one, keep it in a
secrets vault or other safe storage, never in chat, memory, notes, files, shell commands or logs, and read it from
there only into the one tool argument that needs it. This server masks every host password it holds as `[redacted]`
in what it returns and logs.

**Credentials.**

- The **bot's own** name and password (`GIFOS_BOT_NAME`, `GIFOS_BOT_PASSWORD`, else a stored pair in `bot.json`)
  are its identity: whoever has the pair can command the bot. Never show them.
- The **user's credentials GIF** is a GifOS subscription file (Settings > Subscription) or a pass. It is the plan
  itself: bigger admin rooms, video over TURN on networks that block direct links, and open-room capture on $5, $10
  or a staff pass. Hand it over by path or base64 with `use_credentials` (any meeting), `credentials` on
  `guard_room`, or `GIFOS_CREDENTIALS` at start. It is read once, put only into the bot's own browser, and never
  logged or returned. Never paste its bytes in chat or ask the user to. A plan works in **one meeting at a time**:
  joining a second meeting moves it there, and the first loses it within minutes.

**The bot's role.** The bot joins as a tile labelled 🤖 bot, transcribes, and says or writes only what you give it
(`say`, `send_chat`). You are its brain: follow the room with `wait_lines` (blocks until a new line) or
`tail_lines`, and answer with `send_chat` (text) or `say` (spoken). With `talk: true` the bot itself answers lines
addressed to it, and `wait_for_speech` hands you each one; with talk off it never answers on its own.
Etiquette: an open room's chat allows one line per 10 seconds per person, so batch replies; keep lines short; do
not speak over people. Consent: every participant always sees 📝 Transcribing, and ⏺ recording on the bot while it
records (`GIFOS_ALWAYS_RECORD=1` by default). Tell the user before recording people who did not expect it; `mute`
stops note-taking and `end_meeting` takes the bot out.

**Holding a room (guard).** `guard_room` keeps the bot in a room as its admin: an open room by capture with a
credentials GIF that may capture, an admin room by its host password. It keeps the room password as set (none by
default), blurs guests and greets newcomers. Copies of one guard on several computers (siblings: the same
credentials or host password, a different `rank`, each with its own name) are all admins at once; one leads (greets,
answers), and if it dies the next leads with no gap in the hold; a restarted copy comes back as an admin. Siblings
know each other by that shared key, never by name. Removing
someone means setting a room password: everyone inside keeps it, the removed person does not get it. GifOS keeps
no ban list (a person can change browsers), so a room kept with no password removes nobody.

**Privacy and cost.** Sound and video go peer to peer between participants; the GifOS relay only introduces them
and carries no content. Transcripts, recordings and this server's files stay on this computer. TURN (a paid relay
for media) is used only when a network blocks direct links: free plans get everything but video over it. Do not
join rooms, poll or repeat calls without need: every join and capture touches GifOS servers.

<a id="failure-modes"></a>**Failure modes.**

| The tool says | What it means | Do this |
|---|---|---|
| `keeps no host password` | No admin password was given or kept for that room. | For a new room, leave `host_password` out (the server makes one). For someone else's room, ask the user for its admin password. |
| The door asks for a password / `locked-out` | The room has a room password. | Ask the user for it; pass it as `password` (join) or `room_password` (start). |
| `The meeting bot is at capacity.` | `GIFOS_MAX_MEETINGS` rooms are already seated. | End a meeting first, or schedule the join. |
| `A bot with this name and password is already running…` | Another copy uses the same bot identity. | Give this server its own `GIFOS_MCP_HOME` or bot name (guard siblings may each have their own), or set `GIFOS_BOT_SIBLING=1` if the copies share one name on purpose. |
| `This GifOS site does not have that yet` | The site is older than 0.9.26. | Use gifos.app or a 0.9.26 site. |
| `The room crashed the bot; … again in N min.` | Joining that room took the bot's browser down. | Wait the minutes it names; tell the user. |
| `warning` in `get_meeting_state`, nobody hears the bot | This network blocks direct links. | TURN carries it when the site offers it; with no plan, sound only. |
| `in use in another meeting` / guard role `held-by-other` | The credentials' plan moved to another meeting, or someone else holds the open room. | Use one meeting per plan; the guard takes the room back when the other hold lapses. |
| `That is not a GIF` / `not a GifOS subscription` | The credentials file is wrong. | Ask the user to export it again from Settings > Subscription. |

## Recipes for agents

Exact tool calls. Ids and links come from the previous answer.

**A free admin room named "test" with room password "test password"** (no admin password given):

```json
{ "tool": "create_meeting", "arguments": { "name": "test", "type": "admin", "room_password": "test password" } }
```

The answer has `link`, `invite` (send its `text` yourself) and `host_password: { "made": true, "kept_in": "…/host-passwords.json" }`.
Tell the user: "I made a strong admin password for the room and kept it in `<kept_in>`; ask me if you want to see it."
To put the bot in the room as its host:

```json
{ "tool": "start_meeting", "arguments": { "meeting_id": "<meeting_id>", "room_password": "test password" } }
```

The answer says `bot_is_host: true`. A free admin room lets in 5 people; a $2 plan 20; $5 and $10 no limit.

**Hold an open room with a credentials GIF** (a $5/$10 subscription file or a staff pass, on this computer):

```json
{ "tool": "guard_room", "arguments": { "link": "https://gifos.app/meet/<room>", "credentials": "/path/to/credentials.gif" } }
```

The bot joins, takes the room ("Make me admin"), keeps it with no password and greets newcomers. `guard_status` shows
its role (`lead`, `coadmin`, `taking`, `held-by-other`); `stop_guard` stops it.

**Use your pass or subscription in any meeting** (the bot joins with your plan: a paid room plan, TURN on blocked
networks):

```json
{ "tool": "use_credentials", "arguments": { "path": "/path/to/credentials.gif" } }
```

or `{ "gif_b64": "<the file, base64>" }` when the file is not on this computer. Then join as usual.

**Join someone else's meeting:**

```json
{ "tool": "join_meeting", "arguments": { "link": "https://gifos.app/meet/<room>", "password": "<room password, if any>" } }
```

If they want the bot to run the room as host, add `"host_password": "<their admin password>"` (used once, never kept).
Then `wait_lines` / `get_transcript` to follow it, `send_chat` or `say` to speak, `leave_meeting` to go.

## How it works

```
Grok Bot ──MCP (stdio)──▶ gifos-meet-mcp ──▶ headless Chromium (one profile in ~/.gifos-mcp)
   (the brain)                                └─ GifOS desktop
                                                   ├─ Meeting Bot (window.MeetingBot v2): joins, captions, speaks
                                                   └─ Offline Captions (Whisper): speech to text
```

- **Grok Bot is the brain.** The server has no language model. On every join Meet Bot is handed
  `respond_to_command` and `speak`, both off (and never the old `conversation_voice`, `llm`, `tts`, or `stt`
  fields). Turning the microphone on and transcribing does not make the bot answer. talk:true does: it turns
  those two switches on so the bot answers a line addressed to it, and it hands you that line.
  `wait_for_speech` blocks until one arrives, and a talk notification carries the same line. You can still
  `say` a line of your own. With talk left off, the bot does not answer.
- **Scheduling without joining.** `create_meeting` mints a link and returns every invite detail (title, start
  and end with time zone, join link, description, how guests get in, who does what, ready-to-send text).
  Nothing joins and nothing is sent: Grok Bot sends the invite through the user's own mail or calendar.
- **Fast replies.** `wait_lines` returns the moment someone says something (captions are copied every 300 ms),
  with `to_bot: true` on lines addressed to the bot. `say` speaks a line at once.
- **Speech** is [Kokoro](https://github.com/hexgrad/kokoro) (kokoro-js 1.2.1), running in this process with its
  default voice `af_heart`; `say` takes an optional `voice` for one line. **Speech to text** is GifOS Whisper
  in the headless browser. The bot writes down each participant who is unmuted, credited by name, and never its
  own machine's microphone.

## Quick start

You need **Node.js 20 or newer**, **git**, and **Google Chrome or Microsoft Edge** (see *The browser* below).
This is the exact command the plugin's `.mcp.json` runs (stdio):

```sh
npm_config_ignore_scripts=true ONNXRUNTIME_NODE_INSTALL_CUDA=skip \
  npx -y npm@11.6.2 exec -y -- github:nwcnwc/gifos-meet-mcp#b12df86e709226609ac519ee26406e46e9c09004
```

It speaks MCP over stdio, so on its own it waits for a client. `npm@11.6.2 exec` is there because the npm in
Node 22 (10.9) fails on any `npx github:` package; with npm 11 or newer, `npx -y github:nwcnwc/gifos-meet-mcp`
(the newest commit) works directly. The first run downloads about 700 MB of packages (Kokoro and ONNX Runtime).

or from a clone:

```sh
git clone https://github.com/nwcnwc/gifos-meet-mcp.git && cd gifos-meet-mcp
npm install --ignore-scripts
node bin/gifos-meet-mcp.js            # stdio
node bin/gifos-meet-mcp.js --http     # or streamable HTTP on http://127.0.0.1:19520/mcp
```

**Install scripts are not needed and should be off.** This package and gifos-mcp-core have none. Three
dependencies of kokoro-js do: `onnxruntime-node` would download CUDA libraries from GitHub on Linux x64,
`sharp` checks for a system libvips, `protobufjs` checks its version. The CPU build of ONNX Runtime and sharp's
prebuilt binary ship inside the packages, so `--ignore-scripts` loses nothing. The plugin's `.mcp.json` sets
`npm_config_ignore_scripts=true` and `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`.

**The browser.** The server drives the browser already on your computer: `GIFOS_CHROME` if set, else Google
Chrome, else Microsoft Edge, else a Chromium that `npx playwright install chromium` installed earlier. It never
downloads or installs a browser. With none of these it stops and says what to install.

## Grok Bot setup

As a plugin, this repository has `.grok-plugin/plugin.json`, `.mcp.json` and `skills/gifos-meet/SKILL.md`.
By hand, add a local (stdio) MCP server:

```json
{
  "mcpServers": {
    "gifos-meet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "npm@11.6.2", "exec", "-y", "--", "github:nwcnwc/gifos-meet-mcp#b12df86e709226609ac519ee26406e46e9c09004"],
      "env": { "npm_config_ignore_scripts": "true", "ONNXRUNTIME_NODE_INSTALL_CUDA": "skip", "GIFOS_URL": "https://gifos.app" }
    }
  }
}
```

That pin is the same commit as `.mcp.json` (the code commit just before the commit that pins it). It runs through npm 11 (`npm@11.6.2 exec`) because the npm that ships with Node 22 (10.9) cannot run a package straight from GitHub with `npx` ("GitFetcher requires an Arborist constructor").

The server warms up as soon as Grok Bot starts it (about 10 seconds, plus first-run downloads), so the first
join does not wait. **It must be running at meeting time** for a scheduled join: run it on an always-on machine.

`--http [port]` listens on `127.0.0.1` only, checks the `Host` header, and requires `Authorization: Bearer
<token>` when `GIFOS_MCP_HTTP_TOKEN` is set.

## Endpoints, downloads and credentials

| What | Where | When | Size |
|---|---|---|---|
| GifOS site | `GIFOS_URL`, default `https://gifos.app` | every start | — |
| GifOS relay | GifOS's default relay, or `GIFOS_RELAY` | while in a meeting (it only introduces peers) | — |
| Meeting Bot and Offline Captions apps | the GifOS store on `GIFOS_URL` (signed) | first start | small |
| Whisper model | through the Offline Captions app | first transcription | about 77 MB |
| Kokoro weights | `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX` at revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, or the mirror in `GIFOS_KOKORO_URL` | first start, kept in `GIFOS_MCP_HOME/kokoro` | about 92 MB; each file is checked against its pinned SHA-256 |
| npm packages | the npm registry and GitHub (gifos-mcp-core) | install | — |

**Credentials.** The only secret this server holds is the bot's own name and password, which open Meeting
Bot's admin meeting. They are generated once into `GIFOS_MCP_HOME/bot.json` (mode 0600), or come from
`GIFOS_BOT_NAME`/`GIFOS_BOT_PASSWORD`. A host password passed to `create_meeting` is used for that call only;
a room password passed to `schedule_meeting` or `join_meeting` is stored in `schedule.json` (mode 0600) so a
restart can rejoin, and is never returned. The server reads no other secret, sends no telemetry, and never
sends email or calendar invites.

**How the bot looks.** The operator chooses the bot's name and picture: `GIFOS_BOT_NAME` and
`GIFOS_BOT_PICTURE` in the server's `env`, or the `set_bot_profile` tool, which Grok Bot can call. The picture is
read from a file on this computer and kept in `GIFOS_MCP_HOME/bot-picture.json` (mode 0600); it is sent to rooms
like any person's picture and nowhere else.

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `GIFOS_URL` | `https://gifos.app` | The GifOS site (0.9.25 or newer; 0.9.26 for the agenda, app and stage tools). |
| `GIFOS_RELAY` | GifOS default | A custom relay (`wss://…`), added to meeting links. |
| `GIFOS_BOT_NAME` | generated | The name people see on the bot's tile (3 to 40 characters). Set alone, it keeps the stored password. |
| `GIFOS_BOT_PASSWORD` | generated | The bot's password (the secret half). A `bot.json` that cannot be read is kept as `bot.json.bad-<ms>` and a new pair is generated. |
| `GIFOS_BOT_PICTURE` | none | Path to the bot's picture: a GIF, PNG, JPEG or WebP file, at most 256 KB. Rooms show it on the bot's tile like anyone's picture. |
| `GIFOS_STT_APP` | `offline-stt-whisper` | The store app for speech to text. `none` turns transcription off. |
| `GIFOS_MCP_HOME` | `~/.gifos-mcp` | Browser profile, bot credential, `meetings.json`, `schedule.json`, `host-passwords.json`, transcripts, events. |
| `GIFOS_CREDENTIALS` | none | Path of a GifOS credentials GIF (a subscription file or a pass). Read once at start; the bot joins every meeting with that plan (as `use_credentials`). Keep it `chmod 600`. |
| `GIFOS_GUARD_CONFIG` | none | A guard config: rooms the bot holds as their admin from the start ([Guard a room](#guard-a-room-a-welcome-bot-for-an-open-room)). |
| `GIFOS_BOT_SIBLING` | `0` | `1` lets Meeting Bot start beside a running copy with the same bot name and password (guard siblings with their own names do not need it). |
| `GIFOS_HEADLESS` | `1` | `0` shows the browser windows. |
| `GIFOS_CHROME` | Chrome, then Edge | A Chrome or Chromium binary to use instead. |
| `GIFOS_TIMEOUT_MS` | `120000` | How long to wait for GifOS steps such as joining. |
| `GIFOS_MCP_HTTP_TOKEN` | none | Bearer token for `--http`. |
| `GIFOS_MCP_LAZY` | `0` | `1` starts the browser on the first tool call. |
| `GIFOS_ALWAYS_RECORD` | `1` | Every meeting the bot starts or joins is recorded. `0` records only on `start_recording`. Everyone in the room sees ⏺ recording on the bot. |
| `GIFOS_ALWAYS_TRANSCRIBE` | `1` | Every join turns captions on. `0` joins muted (`unmute` turns them on). |
| `GIFOS_RECORD_SEGMENT_MIN` | `15` | Long meetings: the recording is saved to disk as a new segment file every this many minutes. |
| `GIFOS_MCP_DEBUG` | `0` | `1` logs the GifOS console to stderr and adds caption state to `status`. |
| `GIFOS_MCP_SHOTS` | none | A folder for screenshots of the bot's screens. |
| `GIFOS_TRANSCRIPT_POLL_MS` | `300` | How often captions are copied from Meet Bot into the lines. |
| `GIFOS_TTS_ENGINE` | `kokoro` | `kokoro` (in this process) or `none`. |
| `GIFOS_TTS_VOICE` | `af_heart` | Kokoro's default voice for every line. |
| `GIFOS_TTS_APP` | empty | A GifOS store speech app instead of Kokoro in this process. |
| `GIFOS_KOKORO_URL` | `https://huggingface.co` | A mirror with the Hugging Face layout for the Kokoro weights. The pinned revision and hashes still apply. |
| `GIFOS_TTS_URL`, `GIFOS_STT_URL` | empty | HTTP stand-ins for speech and captions (testing). This process calls them; the page does not. |
| `GIFOS_MAX_MEETINGS` | `4` | Seated meetings at once. A join over the cap is refused; a scheduled join waits. |
| `GIFOS_WORKERS` | `1` | Stage B. More than 1 makes this process a supervisor and runs each Meet Bot in its own child process and Chromium. Worker 0 keeps the bot name and `profile-bot`. Worker n is its own bot, named `<name>-wn`, with `profile-bot-wn`. Lines that bot speaks in its room are stored as the bot's `spoken` lines under that name, not as speech from a person. A meeting stays on the worker that joined it. If a worker stops, its meetings go back to `scheduled` and the clock rejoins any order still in its window. A meeting with no order (`join_meeting` with no password, or `start_meeting`) is rejoined on the next clock tick too, unless `end_meeting` is called on it first. A room is joined once at a time: a clock tick and a `start_meeting` for the same room share one join, and `end_meeting` during that join leaves the seat as soon as it lands; if that leave fails, the meeting is `live` again on that seat with `transcribing: false` and raises one `meeting.error` ("The bot could not leave the room; call end_meeting again."), so a second `end_meeting` reaches it. A join that lands but whose transcription will not start leaves that room again and fails (the clock tries again on its next tick), so the bot is never seated twice in one room; if that leave fails too, the meeting stays `live` with `transcribing: false` and raises one `meeting.error`, and `unmute` or `end_meeting` reaches that seat. A worker that stops answering a heartbeat for 30s is killed and handled the same way, and so is one that has not finished booting (for example a stalled first download of the Kokoro weights, which the restart resumes) within 5 × `GIFOS_TIMEOUT_MS`; the join waiting on it goes to the next worker. A worker that keeps dying waits 1s, 2s, 4s, up to a minute before each restart, and joins (and the browser warm-up) go to another worker meanwhile; `status` shows `restart_in_ms` on that worker. A worker that is running but whose browser will not start is treated the same way: the join that found it out goes to the next worker, joins skip it for 1s, 2s, 4s, up to a minute before it is tried again, and `status` shows `start_retry_in_ms` and the start error on its row. A worker process that dies during a join (its browser goes with it) does not fail that join: it goes to the next worker with a free seat, once, so a room that takes down every worker it reaches costs at most two workers a restart. The clock does not join such a room again at once: it raises one `meeting.error` ("The room crashed the bot; trying again in N min.", with `retry_in_ms`) and waits 1 minute, then 2, 4, up to 30 between tries while the order is in its window, so the meetings it knocked off get their seats back and keep them. A `start_meeting` or `join_meeting` by hand waits on the same clock: on a room in its wait it fails at once ("The room crashed the bot; it can be tried again in N min.") without walking in, and a hand join that takes down every worker it reaches starts that wait too. The wait is kept in `crashes.json` under `GIFOS_MCP_HOME` (mode 0600), so a supervisor restarted within it still waits; an unreadable `crashes.json` is moved aside like `schedule.json`. While no worker has a free seat, an order due to join waits: it goes to `waiting_for_capacity` and raises one `schedule.waiting` event with `reason: "worker"` (`"capacity"` when the cap is reached), not an error every clock tick; if no seat frees before its end it is `missed` for capacity. A call to a worker that is still alive fails after 60s with no answer (a browser start or a join after 5 × `GIFOS_TIMEOUT_MS`); a join that ran out of time keeps its seat until the worker answers it (the bot may still be walking into the room; `status` shows `late_joins` on that row), so the worker is not given more rooms than its budget; one that lands after that is left at once, so no seat is held that nobody can reach, and one that fails frees the seat. A join that still has not answered one more join window later is checked against the worker's own Meet Bot room list: a room the supervisor does not hold is left (as above), and the seat is freed, so a join that never answers does not hold a seat until the worker dies. If the leave of a join that landed late fails, the room keeps its seat and is left again every 10s until it works; `status` shows `stray_rooms` on that worker's row meanwhile. A `leave_meeting` or `end_meeting` whose leave fails or runs out of time keeps the meeting `live` on its worker (the bot may still be in the room), so calling it again reaches the room; a late leave that lands, or Meet Bot answering that it no longer holds the room, frees the seat. A leave that still has not answered one more call window later is checked against the worker's Meet Bot room list: if the room is gone, the seat is freed; if the bot is still listed there, the seat stays taken. After a late leave landed or that check freed the seat, the next `leave_meeting` or `end_meeting` on that meeting ends it. `status` asks every worker at once and waits at most 3s for each; a worker that does not answer in time shows `error` on its row while the rest of `status` comes back. If the supervisor itself dies without shutting down (SIGKILL, out of memory), each worker sees its channel close, closes its Chromium, and exits, so no bot is left in a room that nothing can reach; a worker still booting (for example fetching the Kokoro weights) exits at once too, and so does one told to close while booting, keeping its part file for the next start. Each worker runs with a `TMPDIR` of its own, `gifos-mcp-<tag>-w<n>` under the supervisor's (the tag is named by `GIFOS_MCP_HOME`), emptied before each start and removed when the worker exits or `close` ends it, so the `playwright-artifacts-*` folder a worker killed under its Chromium could not remove does not pile up in `/tmp`; a worker leaving because its supervisor died removes its own. `set_voice` goes to every running worker at once; a worker that refuses it, misses it, or restarts gets the same settings again before its next join, and a running worker that refused is asked again every 10s until it takes them; meanwhile `status` shows `voice: "pending"` on its row. |
| `GIFOS_WORKER_ROOMS` | cap / workers, rounded up | Rooms per worker. |

## Tools

Meeting tools (this server):

| Tool | Arguments | Returns |
|---|---|---|
| `create_meeting` | `name`, `type?` (`open` or `admin`), `host_password?`, `start?`, `end?`, `timezone?`, `description?`, `room_password?`, `host_name?` | `{ meeting_id, link, host_runs_room, invite, host_password? }`. Nothing joins, nothing is sent. `invite` has `title`, `start`/`end` (`{iso, timezone, local}`), `join_url`, `description`, `admit`, `roles`, `text`, `calendar`. `type: admin` makes a room with a host: with the user's `host_password` (`admin_password` is the older name), used for this call only and never stored or returned; with none, the server makes a strong one, keeps it in `host-passwords.json` (0600) and answers `host_password: { made, kept_in }` without it (see [the briefing](#how-gifos-meetings-work-for-agents)). The room password is in the invite text, never in the link. GifOS 0.9.26 has no town hall. |
| `get_host_password` | `meeting_id` | The host password the server made for that admin room. Only when the user asks to see it. |
| `use_credentials` | `path` or `gif_b64` | The bot joins every meeting with the user's credentials GIF (subscription or pass). Read once, kept in memory, put only into the bot's browser; never logged or returned. |
| `start_meeting` | `meeting_id`, `room_password?`, `host_password?`, `talk?`, `language?` | The bot joins now and starts transcribing; in an admin room it signs in as host (with the given password, or the one the server made). `language` is what people speak: `auto` (default; Whisper detects it) or a code such as `ru`, `es` or `pt-BR`. One bot browser holds one setting, so rooms joined at the same time share the latest; `GIFOS_CC_LANG` sets the default. Turning the microphone on and transcribing does not make the bot answer. talk:true does. |
| `join_meeting` | `link`, `password?`, `topic?`, `instructions?`, `talk?`, `language?` (as on `start_meeting`) | The bot joins someone else's GifOS meeting now. `instructions` (optional, plain text, at most 4000 characters) is the owner's goal for this meeting, returned by `meeting_status`; without it the bot only transcribes. Turning the microphone on and transcribing does not make the bot answer. talk:true does: the bot answers lines addressed to it, and `wait_for_speech` returns each of those lines. With talk left off, the bot does not answer. |
| `wait_for_speech` | `meeting_id`, `timeout_ms?` | Blocks until a line addressed to the bot arrives in a meeting joined with `talk:true`. Turning the microphone on and transcribing does not make the bot answer. talk:true does. |
| `raise_hand`, `set_mic`, `set_camera` | `meeting_id`, `on` | Meet Bot's hand, microphone and camera, or the gap when the app lacks the method. `set_mic` does not make the bot answer. |
| `start_recording`, `stop_recording` | `meeting_id` | Meeting Bot records the room. Everyone sees ⏺ recording on the bot while it is on. |
| `get_recording` | `meeting_id` | Stops recording if on, saves the file under `<home>/recordings/`, returns `path`, `name`, `mime`, `size`. |
| `list_past_meetings`, `get_past_meeting` | `limit` / `meeting_id`, `include_transcript` | The meeting archive on disk: folders, recording segment paths, transcripts. |

GifOS 0.9.26 meeting tools (from gifos-mcp-core). Each acts as the bot's own seat with that seat's rights; in a
room with a host, the host-only ones need `sign_in_as_host` first:

| Tool | Arguments | Returns |
|---|---|---|
| `sign_in_as_host` | `meeting_id`, `host_password?` | Signs the bot in as the host (Admin > Sign in). A given password is used once, never stored or returned; omitted, the one the server made for that room. The bot's browser forgets the room's host key when it leaves. |
| `set_agenda` | `meeting_id`, `items` (`[{title, minutes?}]`, up to 40), `append?` | Shares the agenda in the meeting's Agenda tab, with timekeeping. Refused if one exists unless `append`. |
| `next_agenda_item` | `meeting_id` | Moves the agenda on (the first call starts item 1) and restarts its clock. |
| `get_agenda` | `meeting_id` | The items, `current_item`, `time_left` (`m:ss`, or `+m:ss` when over). |
| `list_apps`, `run_app`, `stop_app` | `meeting_id`, `app` | Apps the bot can run in the meeting for everyone; run one by name or app id; stop the one it started. |
| `take_turns` | `meeting_id`, `action` (`start`, `state`, `next`, `back`, `pass`, `restart`, `shuffle`, `timer`), `seconds?` | Runs and drives Take Turns: who is up now and next, the time left, the order. Take Turns asks the person whose turn it is onto the stage on their own page; it never turns a camera or microphone on. |
| `stage` | `meeting_id`, `action` (`state`, `step_on`, `step_off`, `allow`, `disallow`), `person_id?` | Who is on the stage; step the bot on or off; as host, allow or disallow a person (ids from `get_meeting_state`). |

Shared tools (from gifos-mcp-core, the same in gifos-broadcast-mcp):

| Tool | Arguments | Returns |
|---|---|---|
| `wait_lines` | `meeting_id?`, `since?`, `timeout_ms?` (≤ 30000), `kinds?` | Returns as soon as there is a line after `since`, or after `timeout_ms`. Pass `next` back as `since`. Lines addressed to the bot have `to_bot: true`. |
| `tail_lines`, `tail_transcript` | `meeting_id?`, `since?`, `kinds?` | The lines after `since` without waiting. Each line is `{seq, ts, speaker, text, kind}`; `kind` is `speech`, `chat` or `spoken`. |
| `get_transcript` | `meeting_id` | Plain text, one `speaker: words` line per caption, live and after the meeting. |
| `say` | `meeting_id`, `text`, `voice?` | Meet Bot says the line out loud now (Kokoro). |
| `set_bot_profile` | `name?`, `picture_path?`, `clear_picture?` | Sets how the bot looks: the name on its tile and its picture (GIF, PNG, JPEG or WebP, at most 256 KB). Both are kept in `GIFOS_MCP_HOME` for later starts. The picture applies to rooms joined afterwards. A new name is refused while the bot is in a room (end it first). `GIFOS_BOT_NAME` and `GIFOS_BOT_PICTURE`, when set, win again at the next start. |
| `send_chat`, `share_content` | `meeting_id`, `text` | A chat line as the bot (up to 2000 characters). |
| `get_meeting_state`, `snapshot` | `meeting_id` | Who is here; a PNG of the bot's page. |
| `mute`, `unmute` | `meeting_id` | Stop or restart note-taking. |
| `leave_meeting`, `end_meeting` | `meeting_id` | Saves the transcript, then the bot leaves. Other people stay. |
| `schedule_meeting` | `link`, `room_password`, `start`, `end?` | Stores the join order, including the room password, in `schedule.json` (mode 0600, written to a temp file then renamed, so a save cut short keeps the last good file; a file that cannot be read at start is kept as `schedule.json.bad-<ms>` and not overwritten). The bot joins one minute before `start`. A join that fails (not a crash, not a full pool) is tried again on every clock tick while the window is open, and raises one `meeting.error` ("The room could not be entered; trying again.") and one `schedule.due` for that order, not one per tick; after a join works, the next failure raises one again. Those events, and `schedule.waiting`, are once per window: an order moved to a new `start` or `end` (an order waiting for capacity goes back to `upcoming`) raises them again in its new window. `end` defaults to `start` plus 8 hours. The password is not returned. |
| `list_schedule`, `update_schedule`, `cancel_schedule`, `import_schedule` | see the schemas | Join orders. No passwords in results. `schedule_meeting`, `update_schedule` and `import_schedule` take an optional `instructions` (the owner's goal and questions for that meeting, at most 4000 characters, kept in `schedule.json`); it comes back in `list_schedule`, `meeting_status` and the `schedule.due` and `meeting.joined` events. The server never runs it. Recipe: [daily check-ins run by the bot](docs/recipes/daily-checkins.md). |
| `list_meetings`, `meeting_status`, `meetings_report`, `status`, `capacity_status` | — | State, people, line counts, capacity. No passwords. |
| `tail_events` | `since?` | Connector events, including `capacity.near`, `capacity.reached`, and `capacity.cleared`. They are appended to `GIFOS_MCP_HOME/events.jsonl` (mode 0600); a torn last line left by a process killed mid-write is skipped and ended at the next start, so later events stay readable and no `seq` is handed out twice. |

The resource `gifos://meeting/{id}/transcript` is the live transcript as newline-delimited JSON; subscribe for
`notifications/resources/updated`.

## Guard a room (a welcome bot for an open room)

The bot can hold a GifOS room as its **admin**, so nobody else can take the room or change its password, and keep
the room the way you set it. It needs GifOS 0.9.26 or newer.

- **An open room** (anyone with the link joins) is held by *capture*: the bot loads a GifOS **credentials file** (the
  subscription GIF from Settings > Subscription, on the $5 or $10 plan, or a staff pass) and takes the room with the
  page's own "Make me admin". From then on only the bot can set the room's password.
- **A room with a host** (`mode: "admin"`) is held by signing in with its `host_password`.

The policy:

| field | default | what the bot does |
|---|---|---|
| `password` | `null` | `null`: the room has no password, and any password set is cleared at once (with no password GifOS shows no clear video to anyone). A value: the bot sets it and puts it back if it changes. |
| `blur_all` | `true` | Presses Blur guests when the page offers it to the bot. |
| `greet` | `true` | The welcome the lead bot posts in chat for newcomers (batched: an open room's chat allows one line per 10 s). `true`: a short neutral default (it adds "Clear video is disabled." only when `blur_all` is on). `false`: no welcome. A string: your own text; it must contain `{names}`, which becomes the newcomers' names. |
| `rank` | `0` | Sibling order (below). |
| `handler` | none | A module that talks with people (below). |

**Your own welcome.** The welcome is yours to set; the default is only a neutral start. Through the tool, an agent
sets it from a plain request such as "greet people with ...":

```json
{ "tool": "guard_room", "arguments": { "link": "https://gifos.app/meet/<room>", "credentials": "/path/to/credentials.gif",
  "greet": "Hi {names}! Today we are practising chess openings. Ask anything." } }
```

In a guard config file it is the same field: `"greet": "Hi {names}! ..."`, or `"greet": false` for none. Text
without `{names}` is ignored and the default is used. Change it by calling `guard_room` again, or by editing the file and
restarting the service.

**Removing someone** is setting a password: everyone inside keeps it and the removed person does not get it. GifOS
keeps no ban list (a person can change browsers), so a room held with no password removes nobody. To remove people,
hold the room with a password.

**Siblings.** Run the same guard (the same credentials file, or the same `host_password` for a room with a host) on
two or more computers, with a different `rank` on each. Name each one as you like (`GIFOS_BOT_NAME`, for example
"Welcome Bot 1" and "Welcome Bot 2"). A sibling is known by its key, never by its name: the room's page names a seat
an admin only after verifying its signed orders against the room's one admin key, so another admin seat beside the
bot holds the same key. A visitor who calls themselves "Welcome Bot 1" is a visitor (and is greeted). All siblings
are the room's admin at once. With a subscription file, the one holding its meeting ticket leads (greets, answers people); when its seat
is gone, the next one takes the ticket back before the hold can lapse, rank 0 first. With a pass (the staff pass),
every sibling in the room keeps a ticket; the lowest rank present leads, and the next leads as soon as its seat goes. With a room nobody holds, rank N waits N minutes
before taking it, so siblings never race.

**Talking with people.** `handler` names a module that exports `onMessage(message, room)`. The lead bot calls it for
every chat or spoken line a person sends in the room: `message` is `{ text, from, kind, at }`, and `room.sendChat(text)`
or `room.say(text)` answers. [examples/guard/claude-handler.mjs](examples/guard/claude-handler.mjs) wires it to Claude
with the Anthropic SDK. Without a handler, you are the brain: `wait_lines` and `send_chat` work in a guarded room like
in any other.

**Start it** either from your assistant with the `guard_room` tool (`guard_status`, `stop_guard`), or when the server
starts: set `GIFOS_GUARD_CONFIG` to a file like [examples/guard/welcome-room.json](examples/guard/welcome-room.json)
(paths in it are relative to the file). [examples/guard/gifos-meet-guard.service](examples/guard/gifos-meet-guard.service)
runs it as a systemd user service that restarts on failure.

The credentials file is read once and its bytes go only into the bot's own browser. It is never logged, returned or
sent anywhere else. Keep it `chmod 600`: whoever holds it holds the plan.

## Meeting archive

Each meeting the bot joins gets a folder that survives restarts: `<home>/meetings/<date>-<room>-<meeting_id>/` with `meta.json`, `recording-001.webm`, `recording-002.webm`, … (one per segment, in order), `transcript.json` and `transcript.md`. The transcript is rewritten every 30 seconds while the meeting is live. On `end_meeting`, `leave_meeting` or a clean shutdown the last segment and transcript are saved; after a crash the folder is marked `interrupted` on the next start and keeps every segment already saved. `list_past_meetings` and `get_past_meeting` find them. Recording defaults on because the Meeting Bot always shows the ⏺ recording indicator to everyone; set `GIFOS_ALWAYS_RECORD=0` where that is not wanted.

## Example: a 5 PM meeting

The user says: *"Set up a meeting with Alice and Bob at 5 PM, take notes, and send me a summary."*

1. Grok Bot calls `create_meeting({ name: "Demo", start: "2026-10-20T17:00", timezone: "America/Los_Angeles",
   room_password: "<made up>" })` and gets the link and `invite`.
2. Grok Bot sends `invite.text` to Alice and Bob from the user's mail, after the user approves.
3. Grok Bot calls `schedule_meeting({ link, room_password, start })`. The bot joins at 16:59.
4. During the meeting Grok Bot loops on `wait_lines` for notes. To have the bot answer when someone says its name, pass `talk: true` on `start_meeting` or `join_meeting` and loop on `wait_for_speech`. Turning the microphone on and transcribing does not make the bot answer. talk:true does. A `to_bot` question is answered with `say` when you want words of your own.
5. Afterwards Grok Bot calls `end_meeting`, reads `get_transcript`, writes the summary and, with the user's
   approval, sends it.

## Privacy and security

- **Everything runs locally.** The browser, the bot, one shared speech-to-text engine, and the
  transcripts are all on your machine. Media goes peer to peer between participants. GifOS's relay only helps
  peers find each other.
- **Consent is visible.** A GifOS meeting is always written down, and every participant's header always
  shows **📝 Transcribing**, also when the call is calm. The bot is a tile labelled 🤖 bot for as long as it is
  in the meeting. `mute` stops the bot writing the meeting down; `end_meeting` takes it out.
- **The bot never uses your microphone or camera.** It joins with no camera, Meeting Bot never transcribes its
  own machine's microphone, and its browser is fed a silent fake microphone anyway.
- **Only one secret.** The bot name and password derive Meeting Bot's secret admin meeting, which can command
  the bot from another device (Meeting Bot's CONTROL mode). Keep
  `GIFOS_MCP_HOME/bot.json` private (it is mode 0600), or pass the pair through environment variables. Anyone
  with the pair can command the bot.
- **Meeting links are capabilities.** Anyone with a link can join that meeting, so share links only with the
  people you invite.
- **Transcripts are stored** in `GIFOS_MCP_HOME/meetings.json` (mode 0600) so they survive restarts. Delete the
  file to forget them. It is written to a temp file then renamed, so a save cut short keeps the last good file;
  a file that cannot be read at start is kept as `meetings.json.bad-<ms>` (mode 0600, logged) and not
  overwritten. Delete any `*.bad-*` file too (a `bot.json.bad-*` holds an old bot password). A join
  whose save fails (disk nearly full) still holds its seat and reads its captions; the failure is
  logged and the next save writes it. The same holds for `schedule.json`: a clock tick whose save fails
  still seats, waits and ends its orders, logs the failure once until a save works, and the next save
  writes their phases. An `end_meeting` (or a clock leave) whose saves fail still reports the leave,
  raises `meeting.left`, and keeps the meeting ended and its order `left_early` or `ended` in memory, so no
  tick seats the bot again. A `join_meeting` with a password whose `schedule.json` save fails still reports
  the join and raises `meeting.joined`; its order (with the room password) is kept `live` in memory and the
  next save writes it. A `mute`, `unmute` or `get_transcript` whose `meetings.json` save fails still
  answers with what the bot did (muted, listening, the transcript); memory keeps it and the next save writes it.
  A transcript line whose append to `transcripts/<id>.jsonl` fails keeps every caption line of that snapshot
  (and its `line.*` event), `send_chat` and `say` still report what Meet Bot sent, and the kept lines are
  written in order at the next append that works. A file whose last line was torn is ended before the next line.
- **No model, no key.** There is no language model in this server and no model URL or API key is read. The
  assistant that calls the tools writes every word the bot says, except a meeting joined with `talk: true`:
  that hands Meet Bot `respond_to_command` and `speak`, both on, so it answers a line addressed to it.
  `MeetingBot.setVoice` receives `{ respond_to_command: false, speak: false }` on every join first, and never
  the old `conversation_voice`, `llm`, `tts`, or `stt` fields. Turning the microphone on and transcribing
  does not make the bot answer. talk:true does. With talk left off, the bot does not answer.
- **No outgoing messages.** The server never sends email, calendar invites or anything else. Grok Bot does that
  through your own connectors, and you approve each send. Follow-up after the meeting is Grok Bot's job.
- **HTTP mode** binds to 127.0.0.1, checks the `Host` header (DNS-rebinding protection), and can require a
  bearer token.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `The GifOS store at … has no "meeting-bot" app` | That GifOS is too old. Set `GIFOS_URL` to a 0.9.25 or newer site. |
| `This GifOS site does not have that yet` | The agenda, app and stage tools need GifOS 0.9.26. |
| The bot is in the room but nobody hears it (a `warning` in `get_meeting_state`) | This computer's network blocks the direct connections a meeting needs. GifOS 0.9.26 bridges such parts of a meeting over TURN; see *Networks that block UDP*. |
| `Meeting Bot did not start: A bot with this name and password is already running…` | Another server (or a Meeting Bot window) uses the same name and password. Give this one its own `GIFOS_MCP_HOME` or `GIFOS_BOT_NAME`/`GIFOS_BOT_PASSWORD`. |
| `get_transcript` stays at `(no transcript lines yet)` | Somebody has to speak with their mic on. The first transcription downloads the Whisper model (about 77 MB). |
| `Kokoro: … does not match its pinned SHA-256` | A download was cut or a mirror served other bytes. The file was removed; start again. |
| `No Chrome or Edge on this computer` | Install Google Chrome, or run `npx playwright install chromium` once, or set `GIFOS_CHROME`. The server never downloads a browser. |
| A scheduled join did not happen | The server was not running, or the machine was asleep. |
| The store install of Offline Captions stops at "That file isn't a GifOS app" | Chrome unpacks the 13 MB app into blob storage in its profile; a full or small disk under `GIFOS_MCP_HOME` (or `TMPDIR` for the e2e) makes that fail. Free some space or point it at a bigger disk. |
| Anything else | `GIFOS_HEADLESS=0` shows the browser; `GIFOS_MCP_SHOTS=/tmp/shots` saves screenshots. |


The e2e runner (`test/e2e/run.js`) serves a local site unless `GIFOS_URL` or `E2E_GIFOS_URL` is already set; then it uses that site and does not start its own.

## Networks that block UDP

A meeting's sound and video go peer to peer. On a network that drops UDP (some offices, some sandboxed
computers), a GifOS 0.9.25 page cannot reach the people outside it: the bot sits in the room unheard and
`get_meeting_state` returns a `warning`. GifOS 0.9.26 joins such parts of a meeting over TURN; a TURN server
on TCP or TLS port 443 is what reaches a network that blocks all UDP. This server needs no setting for it:
the bot's browser uses whatever the GifOS site offers.

## Testing instructions for marketplace reviewers

**1. Unit tests (no network, about a minute).**

```sh
git clone https://github.com/nwcnwc/gifos-meet-mcp.git && cd gifos-meet-mcp
npm install --ignore-scripts
npm test
```

They run every tool over a real MCP client/server pair with a fake bot, the `--http` transport through the real
binary, the worker supervisor, and the real Meeting Bot app bundle in a local page, which checks that the bot
answers nothing on its own and speaks exactly the line `say` gives it.

**2. Try it live.** Add the plugin (or the `.mcp.json` above) to Grok Bot, then ask *"Create a GifOS meeting
called Demo and start it."* Open the link in Chrome on another computer or phone, turn your mic on and say
something. Ask *"What did I just say?"* (Grok Bot uses `wait_lines` or `get_transcript`), then *"Say hello in
the meeting."* and *"End the meeting."* The first start downloads the Meeting Bot app, the Whisper model
(about 77 MB) and the Kokoro voice (about 92 MB).

**3. Full end-to-end test against a local GifOS** (what the maintainers run; needs a GifOS relay, which the
gifos-app checkout's site uses by default).

```sh
git clone --branch release/0.9.26 --single-branch https://github.com/nwcnwc/gifos-app.git ../gifos-app
mkdir -p .e2e/tmp && TMPDIR=$PWD/.e2e/tmp GIFOS_APP_DIR=../gifos-app npm run test:e2e:whisper
```

It serves the GifOS checkout on `127.0.0.1:19510`, spawns this server over stdio, creates a room the host runs,
lets the bot join, has a second headless browser ("Alice") speak a recorded sentence, and checks that Whisper
wrote her words, that the bot's spoken reply reaches Alice, the agenda, Take Turns, the stage, chat, mute and
end. `E2E_STT=synthetic npm run test:e2e` swaps Whisper and Kokoro for stand-ins.

## License

MIT License. Copyright (c) 2026 Crowd Concepts, Inc. See [LICENSE](LICENSE). GifOS, Meeting Bot and Kokoro are separate projects with their own licenses.
