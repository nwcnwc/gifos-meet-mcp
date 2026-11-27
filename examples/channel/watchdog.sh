#!/bin/bash
# Restart the channel when state/health.json is older than 120 s (channel.mjs writes it every 10 s while it runs),
# when the box has under 600 MB of memory available, or when the booth's browser profile grows past its cap.
# Acts only on its own user unit.
set -u
UNIT=${CHANNEL_UNIT:-gifos-channel}
ROOM=${CHANNEL_ROOM:?set CHANNEL_ROOM to the channel room name}
DIR=${CHANNEL_DIR:-$HOME/channel}
H=$DIR/state/health.json
CAP_MB=${CHANNEL_STATE_CAP_MB:-600}
systemctl --user is-active --quiet "$UNIT" || exit 0          # a dead process is Restart='s job
ts=$(systemctl --user show "$UNIT" -p ActiveEnterTimestampMonotonic --value)
up=$(( ( $(cut -d' ' -f1 /proc/uptime | cut -d. -f1) * 1000000 - ${ts:-0} ) / 1000000 ))
[ "$up" -lt 240 ] && exit 0                                     # a fresh start gets 4 minutes to go on air
age=999999; [ -f "$H" ] && age=$(( $(date +%s) - $(stat -c %Y "$H") ))
if [ "$age" -gt 120 ]; then echo "channel watchdog: health is ${age}s old: restarting"; systemctl --user restart "$UNIT"; exit 0; fi
avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
if [ "$avail" -lt 600 ]; then echo "channel watchdog: ${avail} MB available: restarting"; systemctl --user restart "$UNIT"; exit 0; fi
mb=$(du -sm "$DIR/state" | cut -f1)
if [ "$mb" -gt "$CAP_MB" ]; then
  echo "channel watchdog: state is ${mb} MB (cap $CAP_MB): clearing the browser cache and restarting"
  systemctl --user stop "$UNIT"
  rm -rf "$DIR/state/mcp-home/booth-$ROOM/Default/Cache" "$DIR/state/mcp-home/booth-$ROOM/Default/Code Cache"
  systemctl --user start "$UNIT"
fi
