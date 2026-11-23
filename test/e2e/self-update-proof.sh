#!/usr/bin/env bash
# Live proof of scripts/self-update.sh: two sibling guard bots (systemd user units made from examples/guard/*) hold one
# fresh room on the live site, each updating itself from an origin this script controls, on timers 3 minutes apart.
#
#   test/e2e/self-update-proof.sh <new empty work dir (absolute)> [source repo, default this checkout]
#   Env: MEETJS=<gifos checkout>/test/swarm/meet.js  an observer seat that lists who is in the room every 30 s.
#
# Versions pushed to the origin, in order (each waits until both bots have dealt with the one before):
#   v2, v3  good                      both bots update, one at a time
#   v4      a unit test fails         both bots skip it (never restart)
#   v5      tests pass, no guard runs both bots roll back to v3 (the bot does not take its seat back in time)
#   v6      good                      both bots update
# The room is held while at least one bot reports holding it (lead/coadmin) in its own guard_status; monitor.log
# samples both every 2 s. score.mjs checks: held at every sample after both first sat, no restart windows overlap,
# and each version ended the way it should. Units and files live only under the work dir and ~/.config/systemd/user
# (botupd-*), and `stop` removes the units again:
#   test/e2e/self-update-proof.sh stop <work dir>
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
units=$HOME/.config/systemd/user
if [ "${1:-}" = stop ]; then
  W=$2
  for x in A B; do systemctl --user stop "botupd-update-$x.timer" "botupd-update-$x.service" "botupd-guard-$x.service" 2>/dev/null; done
  [ -f "$W/monitor.pid" ] && kill "$(cat "$W/monitor.pid")" 2>/dev/null
  [ -f "$W/observer.pid" ] && kill "$(cat "$W/observer.pid")" 2>/dev/null
  for x in A B; do rm -f "$units/botupd-guard-$x.service" "$units/botupd-update-$x.service" "$units/botupd-update-$x.timer"; done
  systemctl --user daemon-reload; echo stopped; exit 0
