// The tools only gifos-meet-mcp has: make a meeting (with everything an
// invite needs), put the bot in it, and the bot's hand, microphone and
// camera. Transcripts, speaking, chat, leaving and the join schedule are the
// shared tools from gifos-mcp-core.
import { z } from 'zod';
import {
  meetingId, newRoom, hostKey, meetingLink, plainLink, meetingInvite, publicView, scrub,
  CAMERA_GAP, HAND_GAP, MIC_GAP,
} from 'gifos-mcp-core';

export function registerMeetTools(server, ctx) {
  const { cfg, meetings, ok, fail, guarded, need, needLive, enterByHand, joinByLink, secrets, control, bot } = ctx;

  server.registerTool('create_meeting', {
    title: 'Create a GifOS meeting (link and invite details, no join)',
    description: 'Mints a GifOS meeting and returns its link plus everything an invite needs: title, start and end with time zone, the join link, description, how guests get in, and who does what, as fields and as ready-to-send text. Nothing joins and nothing is sent: you send the invite with your own mail or calendar, and call start_meeting or schedule_meeting when the bot should be there. admin_password is the human host\'s password for this call only (it makes a room they run); it is not stored, not logged and not returned. room_password, when given, is the password guests type; it appears in the invite text and never in the link.',
    inputSchema: {
      name: z.string().min(1).max(200).describe('The meeting title.'),
      admin_password: z.string().min(1).max(200).optional().describe('The human host\'s password. With it the room is one they run (host controls). Used for this call only; never stored or returned.'),
      start: z.string().max(64).optional().describe('Start time: ISO with an offset, or a local time such as 2026-10-20T17:00 read in timezone.'),
      end: z.string().max(64).optional().describe('End time, same forms. Default start plus one hour.'),
      timezone: z.string().max(80).optional().describe('IANA time zone, for example America/Los_Angeles. Default UTC.'),
      description: z.string().max(4000).optional().describe('Agenda or notes for the invite.'),
      room_password: z.string().min(1).max(200).optional().describe('The password guests type to get in. Put it in the invite; it is never part of the link.'),
      town_hall: z.boolean().optional().describe('A town hall: guests watch and listen, the host brings people up to speak.'),
      host_name: z.string().max(80).optional().describe('Who hosts, for the invite text.'),
    },
  }, async (args) => {
    const hidden = () => secrets().concat(args.admin_password || '');
    try {
      const room = newRoom();
      const key = args.admin_password ? await hostKey(room, args.admin_password) : null;
      const link = plainLink(meetingLink(cfg.gifosUrl, room, { relay: cfg.relay, verifier: key && key.verifier, townHall: !!args.town_hall }), args.room_password || '');
      const invite = meetingInvite({
        title: args.name, link, start: args.start, end: args.end, timezone: args.timezone,
        description: args.description, roomPassword: args.room_password, hostName: args.host_name, townHall: !!args.town_hall,
      });
      const m = meetings.add({ topic: args.name, room, link, start_time: invite.start ? invite.start.iso : null });
      const body = JSON.stringify({ meeting_id: m.meeting_id, link, host_runs_room: !!key, invite }, null, 2);
      return { content: [{ type: 'text', text: scrub(body, hidden()) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: scrub(String((e && e.message) || e), hidden()) }] };
    }
  });

  server.registerTool('start_meeting', {
    title: 'Start a meeting (the bot joins and transcribes)',
    description: 'The headless Meeting Bot joins the meeting made with create_meeting now and starts transcribing. Everyone sees it as a tile labelled 🤖 bot. Pass the room password if the invite has one.',
    inputSchema: {
      meeting_id: meetingId,
      room_password: z.string().min(1).max(200).optional().describe('The room password guests type, if the meeting has one.'),
    },
  }, guarded(async ({ meeting_id, room_password }) => {
    const m = need(meeting_id);
    if (m.state === 'live') return ok({ ...publicView(m), note: 'Already live.' });
    return ok(publicView(await enterByHand(m, room_password)));
  }));

  server.registerTool('join_meeting', {
    title: 'Join an existing GifOS meeting by link',
    description: 'The Meeting Bot joins a GifOS meeting now and starts transcribing. A join at a later time is schedule_meeting, not this tool. The room password is kept on the schedule when one is passed, and is never returned.',
    inputSchema: {
      link: z.string().url().max(2048).describe('The GifOS meeting link.'),
      password: z.string().max(200).optional().describe('The room password guests type, if the meeting has one.'),
      topic: z.string().max(200).optional(),
    },
  }, guarded(async ({ link, password, topic }) => {
    const { meeting, note } = await joinByLink(link, password, topic);
    return ok(note ? { ...publicView(meeting), note } : publicView(meeting));
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
    description: 'Turns Meeting Bot\'s microphone on or off. mute and unmute only stop or start captions; they do not touch this microphone. Contract version 1 gives the bot no microphone, and then this reports the gap.',
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
    title: 'Turn the Meet Bot camera on or off',
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
}
