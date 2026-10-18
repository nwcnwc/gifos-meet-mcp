<p align="center"><img src="assets/logo-512.png" width="128" height="128" alt="gifos-meet-mcp logo"></p>

# gifos-meet-mcp: GifOS meetings for Grok Bot

`gifos-meet-mcp` is an [MCP](https://modelcontextprotocol.io) server that lets Grok Bot (or any MCP client)
create [GifOS](https://gifos.app) meetings with everything an invite needs, put a note-taking bot in them,
follow the transcript live and speak through the bot.

It runs **on your own computer** (self-run only; there is no hosted MCP URL). It starts a headless Chromium
running GifOS, installs the **Meeting Bot** app from the GifOS app store, and drives it. Meetings stay peer to
peer between the people in them. Transcripts stay on your computer. No GifOS account, no API key, no model.

The shared parts (the bot, transcripts, Kokoro, links and invite details) are
[gifos-mcp-core](https://github.com/nwcnwc/gifos-mcp-core), pinned to an exact commit. Its sibling for
broadcasts is [gifos-broadcast-mcp](https://github.com/nwcnwc/gifos-broadcast-mcp).

> **Requires GifOS 0.9.23b or newer**, the release that ships the Meeting Bot store app (control contract
> version 2). Until it is live on gifos.app, point `GIFOS_URL` at a GifOS 0.9.23b site.

## How it works

```
Grok Bot ──MCP (stdio)──▶ gifos-meet-mcp ──▶ headless Chromium (one profile in ~/.gifos-mcp)
   (the brain)                                └─ GifOS desktop
                                                   ├─ Meeting Bot (window.MeetingBot v2): joins, captions, speaks
                                                   └─ Offline Captions (Whisper): speech to text
```

- **Grok Bot is the brain.** The server has no language model. Meet Bot is handed both of its switches off
  (`respond_to_command`, `speak`) on every join, so it never answers on its own; it says exactly the lines
  Grok Bot passes to `say`.
- **Scheduling without joining.** `create_meeting` mints a link and returns every invite detail (title, start
  and end with time zone, join link, description, how guests get in, who does what, ready-to-send text).
  Nothing joins and nothing is sent: Grok Bot sends the invite through the user's own mail or calendar.
- **Fast replies.** `wait_lines` returns the moment someone says something (captions are copied every 300 ms),
  with `to_bot: true` on lines addressed to the bot. `say` speaks a line at once.
- **Speech** is [Kokoro](https://github.com/hexgrad/kokoro) (kokoro-js 1.2.1), running in this process with its
  default voice `af_heart`; `say` takes an optional `voice` for one line. **Speech to text** is GifOS Whisper
  in the headless browser. The bot writes down each participant who is unmuted, credited by name, and never its
  own machine's microphone.

## Install

You need **Node.js 20 or newer** and **Google Chrome or Microsoft Edge** (see *The browser* below).

```sh
npx -y github:nwcnwc/gifos-meet-mcp
```

`npx` with a `github:` address downloads the package through git. Install git first.

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
      "args": ["-y", "git+https://github.com/nwcnwc/gifos-meet-mcp.git#40574d39bd0e556374dbe4c6b11f3d88b2786f06"],
      "env": { "npm_config_ignore_scripts": "true", "ONNXRUNTIME_NODE_INSTALL_CUDA": "skip", "GIFOS_URL": "https://gifos.app" }
    }
  }
}
```

That pin is the same commit as `.mcp.json`. `npx github:` needs git.

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
| `GIFOS_URL` | `https://gifos.app` | The GifOS site. It must be 0.9.23b or newer. |
| `GIFOS_RELAY` | GifOS default | A custom relay (`wss://…`), added to meeting links. |
| `GIFOS_BOT_NAME` | generated | The name people see on the bot's tile (3 to 40 characters). Set alone, it keeps the stored password. |
| `GIFOS_BOT_PASSWORD` | generated | The bot's password (the secret half). A `bot.json` that cannot be read is kept as `bot.json.bad-<ms>` and a new pair is generated. |
| `GIFOS_BOT_PICTURE` | none | Path to the bot's picture: a GIF, PNG, JPEG or WebP file, at most 256 KB. Rooms show it on the bot's tile like anyone's picture. |
| `GIFOS_STT_APP` | `offline-stt-whisper` | The store app for speech to text. `none` turns transcription off. |
| `GIFOS_MCP_HOME` | `~/.gifos-mcp` | Browser profile, bot credential, `meetings.json`, `schedule.json`, transcripts, events. |
| `GIFOS_HEADLESS` | `1` | `0` shows the browser windows. |
| `GIFOS_CHROME` | Chrome, then Edge | A Chrome or Chromium binary to use instead. |
| `GIFOS_TIMEOUT_MS` | `120000` | How long to wait for GifOS steps such as joining. |
| `GIFOS_MCP_HTTP_TOKEN` | none | Bearer token for `--http`. |
| `GIFOS_MCP_LAZY` | `0` | `1` starts the browser on the first tool call. |
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
| `create_meeting` | `name`, `start?`, `end?`, `timezone?`, `description?`, `room_password?`, `admin_password?`, `town_hall?`, `host_name?` | `{ meeting_id, link, host_runs_room, invite }`. Nothing joins, nothing is sent. `invite` has `title`, `start`/`end` (`{iso, timezone, local}`), `join_url`, `description`, `admit`, `roles`, `text`, `calendar`. `admin_password` (the human host's) makes a room they run; it is used for this call only and never stored or returned. The room password is in the invite text, never in the link. |
| `start_meeting` | `meeting_id`, `room_password?` | The bot joins now and starts transcribing. |
| `join_meeting` | `link`, `password?`, `topic?` | The bot joins someone else's GifOS meeting now. |
| `raise_hand`, `set_mic`, `set_camera` | `meeting_id`, `on` | Meet Bot's hand, microphone and camera, or the gap when the app lacks the method. |

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
| `list_schedule`, `update_schedule`, `cancel_schedule`, `import_schedule` | see the schemas | Join orders. No passwords in results. |
| `list_meetings`, `meeting_status`, `meetings_report`, `status`, `capacity_status` | — | State, people, line counts, capacity. No passwords. |
| `tail_events` | `since?` | Connector events, including `capacity.near`, `capacity.reached`, and `capacity.cleared`. They are appended to `GIFOS_MCP_HOME/events.jsonl` (mode 0600); a torn last line left by a process killed mid-write is skipped and ended at the next start, so later events stay readable and no `seq` is handed out twice. |

The resource `gifos://meeting/{id}/transcript` is the live transcript as newline-delimited JSON; subscribe for
`notifications/resources/updated`.

## Example: a 5 PM meeting

The user says: *"Set up a meeting with Alice and Bob at 5 PM, take notes, and send me a summary."*

1. Grok Bot calls `create_meeting({ name: "Demo", start: "2026-10-20T17:00", timezone: "America/Los_Angeles",
   room_password: "<made up>" })` and gets the link and `invite`.
2. Grok Bot sends `invite.text` to Alice and Bob from the user's mail, after the user approves.
3. Grok Bot calls `schedule_meeting({ link, room_password, start })`. The bot joins at 16:59.
4. During the meeting Grok Bot loops on `wait_lines`, and answers a `to_bot` question with `say`.
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
  assistant that calls the tools writes every word the bot says. `MeetingBot.setVoice` receives
  `{ respond_to_command: false, speak: false }` on every join, so Meet Bot answers nothing on its own.
- **No outgoing messages.** The server never sends email, calendar invites or anything else. Grok Bot does that
  through your own connectors, and you approve each send. Follow-up after the meeting is Grok Bot's job.
- **HTTP mode** binds to 127.0.0.1, checks the `Host` header (DNS-rebinding protection), and can require a
  bearer token.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `The GifOS store at … has no "meeting-bot" app` | That GifOS is older than 0.9.23b. Set `GIFOS_URL` to a 0.9.23b or newer site. |
| `Meeting Bot did not start: A bot with this name and password is already running…` | Another server (or a Meeting Bot window) uses the same name and password. Give this one its own `GIFOS_MCP_HOME` or `GIFOS_BOT_NAME`/`GIFOS_BOT_PASSWORD`. |
| `get_transcript` stays at `(no transcript lines yet)` | Somebody has to speak with their mic on. The first transcription downloads the Whisper model (about 77 MB). |
| `Kokoro: … does not match its pinned SHA-256` | A download was cut or a mirror served other bytes. The file was removed; start again. |
| `No Chrome or Edge on this computer` | Install Google Chrome, or run `npx playwright install chromium` once, or set `GIFOS_CHROME`. The server never downloads a browser. |
| A scheduled join did not happen | The server was not running, or the machine was asleep. |
| Anything else | `GIFOS_HEADLESS=0` shows the browser; `GIFOS_MCP_SHOTS=/tmp/shots` saves screenshots. |


The e2e runner (`test/e2e/run.js`) serves a local site unless `GIFOS_URL` or `E2E_GIFOS_URL` is already set; then it uses that site and does not start its own.

## Testing instructions for marketplace reviewers

**1. Unit tests (no network, no browser except one local page, about a minute).**

```sh
git clone https://github.com/nwcnwc/gifos-meet-mcp.git && cd gifos-meet-mcp
npm install --ignore-scripts
npm test
```

They run every tool over a real MCP client/server pair with a fake bot, the `--http` transport through the real
binary, the worker supervisor, and the real Meeting Bot app bundle in a local page, which checks that the bot
answers nothing on its own and speaks exactly the line `say` gives it.

**2. Try it live (needs GifOS 0.9.23b or newer).** Add the server to Grok Bot, then ask *"Create a GifOS
meeting called Demo and start it."* Open the link in a browser, turn your mic on and say something. Ask
*"What did I just say?"* (Grok Bot uses `wait_lines` or `get_transcript`), then *"Say hello in the meeting."*
and *"End the meeting."*

**3. Full end-to-end test against a local GifOS** (what the maintainers run).

```sh
git clone --branch release/0.9.23 --single-branch https://github.com/nwcnwc/gifos-app.git ../gifos-app
git clone https://github.com/nwcnwc/gifos-apps-source.git ../gifos-apps-source
GIFOS_APP_DIR=../gifos-app MEETING_BOT_SRC=../gifos-apps-source/meeting-bot \
E2E_STT=synthetic npm run test:e2e
```

Leave `E2E_RELAY` unset. The test uses the GifOS site's own relay, and a client on this computer can use the live relay.

It serves the GifOS checkout on `127.0.0.1:19510`, spawns this server over stdio, creates a meeting, lets the
bot join, has a second headless browser ("Alice") speak, and checks the transcript, `wait_lines`, `say`,
chat, mute, end and the quiet bot. `E2E_STT=whisper` with `E2E_SPEECH_WAV` uses the real Whisper model.

## License

MIT. GifOS, Meeting Bot and Kokoro are separate projects with their own licenses.
