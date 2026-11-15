// The tools only gifos-meet-mcp has: make a meeting (with everything an
// invite needs), put the bot in it, and the bot's hand, microphone and
// camera. Transcripts, speaking, chat, leaving and the join schedule are the
// shared tools from gifos-mcp-core.
import fs from 'node:fs';
import { z } from 'zod';
import {
  meetingId, newRoom, hostKey, meetingLink, plainLink, meetingInvite, publicView, scrub, instructionsField, cleanInstructions, assertNotPast,
  CAMERA_GAP, HAND_GAP, MIC_GAP, registerRoomTools,
} from 'gifos-mcp-core';
import { attachTalk, PLAIN } from './talk.js';
import { MeetingArchive, archiveConfig } from './archive.js';
import { HostPasswords, strongPassword } from './host-passwords.js';

export function registerMeetTools(server, ctx) {
  const { cfg, meetings, schedule, holdPhase, ok, fail, guarded, need, needLive, enterByHand, joinByLink, instructionsFor, secrets, control, bot } = ctx;

  // The owner's instructions for a meeting made here, stored on it (and on
  // its open order, which update_schedule changes) and handed back by
  // meeting_status. undefined leaves them as they are.
  function setInstructions(m, given) {
    if (given === undefined) return;
    const clean = cleanInstructions(given);
    meetings.update(m.meeting_id, { instructions: clean });
    const order = schedule.forMeeting(m.meeting_id);
    if (order) holdPhase(order, { instructions: clean });
  }
  // Admin rooms made here without a given password keep the one this server made (src/host-passwords.js); the bot
  // signs in with it on every join, and sign_in_as_host finds it too.
  const hostPasswords = new HostPasswords(cfg.home);
  ctx.hostPasswordFor = (room) => hostPasswords.get(room);
  const talk = attachTalk(server, ctx);
  const archive = attachArchive(ctx);
  // A host password given on a join signs the bot in as host right away (GifOS
  // 0.9.26 keeps a host room closed until a host is there). It is used once and
  // never echoed: a failure comes back as host_error with the password cut out.
  async function signInHost(m, given) {
    const pw = given || hostPasswords.get(m.room);
    if (!pw) return {};
    try {
      const v = await bot.room(m.session_id, 'host.signin', { password: pw });
      return v && v.bot_is_host ? { bot_is_host: true } : { bot_is_host: false };
    } catch (e) {
      return { bot_is_host: false, host_error: scrub(String((e && e.message) || e).split(pw).join('***'), secrets().concat(pw)) };
    }
  }
  // The agenda, apps (Take Turns), the stage and host sign-in (GifOS 0.9.26).
  registerRoomTools(server, ctx, { name: 'gifos-meet-mcp' });

  server.registerTool('create_meeting', {
    title: 'Create a GifOS meeting (link and invite details, no join)',
    description: 'Mints a GifOS meeting and returns its link plus everything an invite needs: title, start and end with time zone, the join link, description, how guests get in, and who does what, as fields and as ready-to-send text. Nothing joins and nothing is sent: you send the invite with your own mail or calendar, and call start_meeting or schedule_meeting when the bot should be there. type picks the room: open (default; anyone with the link) or admin (a room with a host and host controls). AN ADMIN ROOM CANNOT BE MADE WITHOUT AN ADMIN (HOST) PASSWORD: its signature goes into the link and is what makes the room an admin room. If the user gives one, pass it as host_password: it is used for this call only, never stored, logged or returned. If the user asks for an admin room and gives NO password, do not invent one and do not ask: leave host_password out and this server makes a strong random one, keeps it in its own 0600 file (the answer\'s host_password.kept_in), signs the bot in with it on start_meeting and join_meeting, and never shows it. Tell the user it was made and where it is kept; call get_host_password only if the user asks to see it. room_password is a different thing: the password guests type to get in (who may enter); it appears in the invite text and never in the link. Defaults for a plain request: "a call / test call" = type admin with no host_password; "with a password" = a room_password (the user\'s, or a readable three-word one you make), which goes in the join info you send them with the link and one line on how to join (open the link, type the password when asked); a short name such as "Test call" if none is given. Do not ask what these defaults answer. instructions, when given, are the owner\'s goal for the bot in this meeting; start_meeting and meeting_status hand them back. A start that has already passed (more than 15 minutes ago) or is not a real date is refused.',
    inputSchema: {
      name: z.string().min(1).max(200).describe('The meeting title.'),
      type: z.enum(['open', 'admin']).optional().describe('open (default): anyone with the link joins. admin: a room with a host (host controls: room password, who may present, the agenda). An admin room always has a host password: the user\'s (host_password), or one this server makes and keeps when host_password is left out.'),
      host_password: z.string().min(1).max(200).optional().describe('The admin (host) password the USER gave for an admin room. Used for this call only; never stored or returned. Leave it out when the user gave none: the server makes a strong one and keeps it.'),
      admin_password: z.string().min(1).max(200).optional().describe('Older name of host_password; same meaning.'),
      start: z.string().max(64).optional().describe('Start time: ISO with an offset, or a local time such as 2026-10-20T17:00 read in timezone.'),
      end: z.string().max(64).optional().describe('End time, same forms. Default start plus one hour.'),
      timezone: z.string().max(80).optional().describe('IANA time zone, for example America/Los_Angeles. Default UTC.'),
      description: z.string().max(4000).optional().describe('Agenda or notes for the invite.'),
      room_password: z.string().min(1).max(200).optional().describe('The password guests type to get in. Put it in the invite; it is never part of the link.'),
      host_name: z.string().max(80).optional().describe('Who hosts, for the invite text.'),
      instructions: instructionsField,
    },
  }, async (args) => {
    let hostPw = args.host_password || args.admin_password || '';
    const hidden = () => secrets().concat(hostPw ? [hostPw] : []);
    try {
      const type = args.type || (hostPw ? 'admin' : 'open');
      const made = type === 'admin' && !hostPw;
      if (made) hostPw = strongPassword();
      if (type === 'open' && hostPw) throw new Error('host_password makes an admin room; pass type admin, or leave the password out for an open room.');
      const room = newRoom();
      const key = type === 'admin' ? await hostKey(room, hostPw) : null;
      const link = plainLink(meetingLink(cfg.gifosUrl, room, { relay: cfg.relay, verifier: key && key.verifier }), args.room_password || '');
      const invite = meetingInvite({
        title: args.name, link, start: args.start, end: args.end, timezone: args.timezone,
        description: args.description, roomPassword: args.room_password, hostName: args.host_name,
      });
      assertNotPast(invite);
      const goal = args.instructions === undefined ? '' : cleanInstructions(args.instructions);
      const m = meetings.add({ topic: args.name, room, link, start_time: invite.start ? invite.start.iso : null, ...(goal ? { instructions: goal } : {}) });
      if (made) hostPasswords.keep(room, hostPw, { meeting_id: m.meeting_id, name: String(args.name).slice(0, 200) });
      const kept = made ? { host_password: { made: true, kept_in: hostPasswords.file, note: 'No host password was given, so this server made a strong random one and keeps it in kept_in (mode 0600). It is not shown here. The bot signs in as host with it on start_meeting and join_meeting. Tell the user where it is kept; call get_host_password only if the user asks to see it.' } } : {};
      const body = JSON.stringify({ meeting_id: m.meeting_id, link, host_runs_room: !!key, invite, ...kept, ...(goal ? { instructions: goal } : {}) }, null, 2);
      return { content: [{ type: 'text', text: scrub(body, hidden()) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: scrub(String((e && e.message) || e), hidden()) }] };
    }
  });

  server.registerTool('get_host_password', {
    title: 'Show the host password this server made',
    description: 'Returns the admin (host) password this server made and keeps for an admin room created with no host_password. Call it ONLY when the user explicitly asks to see the password; never put it in chat, an invite or a link otherwise. A password the user gave is never kept, so it cannot be read back.',
    inputSchema: { meeting_id: meetingId },
  }, guarded(async ({ meeting_id }) => {
    const m = need(meeting_id);
    const pw = hostPasswords.get(m.room);
    if (!pw) throw new Error('This server keeps no host password for that meeting (it is an open room, or the user gave the password).');
    return { content: [{ type: 'text', text: JSON.stringify({ meeting_id: m.meeting_id, host_password: pw, kept_in: hostPasswords.file }, null, 2) }] };
  }));

  const languageField = z.string().min(2).max(12).regex(/^(auto|[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?)$/).optional()
    .describe('The language people speak, for the transcript: auto (default, Whisper detects it) or a code such as ru, es or pt-BR.');

  server.registerTool('start_meeting', {
    title: 'Start a meeting (the bot joins and transcribes)',
    description: 'The headless Meeting Bot joins the meeting made with create_meeting now and starts transcribing. Everyone sees it as a tile labelled 🤖 bot. Pass the room password if the invite has one. ' + PLAIN + ' Pass talk:true to start the listen and respond loop. With talk left off, the bot does not answer. instructions, when given, set the owner\'s goal for this meeting (as on create_meeting); meeting_status hands them back.',
    inputSchema: {
      meeting_id: meetingId,
      room_password: z.string().min(1).max(200).optional().describe('The room password guests type, if the meeting has one.'),
      host_password: z.string().min(1).max(200).optional().describe('In an admin room: the host password, so the bot signs in as host on joining (GifOS 0.9.26 keeps a host room closed to guests until a host is there). Used once, never stored or returned. Leave it out for an admin room this server made: it signs in with the password it keeps.'),
      instructions: instructionsField,
      language: languageField,
      talk: z.boolean().optional().describe(PLAIN + ' true starts the listen and respond loop and hands you each addressed line.'),
    },
  }, guarded(async ({ meeting_id, room_password, host_password, instructions, language, talk: talkOn }) => {
    const m = need(meeting_id);
    if (language !== undefined) meetings.update(m.meeting_id, { language });
    setInstructions(m, instructions);
    const withGoal = (view) => {
      const goal = instructionsFor(meetings.get(m.meeting_id));
      if (goal) view.instructions = goal;
      return view;
    };
    if (m.state === 'live') {
      if (talkOn === true) await talk.arm(m.meeting_id);
      const view = withGoal({ ...publicView(meetings.get(m.meeting_id)), note: 'Already live.' });
      Object.assign(view, await signInHost(meetings.get(m.meeting_id), host_password));
      if (talkOn === true) {
        view.talk = true;
        view.note = 'Already live. ' + PLAIN + ' Call wait_for_speech; it blocks until someone addresses the bot.';
      }
      return ok(view);
    }
    const joined = await enterByHand(meetings.get(m.meeting_id), room_password);
    const view = withGoal(publicView(joined));
    Object.assign(view, await signInHost(joined, host_password));
    if (talkOn === true) {
      await talk.arm(joined.meeting_id);
      view.talk = true;
      view.note = PLAIN + ' Call wait_for_speech; it blocks until someone addresses the bot. A talk notification carries the same line.';
    }
    return ok(view);
  }));

  server.registerTool('join_meeting', {
    title: 'Join an existing GifOS meeting by link',
    description: 'The Meeting Bot joins a GifOS meeting now and starts transcribing. A join at a later time is schedule_meeting, not this tool. The room password is kept on the schedule when one is passed, and is never returned. instructions, when given, are the owner\'s goal for this meeting, handed back to you by meeting_status; without them the bot only transcribes. ' + PLAIN + ' Pass talk:true to start the listen and respond loop. With talk left off, the bot does not answer.',
    inputSchema: {
      link: z.string().url().max(2048).describe('The GifOS meeting link.'),
      password: z.string().max(200).optional().describe('The room password guests type, if the meeting has one.'),
      host_password: z.string().min(1).max(200).optional().describe('In an admin room: the host password, so the bot signs in as host on joining (GifOS 0.9.26 keeps a host room closed to guests until a host is there). Used once, never stored or returned. Leave it out for an admin room this server made: it signs in with the password it keeps.'),
      topic: z.string().max(200).optional().describe('A name for this meeting in the local list.'),
      instructions: instructionsField,
      language: languageField,
      talk: z.boolean().optional().describe(PLAIN + ' true starts the listen and respond loop and hands you each addressed line.'),
    },
  }, guarded(async ({ link, password, host_password, topic, instructions, language, talk: talkOn }) => {
    const { meeting, note } = await joinByLink(link, password, topic, instructions, { language });
    const view = publicView(meeting);
    Object.assign(view, await signInHost(meeting, host_password));
    const goal = instructionsFor(meeting);
    if (goal) view.instructions = goal;
    if (talkOn === true) {
      await talk.arm(meeting.meeting_id);
      view.talk = true;
      const extra = PLAIN + ' Call wait_for_speech; it blocks until someone addresses the bot. A talk notification carries the same line.';
      view.note = note ? note + ' ' + extra : extra;
    }
    return ok(note && talkOn !== true ? { ...view, note } : view);
  }));

  server.registerTool('raise_hand', {
    title: 'Raise or lower the bot hand',
    description: 'Asks Meeting Bot to raise its hand when on is true, and to lower it when on is false. Contract version 1 has no hand control, and then this reports the gap.',
    inputSchema: {
      meeting_id: meetingId,
      on: z.boolean().describe('true to raise, false to lower.'),
    },
  }, guarded(async ({ meeting_id, on }) => {
    const m = needLive(meeting_id);
    const raised = await control('raiseHand', HAND_GAP, () => bot.raiseHand(m.session_id, on));
    return ok({ meeting_id: m.meeting_id, hand: !!on, result: raised.result == null ? null : raised.result });
  }));

  server.registerTool('set_mic', {
    title: 'Turn the Meeting Bot microphone on or off',
    description: 'Turns Meeting Bot\'s microphone on or off. mute and unmute only stop or start captions; they do not touch this microphone. Contract version 1 gives the bot no microphone, and then this reports the gap. ' + PLAIN,
    inputSchema: {
      meeting_id: meetingId,
      on: z.boolean().describe('true to unmute, false to mute.'),
    },
  }, guarded(async ({ meeting_id, on }) => {
    const m = needLive(meeting_id);
    const mic = await control('setMic', MIC_GAP, () => bot.setMic(m.session_id, on));
    return ok({ meeting_id: m.meeting_id, mic: !!on, result: mic.result == null ? null : mic.result });
  }));

  server.registerTool('set_camera', {
    title: 'Turn the Meeting Bot camera on or off',
    description: 'Asks Meeting Bot to show its camera when on is true, and to turn it off when on is false. Contract version 1 has no camera, and then this reports the gap.',
    inputSchema: {
      meeting_id: meetingId,
      on: z.boolean().describe('true to show the camera, false to turn it off.'),
    },
  }, guarded(async ({ meeting_id, on }) => {
    const m = needLive(meeting_id);
    const cam = await control('setCamera', CAMERA_GAP, () => bot.setCamera(m.session_id, on));
    return ok({ meeting_id: m.meeting_id, camera: !!on, result: cam.result == null ? null : cam.result });
  }));

  // Recording. The Meeting Bot shows ⏺ recording on its tile to everyone in
  // the room while it records; these tools do not hide or change that.
  const recCall = (method) => {
    if (typeof bot[method] !== 'function') throw new Error('This bot has no ' + method + ' method; update gifos-mcp-core.');
    return (...a) => bot[method](...a);
  };
  server.registerTool('list_past_meetings', {
    title: 'List archived meetings (recordings and transcripts)',
    description: 'Every meeting this server has joined, newest first, from its folder on disk (survives restarts): meeting_id, topic, start and end, state, recording segment count, transcript line count, and the folder path.',
    inputSchema: { limit: z.number().int().min(1).max(500).optional().describe('At most this many (default 50).') },
  }, guarded(async ({ limit }) => {
    const rows = archive.list().slice(0, limit || 50).map((r) => ({
      meeting_id: r.meta.meeting_id, topic: r.meta.topic, started_at: r.meta.started_at, ended_at: r.meta.ended_at, state: r.meta.state,
      segments: (r.meta.segments || []).length, bytes: (r.meta.segments || []).reduce((a, x) => a + (x.size || 0), 0),
      transcript_lines: r.meta.transcript_lines == null ? null : r.meta.transcript_lines, folder: r.folder,
    }));
    return ok({ root: archive.root, meetings: rows });
  }));

  server.registerTool('get_past_meeting', {
    title: 'Get an archived meeting (recording paths and transcript)',
    description: 'One archived meeting by meeting_id or folder name: its metadata, the local path of each recording segment (WebM, in order), and the transcript files. include_transcript returns the transcript text too.',
    inputSchema: {
      meeting_id: z.string().min(1).max(200).describe('meeting_id or folder name from list_past_meetings.'),
      include_transcript: z.boolean().optional().describe('Also return transcript.md text (up to 200 KB).'),
    },
  }, guarded(async ({ meeting_id, include_transcript }) => {
    const past = archive.get(meeting_id);
    if (include_transcript) {
      try { past.transcript = fs.readFileSync(past.transcript_md, 'utf8').slice(0, 200000); } catch (e) { past.transcript = null; }
    }
    return ok(past);
  }));

  const REC_NOTE = 'Everyone in the room sees the ⏺ recording indicator on the bot while it records.';
  server.registerTool('start_recording', {
    title: 'Start recording the meeting',
    description: 'Meeting Bot starts recording the meeting (audio and video of the room, usually WebM). ' + REC_NOTE + ' stop_recording stops it; get_recording saves the file locally.',
    inputSchema: { meeting_id: meetingId },
  }, guarded(async ({ meeting_id }) => {
    const m = needLive(meeting_id);
    const r = archive.live.has(m.meeting_id) ? (await archive.startRecording(m.meeting_id), { rec: true }) : await recCall('startRecording')(m.session_id);
    return ok({ meeting_id: m.meeting_id, recording: true, rec: r && r.rec != null ? !!r.rec : true, note: REC_NOTE });
  }));

  server.registerTool('stop_recording', {
    title: 'Stop recording the meeting',
    description: 'Meeting Bot stops recording and keeps the file on this computer. get_recording saves it to a local path.',
    inputSchema: { meeting_id: meetingId },
  }, guarded(async ({ meeting_id }) => {
    const m = needLive(meeting_id);
    if (archive.live.has(m.meeting_id)) {
      const meta = await archive.stopRecording(m.meeting_id);
      const seg = meta && meta.segments.at(-1);
      return ok({ meeting_id: m.meeting_id, recording: false, saved: seg ? { file: seg.file, size: seg.size } : null, folder: archive.live.get(m.meeting_id).dir });
    }
    const r = await recCall('stopRecording')(m.session_id);
    return ok({ meeting_id: m.meeting_id, recording: false, rec: r && r.rec != null ? !!r.rec : false });
  }));

  server.registerTool('get_recording', {
    title: 'Save the meeting recording to a local file',
    description: 'Fetches the meeting recording from Meeting Bot and saves it on this computer. Stops recording first if it is still on. Returns path, name, mime and size in bytes. The file stays local; nothing is uploaded.',
    inputSchema: { meeting_id: meetingId },
  }, guarded(async ({ meeting_id }) => {
    const m = needLive(meeting_id);
    if (archive.live.has(m.meeting_id)) {
      await archive.stopRecording(m.meeting_id);
      const past = archive.get(m.meeting_id);
      const seg = past.segments.at(-1);
      if (!seg) throw new Error('There is no recording for this meeting yet.');
      return ok({ meeting_id: m.meeting_id, path: seg.path, name: seg.file, mime: seg.mime, size: seg.size, recording: false, segments: past.segments.map((x) => x.path), folder: past.folder });
    }
    const f = await recCall('getRecording')(m.session_id);
    return ok({ meeting_id: m.meeting_id, path: f.path, name: f.name, mime: f.mime, size: f.size, recording: false });
  }));
}

// One archive per context, hooked into its joins and leaves.
export function attachArchive(ctx) {
  if (ctx.archive) return ctx.archive;
  const archive = new MeetingArchive({ home: ctx.cfg.home, bot: ctx.bot, transcript: ctx.transcript, opts: { ...archiveConfig(), ...(ctx.cfg.archive || {}) } });
  ctx.archive = archive;
  if (ctx.hooks) {
    ctx.hooks.joined.push((m) => archive.joined(m));
    ctx.hooks.leaving.push((m) => archive.leaving(m));
  }
  return archive;
}
