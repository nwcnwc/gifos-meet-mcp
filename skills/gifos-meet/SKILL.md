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
**You are the brain**: there is no model inside the server. Turning the microphone on and transcribing does not make the bot answer. talk:true does. With talk left off, the bot does not answer.

## Make a meeting (no join, nothing sent)

1. `create_meeting` with `name`, and when known `start`, `end`, `timezone` (IANA), `description`,
   `room_password` (a password guests type) and `host_name`. `type` is `open` (default: anyone with the link)
   or `admin` (a room the user runs, with host controls); `admin` needs `host_password`, which the user gives
   you for this call only. It is never stored or returned. There is no town hall.
2. The result has `link` and `invite`: `title`, `start`/`end` with time zone, `join_url`, `description`,
   `admit` (how guests get in), `roles`, ready-to-send `text`, and `calendar` fields.
   The room name rides in the part after #, which browsers never send to a server, so it never reaches GifOS's servers or logs. Older /meet/<room> links still work.
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
- Everyone sees the bot as a tile labelled 🤖 bot, and the bot's tile shows that it is writing the meeting down.

## Follow the meeting and reply fast

- Turning the microphone on and transcribing does not make the bot answer. talk:true does. Pass `talk: true`
  to `join_meeting` or `start_meeting`. That starts the listen and respond loop: the bot answers a line
  addressed to it (its name, "bot", or a question), and that line is handed to you.
- Loop on `wait_for_speech` for those addressed lines (it blocks until one arrives). A talk notification
  carries the same line. Then call `wait_for_speech` again.
- `wait_lines` still follows every line. Lines addressed to the bot carry `to_bot: true`.
- To say words of your own out loud: `say` with one or two sentences (optional `voice`, a Kokoro voice name).
  To post text: `send_chat` or `share_content`. Keep spoken answers short.
- With talk left off, the bot does not answer. `set_mic` only opens or closes the microphone.
- `get_meeting_state` tells who is here. `mute`/`unmute` stop and restart note-taking.

## Agenda, Take Turns and the stage (GifOS 0.9.26)

- In a room the user runs (`type: admin`), host-only actions need `sign_in_as_host` with the host password
  the user gives you. Never ask for it in the meeting chat.
- `set_agenda` with `items` (`title`, `minutes`) shares an agenda everyone sees with a clock; `next_agenda_item`
  starts it and moves it on; `get_agenda` gives `current_item` and `time_left`. Use it to keep time: when
  `time_left` runs out, say so briefly and move on if the host agrees.
- `take_turns` with `action: start` runs the Take Turns app for everyone (a round where each person speaks in
  order); `state` tells who is up now and next; `next` moves on. It asks the person whose turn it is onto the
  stage on their own page and never turns anyone's camera or microphone on.
- `list_apps` / `run_app` / `stop_app` run any other installed GifOS app in the meeting.
- `stage` reads who is on the stage and steps the bot on or off; as host it can `allow` a person to take it.
- On an older GifOS site these answer "This GifOS site does not have that yet".

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
