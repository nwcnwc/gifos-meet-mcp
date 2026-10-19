# Recipe: daily check-ins run by the bot

**Who reads this:** the owner's agent (Grok Bot or any MCP client) after it installs `gifos-meet-mcp`.

**What it does:** a small business owner wants a short daily check-in (10 to 15 minutes) with each
employee. The bot schedules them, joins each one, asks the owner's questions plus follow-ups, and sends the
owner one summary report. An urgent matter goes to the owner right away, but only if the owner turned
escalation on.

**What it is not:** a new feature or framework in the server. It uses the tools the server already has. The
one field added for it is `instructions`: the owner's goal and questions for a meeting, kept with the
meeting and handed back to you. **You are the brain.** The server runs no model and calls no API. It never
reads, runs or acts on `instructions`; it only stores them and hands them back to you.

**Default:** without `instructions` the bot only transcribes, as before. Running a meeting for the owner
is opt-in, per meeting.

---

## 1. Setup (once)

1. Install the server (README, *Install*). Check `status`: the browser is up and `bot.state` is `ready`.
2. Ask the owner how the bot should look (`set_bot_profile`, before any room is joined). A clear name helps,
   for example "Check-in bot".
3. Ask the owner for these and **write the answers down in your own memory**, not in a meeting:
   - **Owner role** as employees should hear it, for example "the owner" or "operations lead".
   - **People:** each employee's first name and how to reach them with an invite (the owner's own mail or
     chat; the server sends nothing).
   - **Time:** days, local start time, time zone (IANA, for example `America/Chicago`), length (10 to 15 min).
   - **Questions** (the set questions, in order) and **how many follow-ups** per question (default 2).
   - **Report:** when the owner wants it (after each check-in, or one roll-up at a set time) and where (the
     owner's chat with you).
   - **Escalation:** off by default. If the owner wants it, their rules (section 7).
   - **Retention:** how many days to keep transcripts (section 9).
4. Read the consent notice (section 3) back to the owner and get their OK on its wording.

## 2. The owner's goal and instructions (template)

Fill this in once per employee and pass it as `instructions` (plain text, at most 4000 characters, no
passwords or other secrets). Keep it short; it is for you, the agent, at check-in time.

```
GOAL: Daily check-in with Alex for the owner. Collect progress, plans and blockers; report back.
ROLE: You run this check-in on behalf of the owner. You are not the owner.
PERSON: Alex
TIME BOX: 15 minutes. Wrap up at 12 minutes.
QUESTIONS (in order):
  1. What did you finish since the last check-in?
  2. What are you working on today?
  3. Is anything blocking you or slowing you down?
  4. Anything the owner should know?
FOLLOW-UPS: up to 2 per question, only to clarify (what, when, who, how big). No advice, no promises.
REPORT: after the call, to the owner, in the check-in report format.
ESCALATION: off.                  (or: on — rules: see owner's escalation rules)
STOP: if Alex says "stop", stop asking, confirm, and leave.
```

## 3. Consent notice (say it and post it at the start, before any question)

The bot is a tile labelled 🤖 bot and every screen shows 📝 Transcribing, but say it in words too. When the
first person other than the bot is in the room (`get_meeting_state` → `people`), and **before any
question**:

- `say` (spoken, short):
  > Hi Alex. I'm an automated assistant running today's check-in for the owner. This call is recorded and
  > transcribed, and a summary goes to the owner. You can say "stop" at any time, or just leave, and I'll end it.
- `send_chat` (the same, written down):
  > 🤖 Automated check-in for the owner. This call is recorded and transcribed, and a summary goes to the
  > owner. Say "stop" or leave the meeting at any time to end it.

Then ask: "Is it OK to go ahead?" Wait for a yes. If the answer is no or "stop", follow section 5, *Stop*.
Never start the questions without this notice.

## 4. Schedule one room per employee

For each employee:

1. `create_meeting` with `name` ("Daily check-in: Alex"), `start`/`end` of the first check-in, `timezone`,
   `description` (the purpose and the consent sentence), `room_password` (make one up), and `host_name`
   (the owner role). Keep `link` and `invite`.
2. `schedule_meeting` with that `link`, `room_password`, `start`, `end` (start plus the length, so the bot
   is not kept there for hours), `timezone`, a daily rule, and the employee's `instructions`:
   - Weekdays: `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`
   - Every day: `RRULE:FREQ=DAILY`
   - Supported parts: `FREQ` (DAILY, WEEKLY, MONTHLY), `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`. Anything else is
     refused; then ask the owner for a simpler rule.

   Stagger start times (for example 09:00, 09:20, 09:40) so check-ins don't overlap and stay under the
   bot's capacity (`capacity_status`; the `capacity` field in the reply says `over_by` if they clash).
3. Send the invite yourself, with the owner's approval, through the owner's own mail or chat: the
   `invite.text` from step 1 has the title, start and end with time zone, join link, how to get in, who runs
   it, and the description. Send the room password with it, never inside the link. The server sends no mail
   and writes no calendar file (no ICS).
4. `list_schedule` with the owner's `timezone` and show the owner the plan: one row per day per person, each
   with its `instructions`.

Changes: `update_schedule` with `schedule_id` (the whole series) or `occurrence` (one day only), for
example new `instructions` for Fridays. `instructions: ""` turns a meeting back to transcribe only.
`cancel_schedule` stops a series or skips a day. For many people at once, `import_schedule` takes the same
fields per row plus `external_id`.

## 5. Run the check-in

The server's clock joins the bot one minute before `start`, on its own. **You must be awake at that time
to run the meeting**: the server does not wake you. Use your own scheduler (a routine at each start time),
or keep a loop on `tail_events` and act on these events:

- `schedule.due`: the order is about to join. `data.instructions` says what the meeting is for.
- `meeting.joined`: the bot is in. `meeting_id`, `schedule_id` and `instructions` are in the event.
- `schedule.missed`, `schedule.waiting`, `meeting.error`: tell the owner if a check-in could not happen.

`meeting_status` (`meeting_id`) also returns the `instructions`. If a meeting has none, only transcribe:
do not speak.

**The loop (one per meeting):**

1. Wait for the employee: `get_meeting_state` every few seconds until someone other than the bot is there.
   No one after 5 minutes: `send_chat` "No one joined; I'll let the owner know.", `leave_meeting`, and
   report "no-show".
2. Consent notice (section 3). Go on only after a yes.
3. For each set question, in order:
   - `say` the question (one or two sentences).
   - `wait_lines` with `meeting_id` and `since` = the last `next` (timeout up to 30 s). Collect the
     employee's `speech` and `chat` lines until they stop for a few seconds.
   - Decide: is the answer clear? If not, and you have follow-ups left for this question, `say` one short
     follow-up (what, when, who, how big). Otherwise say "Thanks" and go to the next question.
   - Note a timestamp (`ts`) and a short exact quote for anything important.
4. Watch the clock. At the wrap-up time skip what is left (mark it "not asked").
5. Close: `say` "That's everything. Thanks, Alex. A summary goes to the owner. Have a good day." Then
   `leave_meeting`. The transcript is saved.

**Stop:** if the employee says "stop" (or "stop recording", "end this") or leaves, stop at once: `say`
"Understood, I'm ending the check-in now." and `leave_meeting`. Do not ask why. Report it as
"stopped by participant" with what was said before.

**Rules while running:**

- Ask only what the instructions say, plus clarifying follow-ups. No advice, no promises, no decisions,
  no performance judgments in the room. Those are the owner's.
- Keep each spoken line short. If someone asks the bot something it can't answer, say "I'll pass that to
  the owner" and add it to *follow-ups owed*.
- Never read out or post a password, a key, or anything the owner marked private.

## 6. The report to the owner

Build it from `get_transcript` (per meeting) or `meetings_report` (several meetings at once; its rows are
raw lines, you write the prose). Send it to the owner in their chat with you, at the time they chose.

**Per person:**

```
## Alex — Tue 2026-01-06, 09:00–09:13 (America/Chicago)
Attendance: joined 09:01, consent yes, completed (or: no-show / stopped by participant / partial)
Answers:
  1. Finished: <1–3 short lines>
  2. Today: <1–3 short lines>
  3. Blockers: <each blocker, or "none">
  4. For the owner: <or "nothing">
Blockers: <blocker — who/what it waits on — since when>
Risks: <what could slip, how likely, by when>
Follow-ups owed: <who owes what to whom, by when>  (include questions the bot could not answer)
Quotes: [09:06] "We're still waiting on the supplier's quote." · [09:09] "I can't ship until the login fix lands."
Triage: Needs owner today / This week / FYI
```

**Roll-up (top of the message, before the people):**

```
Daily check-ins — Tue 2026-01-06: 4 of 5 done (Sam: no-show)
Needs you today: <one line each, with the person's name>
Blockers: <count> — <names>
Risks: <one line each>
Follow-ups owed by you: <one line each>
Escalations sent: <none, or what and when>
```

Keep quotes exact and short, with the `ts` time from the line. Do not add what was not said.

## 7. Triage rules

Sort every item into one bucket (the owner can change these rules):

- **Emergency** (only if escalation is on): an item that matches one of the owner's escalation rules.
  Escalate at once (section 8), then put it in the report too.
- **Needs owner today:** a blocker only the owner can clear, a decision only they can make, a customer or
  money issue due today.
- **This week:** risks, slipping dates, things that need the owner but not today.
- **FYI:** progress, plans, no action.

When unsure between two buckets, pick the more urgent one and say why in one line.

## 8. Escalation (opt-in, owner-set rules)

Escalation is **off** unless the owner turns it on and writes the rules. Examples an owner might set:

- "Someone is hurt or unsafe at work."
- "A customer outage or data leak."
- "A legal or security threat."
- "Anyone says they are quitting today."

How to escalate: send the owner a message right away **through your own messaging with the owner** (the
chat or channel you already use with them): who, what was said (exact quote with time), and the
`meeting_id`. Don't wait for the report. Don't tell the employee what you will escalate. Don't promise
an outcome. Write it as "I'll make sure the owner hears this today."

Not included: this server has no phone, SMS or calling integration, and this recipe does not add one. Do not
set up an automated phone call or text to the owner's personal phone on your own. Any phone or calling
integration needs the GifOS maintainers' approval before it is built or deployed. If the owner asks for
calls, tell them it is not available yet and use your messaging channel.

## 9. Privacy and retention

- **Consent first,** every time (section 3). If someone says no, or "stop", stop.
- **No secrets in chat or speech:** room passwords go only in the invite you send; never paste passwords,
  keys or personal data into `send_chat`, `say`, or `instructions`.
- **Where data lives:** everything stays on the owner's computer under `GIFOS_MCP_HOME` (default
  `~/.gifos-mcp`): `meetings.json`, `schedule.json` (with the `instructions` and the room passwords),
  `transcripts/<meeting_id>.jsonl` and `events.jsonl`, all mode 0600. Meetings run peer to peer; the server
  uploads nothing.
- **Retention:** the server does not delete transcripts on its own. Keep them only as long as the owner
  chose (for example 30 days). When that runs out, tell the owner which files are due, and delete them only
  with the owner's OK. Do not copy transcripts elsewhere; the report is the copy the owner keeps.
- **Who sees what:** reports go to the owner only. Employees can ask the owner for their own check-in notes.

## 10. Checklist

- [ ] Owner gave role, people, time, questions, follow-up count, report time, escalation (on/off and
      rules), retention.
- [ ] Owner approved the consent wording.
- [ ] One room per employee: `create_meeting`, then `schedule_meeting` with a daily `RRULE` and `instructions`.
- [ ] Invites sent by you, through the owner's own channel, after the owner approved them.
- [ ] Something wakes you at each check-in time (your scheduler, or a `tail_events` loop).
- [ ] Run loop: consent, then questions and follow-ups, time box, a polite close, `leave_meeting`.
- [ ] Report sent in the format above; escalations only under the owner's rules.
