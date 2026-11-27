# Run a 24/7 GifOS channel with MCP tools

A GifOS channel is a hosted broadcast that plays video on its Stage around the clock and is listed on
[gifos.tv](https://gifos.tv). This folder runs one from the tools of this MCP server. There is no language model in
the loop: `channel.mjs` is a small MCP client that calls the same tools any AI assistant can call. Ask your assistant
"run my videos as a channel on gifos.tv" and it makes the same calls.

The live demo, "GifOS TV (MCP demo)" on gifos.tv, runs this script on a Raspberry Pi.

## The calls

```json
{ "tool": "open_booth", "arguments": { "room": "my-channel", "host_password": "<from your vault>", "name": "My Channel", "credentials": "/path/plan.gif" } }
{ "tool": "play_video", "arguments": { "booth_id": "my-channel", "paths": ["/videos/a.webm", "/videos/b.webm"], "loop": true, "yield_to_people": true } }
{ "tool": "publish_to_tv", "arguments": { "booth_id": "my-channel", "title": "My Channel", "description": "Films all day.", "thumbnail_path": "/videos/thumb.jpg" } }
{ "tool": "booth_status", "arguments": { "booth_id": "my-channel" } }
```

- `open_booth` opens the broadcast's host seat in a headless browser on your computer. The room belongs to whoever
  knows the host password; a new room name becomes your hosted broadcast. Viewers' link: the `link` in the answer.
- `play_video` plays the files with the page's own Rebroadcast button, one after another, on a loop. It is made to
  run for days: bad spots are skipped, and a stuck video, a lost page or a new GifOS release reloads the page and goes
  on from the same second.
- `publish_to_tv` lists the broadcast on gifos.tv with a signed listing (the same one the /cast page's "Publish to
  GifOS.tv" button makes), and the page then keeps the listing live by itself. `update_tv_listing` changes a field,
  `stop_tv_listing` takes it off. Everything in a listing is public.

## Filler mode: people first

With `yield_to_people: true` the videos are filler. When a person takes the Stage (a co-host who opens the
broadcast link and signs in with the host password, or anyone the host lets up), the video stops and the booth steps
off the Stage at once, without fighting for it: the person does the show. When the Stage has been free of people for
1.5 seconds, the same video goes on from the second it stopped. `booth_status` shows `yielding_to` while a person has
the Stage. The gifos.tv listing stays live the whole time.

Measured on the demo channel (a co-host seat already in the room stepping onto and off the Stage, viewers on other
computers): the booth gave way 0.7 s after the person stepped up (viewers saw and heard the person about 1 s after),
and the film was back 2.3 s after they stepped down (about 4 s for viewers). A person who has just joined is seen once
their seat links to the booth's, a few seconds after they arrive.

## Run it

1. Install this server (`npm install --ignore-scripts` in a checkout) and a Chrome or Chromium.
2. Make a folder with `channel.json` (copy `channel.example.json`), `host.pw` (the host password, mode 0600), your
   videos, and optionally a credentials GIF and a thumbnail picture. Videos: WebM (VP8/Opus) or MP4 at 640x360 play
   well on small computers; long files ("reels") give the fewest switches.
3. Try it: `node examples/channel/channel.mjs /path/channel.json`. It logs one JSON line per event.
4. Keep it running: copy the three systemd units here to `~/.config/systemd/user/`, edit the paths, the room name
   in the watchdog unit and, if node is not on the default path, `ExecStart`. Then
   `systemctl --user enable --now gifos-channel gifos-channel-watchdog.timer` and `loginctl enable-linger $USER`.

What keeps it on air:
- `channel.mjs` exits when the booth reports it stopped, or nothing went out for 3 minutes; systemd starts it again
  (`Restart=always`), and the new run starts the same video at the second the last one reached.
- `watchdog.sh` (every minute) restarts it when `state/health.json` is over 2 minutes old, when the computer has
  under 600 MB of memory free, or when the browser profile grows past 600 MB (it clears the cache first).
- The booth itself reloads its page for stuck video, a lost page or a new GifOS release (above).

Files in `state/`: `health.json` (every 10 s: host, relay, on air, the video and second, the gifos.tv listing,
counts), `position.json` (where to resume), `listed.json` (the title and description last listed) and `mcp-home/`
(the server's home: the booth's browser profile with its host key, credentials and listing mark; keep it private).

Use only videos you have the rights to show. The demo plays public-domain films.