fi
W=${1:?work dir}; SRC=${2:-$(cd "$here/../.." && pwd)}
case "$W" in /*) ;; *) echo "work dir must be absolute"; exit 2 ;; esac
[ -e "$W" ] && { echo "$W exists: give a new folder"; exit 2; }
mkdir -p "$W" && cd "$W" || exit 2
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$W/proof.log"; }
rnd() { head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

START=$(git -C "$SRC" rev-parse HEAD); T0=$(date +%s)
git clone -q --bare "$SRC" origin.git && git -C origin.git update-ref refs/heads/main "$START"
git clone -q origin.git work && git -C work checkout -q main
ROOM=botupd$(rnd | cut -c1-8); HOSTPW=hp-$(rnd)
say "room https://gifos.app/meet/$ROOM start ${START:0:7}"
echo "$ROOM" > room.txt

PORTS=(A:19621 B:19622)
for xp in "${PORTS[@]}"; do
  x=${xp%%:*}; port=${xp##*:}; rank=$([ "$x" = A ] && echo 0 || echo 1); minute=$([ "$x" = A ] && echo 0 || echo 3)
  mkdir -p "$x/config" "$x/state" "$x/selfupdate" && chmod 700 "$x/config"
  git clone -q origin.git "$x/gifos-meet-mcp" && git -C "$x/gifos-meet-mcp" checkout -q --detach "$START"
  ( cd "$x/gifos-meet-mcp" && npm ci --no-audit --no-fund --onnxruntime-node-install-cuda=skip >/dev/null 2>&1 ) || { say "npm ci failed for $x"; exit 1; }
  printf '{"guards":[{"link":"https://gifos.app/meet/%s","mode":"admin","host_password":"%s","greet":false,"blur_all":false,"rank":%s}]}\n' "$ROOM" "$HOSTPW" "$rank" > "$x/config/guard.json"
  cat > "$x/config/env" <<EOF
GIFOS_BOT_NAME=Upd Bot $x
GIFOS_BOT_PASSWORD=bp-$(rnd)
GIFOS_BOT_SIBLING=1
GIFOS_TTS_ENGINE=none
GIFOS_STT_APP=none
GIFOS_ALWAYS_TRANSCRIBE=0
GIFOS_ALWAYS_RECORD=0
GIFOS_MCP_HTTP_TOKEN=tk-$(rnd)
GIFOS_MCP_HOME=$W/$x/state
GIFOS_GUARD_CONFIG=$W/$x/config/guard.json
EOF
  printf 'GIFOS_GUARD_PIN=%s\n' "$START" > "$x/config/pin"
  cat > "$x/config/update.env" <<EOF
PATH=$(dirname "$(command -v node)"):/usr/bin:/bin
GIFOS_UPDATE_DIR=$W/$x/gifos-meet-mcp
GIFOS_UPDATE_SERVICE=botupd-guard-$x.service
GIFOS_UPDATE_REPO=$W/origin.git
GIFOS_UPDATE_PIN_FILE=$W/$x/config/pin
GIFOS_UPDATE_GUARD_ENV=$W/$x/config/env
GIFOS_UPDATE_PORT=$port
GIFOS_UPDATE_STATE=$W/$x/selfupdate
GIFOS_UPDATE_SOAK_MIN=0
GIFOS_UPDATE_REJOIN_SEC=120
EOF
  chmod 600 "$x/config/env"
  ex="$SRC/examples/guard"
  sed -e "s#%h/gifos-meet-mcp#$W/$x/gifos-meet-mcp#g" -e "s#%h/.config/gifos-guard#$W/$x/config#g" \
      -e "s#^Description=.*#Description=self-update proof guard $x#" \
      -e "s#^ExecStart=.*#ExecStart=$(command -v node) bin/gifos-meet-mcp.js --http $port#" "$ex/gifos-meet-guard.service" > "$units/botupd-guard-$x.service"
  sed -e "s#%h/gifos-meet-mcp#$W/$x/gifos-meet-mcp#g" -e "s#%h/.config/gifos-guard#$W/$x/config#g" \
      -e "s#^Description=.*#Description=self-update proof round $x#" "$ex/gifos-meet-guard-update.service" > "$units/botupd-update-$x.service"
  sed -e "s#^OnCalendar=.*#OnCalendar=*-*-* *:$minute/6:00#" -e "s#^Description=.*#Description=self-update proof timer $x#" \
      "$ex/gifos-meet-guard-update.timer" > "$units/botupd-update-$x.timer"
done
cp "$SRC/scripts/guard-health.mjs" "$W/guard-health.mjs"
systemctl --user daemon-reload
systemctl --user start botupd-guard-A.service; say "guard A started (rank 0)"; sleep 60
systemctl --user start botupd-guard-B.service; say "guard B started (rank 1)"

# Monitor: both bots' own view every 2 s.
( while :; do
    a=$(node "$W/guard-health.mjs" --port 19621 --env "$W/A/config/env"); b=$(node "$W/guard-health.mjs" --port 19622 --env "$W/B/config/env")
    echo "$(date -u +%FT%T.%3NZ) A=$a B=$b pinA=$(sed -n 's/^GIFOS_GUARD_PIN=//p' "$W/A/config/pin" | cut -c1-7) pinB=$(sed -n 's/^GIFOS_GUARD_PIN=//p' "$W/B/config/pin" | cut -c1-7)"
    sleep 2
  done ) >> "$W/monitor.log" 2>&1 &
echo $! > "$W/monitor.pid"
if [ -n "${MEETJS:-}" ]; then
  script=$(for i in $(seq 1 200); do printf 'who; sleep 30; '; done)
  ( cd "$(dirname "$MEETJS")/../.." && node test/swarm/meet.js --room "$ROOM" --name "Observer" --script "$script" > "$W/observer.log" 2>&1 ) &
  echo $! > "$W/observer.pid"
fi

holding() { node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(v.level===3?0:1)' <<<"$(node "$W/guard-health.mjs" --port "$1" --env "$W/$2/config/env")"; }
waitfor() {   # $1 = description, $2 = seconds, rest = command
  local what=$1 secs=$2; shift 2; local end=$(( $(date +%s) + secs ))
  while [ "$(date +%s)" -lt "$end" ]; do "$@" && { say "ok: $what"; return 0; }; sleep 5; done
  say "TIMEOUT: $what"; return 1
}
both_hold() { holding 19621 A && holding 19622 B; }
waitfor "both bots hold the room" 300 both_hold || exit 1
systemctl --user start botupd-update-A.timer botupd-update-B.timer; say "timers on (A at :00/6, B at :03/6)"

pin() { sed -n 's/^GIFOS_GUARD_PIN=//p' "$W/$1/config/pin"; }
on() { [ "$(pin A)" = "$1" ] && [ "$(pin B)" = "$1" ]; }
bad_both() { [ -e "$W/A/selfupdate/bad-$1" ] && [ -e "$W/B/selfupdate/bad-$1" ]; }
push() {   # $1 = label, $2 = a function that changes the work tree
  ( cd "$W/work" && "$2" && git add -A && git -c user.name=proof -c user.email=proof@example.invalid commit -q -m "proof $1" && git push -q origin main ) || { say "push $1 failed"; exit 1; }
  LAST=$(git -C "$W/work" rev-parse HEAD); say "pushed $1 ${LAST:0:7}"; echo "$1 $LAST" >> "$W/versions.txt"
}
on_hold() { on "$1" && both_hold; }
mk_v2() { echo v2 > docs/self-update-proof.txt; }
mk_v3() { echo v3 > docs/self-update-proof.txt; }
mk_v4() {   # a unit test fails
  echo "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('proof: a broken version', () => assert.equal(1, 2));" > test/unit/proof-broken.test.js
  sed -i 's#test/unit/self-update.test.js"#test/unit/self-update.test.js test/unit/proof-broken.test.js"#' package.json
}
mk_v5() {   # tests pass, but the bot starts no guard: it never takes its seat back
  git rm -q test/unit/proof-broken.test.js && sed -i 's# test/unit/proof-broken.test.js##' package.json
  sed -i 's#^await runMain#delete process.env.GIFOS_GUARD_CONFIG; await runMain#' bin/gifos-meet-mcp.js
}
mk_v6() { sed -i 's#^delete process.env.GIFOS_GUARD_CONFIG; await runMain#await runMain#' bin/gifos-meet-mcp.js && echo v6 > docs/self-update-proof.txt; }
push v2 mk_v2; waitfor "both on v2 and holding" 1500 on_hold "$LAST"
push v3 mk_v3; waitfor "both on v3 and holding" 1500 on_hold "$LAST"; V3=$LAST
push v4 mk_v4; waitfor "both skipped v4 (tests fail)" 1500 bad_both "$LAST"; on "$V3" && say "ok: both still on v3"
push v5 mk_v5; waitfor "both rolled back from v5 (no seat taken back)" 1800 bad_both "$LAST"; waitfor "both on v3 again and holding" 400 on_hold "$V3"
push v6 mk_v6; waitfor "both on v6 and holding" 1500 on_hold "$LAST"
sleep 60
systemctl --user stop botupd-update-A.timer botupd-update-B.timer
for x in A B; do for u in update guard; do journalctl --user -u "botupd-$u-$x.service" --since "@$T0" -o short-iso-precise --no-pager > "$W/journal-$u-$x.log"; done; done
node "$here/self-update-score.mjs" "$W" | tee "$W/verdict.txt"
