---
name: gifos-meet
description: >-
  Create GifOS video meetings with everything an invite needs, put a note-taking bot in them, follow the
  live transcript and speak through the bot. Use when the user wants to set up, schedule, join, take notes
  in, or follow a GifOS meeting, or asks for a meeting link, an invite, a transcript or meeting notes.
metadata:
  author: GifOS
  short-description: GifOS meetings, invites and a live note-taking bot
---

# GifOS Meet

The `gifos-meet` MCP server runs on the user's own computer. It makes GifOS meeting links, returns invite
details, and drives a headless **Meeting Bot** that joins, transcribes, and speaks the lines you give it.
**You are the brain**: the bot never answers on its own and there is no model inside the server.

## Make a meeting (no join, nothing sent)

1. `create_meeting` with `name`, and when known `start`, `end`, `timezone` (IANA), `description`,
   `room_password` (a password guests type) and `host_name`. Pass `admin_password` only if the user gave you
   their host password for this call; it makes a room they run and is never stored or returned.
2. The result has `link` and `invite`: `title`, `start`/`end` with time zone, `join_url`, `description`,
   `admit` (how guests get in), `roles`, ready-to-send `text`, and `calendar` fields.
3. **You send the invite** with the user's own mail or calendar connector, after the user approves it. The
   server never sends mail and never writes a calendar file. Never put the room password inside the link.

## How the bot looks

- The operator may set its name and picture (`GIFOS_BOT_NAME`, `GIFOS_BOT_PICTURE`). If the user asks for another
  name or picture, call `set_bot_profile` with `name` and/or `picture_path` (a GIF, PNG, JPEG or WebP file, at most
  256 KB) before the bot joins; a new name is refused while the bot is in a room.

## Put the bot in the meeting

- Now: `start_meeting` (a meeting you made) or `join_meeting` with a link (someone else's meeting).
- Later: `schedule_meeting` with the link, the room password and `start`; the bot joins one minute early.
  The server must be running then.
- Everyone sees the bot as a tile labelled 🤖 bot, and every screen shows 📝 Transcribing.

## Follow the meeting and reply fast

- Loop on `wait_lines` with `since` set to the last `next`. It returns the moment a new line lands.
  Lines addressed to the bot (its name, "bot", or a question) carry `to_bot: true`.
- To answer out loud: `say` with one or two sentences (optional `voice`, a Kokoro voice name). To post
  text: `send_chat` or `share_content`. Keep spoken answers short.
- `get_meeting_state` tells who is here. `mute`/`unmute` stop and restart note-taking.

## Run a meeting for the owner (opt-in)

By default the bot only transcribes. When the owner gives the bot a goal and instructions for a meeting
(for example a daily check-in with each employee: set questions, follow-ups, a report back), pass them as
`instructions` to `schedule_meeting`, `update_schedule`, `import_schedule` or `join_meeting`. They come back
in `list_schedule`, `meeting_status` and the `schedule.due` / `meeting.joined` events; the server never runs
them, you do. Follow `docs/recipes/daily-checkins.md` in this package: consent notice first, the run loop,
the owner report format, and opt-in escalation under the owner's own rules.

## After the meeting

`end_meeting` (or `leave_meeting`) saves the transcript; `get_transcript` still works afterwards. Write the
summary yourself and send it only with the user's approval.
