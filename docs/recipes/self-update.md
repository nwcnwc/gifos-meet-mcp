# Recipe: guard bots that update themselves

**Who reads this:** whoever runs two or more sibling guard bots (the same room, the same key, a different `rank`)
as systemd user services, and wants them to follow `main` without ever leaving the room unheld.

**What it does:** each bot runs one update round on a timer. The siblings' timers are half an hour apart (rank 0 at
:00, rank 1 at :30). A round:

1. Reads the tip of `main` in the update repo (by default this public repository). The same commit as now: done.
2. Refuses a commit that is not a fast-forward of the running one, or that failed here before. If
   `~/.config/gifos-guard/allowed_signers` exists, it also refuses a commit without a good signature from a key in
   that file. A new tip waits `GIFOS_UPDATE_SOAK_MIN` minutes (default 50) after this bot first saw it, so a hostile
   push can be caught before any bot runs it.
3. Builds the commit beside the live checkout (`~/gifos-meet-mcp.next`): `npm ci`, then `npm test`, in a clean
   environment that holds none of the bot's secrets. A failing build or test means no restart. A failed test marks
   the commit so it is not tried again.
4. Asks its own running bot (`guard_status`) whether a restart is safe. It is safe when the bot's own seat saw a
   sibling holding the room in the last `GIFOS_UPDATE_SIBLING_FRESH_SEC` seconds (default 20), or when the bot
   holds nothing itself, so its restart takes nothing away. Otherwise it skips the round.
5. Swaps: writes the new commit to the pin file, stops the service, moves the live checkout to
   `~/gifos-meet-mcp.prev` and the new one into its place, and starts the service. Downtime is a restart; nothing is
   built while the bot is down.
6. Waits up to `GIFOS_UPDATE_REJOIN_SEC` (default 300) for the bot to stand at least as well as before: holding the
   room if it held it, seated otherwise. If it is not back in time, the round puts the previous checkout back, pins
   it, starts it, and marks the new commit so it is not tried again. A newer commit on `main` is tried as usual.

The siblings never restart together: their rounds are 30 minutes apart, a round takes a few minutes, and a bot
whose sibling is restarting sees no sibling holding the room, so it skips that round.

Logs go to the journal: `journalctl --user -u gifos-meet-guard-update`. Every line starts with `self-update:`.
The bot's HTTP token is read only by the health probe and is never printed.

## Files

- `scripts/self-update.sh`: one round.
- `scripts/guard-health.mjs`: how the running bot stands (`guard_status` over its local MCP HTTP port). It needs
  `gifos-mcp-core` with `seated` and `sibling_seen_at` in `guard_status`.
- `examples/guard/gifos-meet-guard.service`: the bot. With `~/.config/gifos-guard/pin` it starts only on the
  pinned commit. The updater is the only thing that moves the pin.
- `examples/guard/gifos-meet-guard-update.service` and `.timer`: the round and its schedule.

## Settings

All of them are optional, in `~/.config/gifos-guard/update.env`:

| Setting | Default | |
|---|---|---|
| `PATH` | systemd's | Set it when `node` is not on the default PATH (nvm). |
| `GIFOS_UPDATE_REPO` | this repository on GitHub | Where `main` is read from. |
| `GIFOS_UPDATE_SOAK_MIN` | 50 | Minutes a new tip waits after this bot first saw it. |
| `GIFOS_UPDATE_REJOIN_SEC` | 300 | How long a restarted bot has to stand as well as before. |
| `GIFOS_UPDATE_SIBLING_FRESH_SEC` | 20 | How recent the sibling sighting must be. |
| `GIFOS_UPDATE_PORT` | 19520 | The bot's `--http` port. |
| `GIFOS_UPDATE_NPM_CI_FLAGS` | `--no-audit --no-fund --onnxruntime-node-install-cuda=skip` | |
| `GIFOS_UPDATE_DIR`, `GIFOS_UPDATE_SERVICE`, `GIFOS_UPDATE_PIN_FILE`, `GIFOS_UPDATE_GUARD_ENV`, `GIFOS_UPDATE_STATE`, `GIFOS_UPDATE_ALLOWED_SIGNERS` | the paths above | |

## Setup (per sibling)

```sh
cd ~/gifos-meet-mcp && git status --short                      # must be empty
printf 'GIFOS_GUARD_PIN=%s\n' "$(git rev-parse HEAD)" > ~/.config/gifos-guard/pin
cp examples/guard/gifos-meet-guard.service ~/.config/systemd/user/          # or add its pin lines to yours
cp examples/guard/gifos-meet-guard-update.service examples/guard/gifos-meet-guard-update.timer ~/.config/systemd/user/
# rank 1: run at :30 instead of :00
sed -i 's/^OnCalendar=.*/OnCalendar=*-*-* *:30:00/' ~/.config/systemd/user/gifos-meet-guard-update.timer
systemctl --user daemon-reload
systemctl --user restart gifos-meet-guard        # now on the pin file
systemctl --user enable --now gifos-meet-guard-update.timer
```

Run one round by hand: `systemctl --user start gifos-meet-guard-update` (it waits for the round to finish).
Pause updates: `systemctl --user stop gifos-meet-guard-update.timer`. A checkout with local changes, or not at the
pinned commit, is never touched: the round logs why and skips.

## Proof

`test/e2e/self-update-proof.sh <new dir>` runs two siblings in a fresh room on the live site, as user units made from
these examples, updating from a local origin on timers 3 minutes apart. It pushes two good versions, one with a
failing test, one that passes its tests but never takes its seat back, and a last good one, and
`test/e2e/self-update-score.mjs` checks that the room was held at every 2 s sample, no restarts overlapped, and each
version ended the way it should.
