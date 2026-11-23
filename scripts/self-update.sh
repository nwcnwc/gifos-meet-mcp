#!/usr/bin/env bash
# Self-update for a guard bot (the welcome-room siblings): one round, run by gifos-meet-guard-update.timer.
# See docs/recipes/self-update.md. One rule decides everything: a bot restarts only when its restart cannot leave the
# room unheld, and only onto a commit that is a fast-forward of what it runs and passes its tests.
#
# A round:
#   0. Finish a swap an earlier round left half done (power loss, reboot): put the commit it was protecting back.
#   1. Ask the update repo for its branch tip. The same commit as now: done.
#   2. Refuse anything that is not a fast-forward of the running commit, a commit that failed here in the last day,
#      and (when an allowed-signers file exists) a commit without a good signature. Wait until the tip has been seen
#      for SOAK_MIN.
#   3. Only if a restart would be safe now (see 4), build it beside the live checkout (<dir>.next): npm ci, npm test,
#      with no bot secrets in the environment and a home of its own.
#   4. Ask the running bot (guard_status) twice, PROBE_GAP apart, whether its restart is safe: it holds the room and
#      its own seat saw a sibling holding it moments ago, or someone else holds the room. A bot that has held nothing
#      across rounds for STUCK_MIN is safe too (it is stuck; its restart takes nothing). Not safe: skip this round.
#   5. Swap: stop the service, <dir> -> <dir>.prev, <dir>.next -> <dir>, pin the new commit, start.
#   6. Wait REJOIN_SEC for the bot to stand at least as well as before (holds the room if it held it). Not back in
#      time: swap the previous checkout back, pin it, start it, and do not try that commit again for a day.
# Logs go to stdout (the journal). The bot's token is read by the health probe only and never printed.
set -uo pipefail

DIR=${GIFOS_UPDATE_DIR:-$HOME/gifos-meet-mcp}; DIR=${DIR%/}
SERVICE=${GIFOS_UPDATE_SERVICE:-gifos-meet-guard.service}
REPO=${GIFOS_UPDATE_REPO:-https://github.com/nwcnwc/gifos-meet-mcp.git}
BRANCH=${GIFOS_UPDATE_BRANCH:-main}
PIN_FILE=${GIFOS_UPDATE_PIN_FILE:-$HOME/.config/gifos-guard/pin}
GUARD_ENV=${GIFOS_UPDATE_GUARD_ENV:-$HOME/.config/gifos-guard/env}
PORT=${GIFOS_UPDATE_PORT:-19520}
STATE=${GIFOS_UPDATE_STATE:-$HOME/.local/state/gifos-selfupdate}
SIGNERS=${GIFOS_UPDATE_ALLOWED_SIGNERS:-$HOME/.config/gifos-guard/allowed_signers}
SOAK_MIN=${GIFOS_UPDATE_SOAK_MIN:-50}
REJOIN_SEC=${GIFOS_UPDATE_REJOIN_SEC:-300}
FRESH_SEC=${GIFOS_UPDATE_SIBLING_FRESH_SEC:-20}
PROBE_GAP=${GIFOS_UPDATE_PROBE_GAP_SEC:-45}
STUCK_MIN=${GIFOS_UPDATE_STUCK_MIN:-100}
ROUND_MAX_MIN=${GIFOS_UPDATE_ROUND_MAX_MIN:-20}
BAD_RETRY_MIN=${GIFOS_UPDATE_BAD_RETRY_MIN:-1440}
NPM_CI_FLAGS=${GIFOS_UPDATE_NPM_CI_FLAGS:---no-audit --no-fund --onnxruntime-node-install-cuda=skip}
NEXT="$DIR.next"; PREV="$DIR.prev"; PTMP="$DIR.prev.tmp"
# A stalled download is a stuck round, not a slow one: git gives up when under 1 kB/s for a minute.
export GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=60 GIT_TERMINAL_PROMPT=0

log() { echo "self-update: $*"; }
die() { log "$*"; exit 1; }
case "$DIR" in /*/gifos-meet-mcp*) ;; *) die "refusing an odd checkout path: $DIR" ;; esac

mkdir -p "$STATE" || die "cannot make $STATE"
exec 9>"$STATE/lock"
flock -n 9 || { log "another round is running; skip"; exit 0; }
T_ROUND=$(date +%s)

# The probe runs from a copy, so the swap never pulls it out from under us.
health() {
  node "$STATE/guard-health.mjs" --port "$PORT" --env "$GUARD_ENV" --fresh "$FRESH_SEC" 2>/dev/null \
    || echo '{"level":0,"safe":false,"why":"the probe failed"}'
}
field() { node -e 'const v=JSON.parse(process.argv[1]);const x=v[process.argv[2]];process.stdout.write(x===undefined||x===null?"":String(x))' "$1" "$2"; }
head_of() { git -C "$1" rev-parse HEAD 2>/dev/null; }
pin_to() { printf 'GIFOS_GUARD_PIN=%s\n' "$1" > "$PIN_FILE.tmp" && mv -f "$PIN_FILE.tmp" "$PIN_FILE"; }
older_than_min() { [ -e "$1" ] && [ $(( ( $(date +%s) - $(stat -c %Y "$1") ) / 60 )) -ge "$2" ]; }

# 0. A swap marker names the commit that must be live if a round dies mid-swap. Put the tree holding it at $DIR.
if [ -s "$STATE/swapping" ]; then
  safe_sha=$(cat "$STATE/swapping")
  log "an earlier round stopped mid-swap; putting ${safe_sha:0:7} back"
  systemctl --user stop "$SERVICE"
  for t in "$DIR" "$PTMP" "$PREV" "$NEXT"; do [ "$(head_of "$t")" = "$safe_sha" ] && { found=$t; break; }; done
  [ -n "${found:-}" ] || die "no checkout holds ${safe_sha:0:7}; an operator must look (service left stopped)"
  if [ "$found" != "$DIR" ]; then
    rm -rf "$NEXT.old"; [ -e "$DIR" ] && { mv -T "$DIR" "$NEXT.old" || die "cannot move $DIR aside"; }
    mv -T "$found" "$DIR" || die "cannot move ${safe_sha:0:7} into place"
    rm -rf "$NEXT.old"
  fi
  rm -rf "$PTMP" "$NEXT"
  pin_to "$safe_sha" && systemctl --user start "$SERVICE" && rm -f "$STATE/swapping"
  log "back on ${safe_sha:0:7}; this round ends here"; exit 0
fi

cp "$DIR/scripts/guard-health.mjs" "$STATE/guard-health.mjs" || die "no health probe in $DIR"
systemctl --user is-active --quiet "$SERVICE" || { log "$SERVICE is not running (stopped by its operator?); skip"; exit 0; }
[ -z "$(git -C "$DIR" status --porcelain)" ] || die "the live checkout has local changes; skip (an operator is working on it)"
HEAD=$(head_of "$DIR") || die "no git checkout at $DIR"
PIN=$(sed -n 's/^GIFOS_GUARD_PIN=//p' "$PIN_FILE" 2>/dev/null)
[ "$PIN" = "$HEAD" ] || die "the live checkout ($HEAD) is not the pinned commit ($PIN); skip"

# Is a restart safe right now? Echoes the probe; returns 0 if safe (or stuck long enough), 1 if not.
safe_now() {
  local h; h=$(health); echo "$h"
  [ "$(field "$h" holding)" = true ] && rm -f "$STATE/not-holding"
  [ "$(field "$h" safe)" = true ] && return 0
  if [ "$(field "$h" level)" -ge 1 ] && [ "$(field "$h" holding)" != true ] && [ -n "$(field "$h" age_s)" ] && [ "$(field "$h" age_s)" -le 30 ]; then
    [ -e "$STATE/not-holding" ] || touch "$STATE/not-holding"
    older_than_min "$STATE/not-holding" "$STUCK_MIN" && return 0
  fi
  return 1
}

# 1. the tip
TIP=$(git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -f1)
[ -n "$TIP" ] || die "cannot read $BRANCH from the update repo"
[ "$TIP" = "$HEAD" ] && { log "up to date at ${HEAD:0:7}"; exit 0; }
if [ -e "$STATE/bad-$TIP" ]; then
  older_than_min "$STATE/bad-$TIP" "$BAD_RETRY_MIN" || { log "tip ${TIP:0:7} failed here before; waiting for a newer one"; exit 0; }
  rm -f "$STATE/bad-$TIP"; log "tip ${TIP:0:7} failed here over $BAD_RETRY_MIN min ago; trying it again"
fi

# 2. fast-forward, signature, soak
git -C "$DIR" fetch -q --no-tags "$REPO" "+refs/heads/$BRANCH:refs/selfupdate/tip" || die "fetch failed"
[ "$(git -C "$DIR" rev-parse refs/selfupdate/tip)" = "$TIP" ] || die "the tip moved while fetching; next round"
git -C "$DIR" merge-base --is-ancestor "$HEAD" "$TIP" || { log "REFUSED ${TIP:0:7}: not a fast-forward of ${HEAD:0:7} (history rewritten?)"; touch "$STATE/bad-$TIP"; exit 1; }
if [ -s "$SIGNERS" ]; then
  gv=$(git --version | sed -E 's/[^0-9]*([0-9]+)\.([0-9]+).*/\1 \2/')
  set -- $gv
  { [ "$1" -gt 2 ] || { [ "$1" -eq 2 ] && [ "$2" -ge 34 ]; }; } && command -v ssh-keygen >/dev/null \
    || die "an allowed-signers file is set, but this git ($(git --version)) cannot check ssh signatures (2.34+ and ssh-keygen needed); not updating"
  git -C "$DIR" -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$SIGNERS" verify-commit "$TIP" >/dev/null 2>&1 \
    || { log "REFUSED ${TIP:0:7}: no good signature from an allowed signer"; touch "$STATE/bad-$TIP"; exit 1; }
  log "signature on ${TIP:0:7} is good"
fi
[ -e "$STATE/seen-$TIP" ] || touch "$STATE/seen-$TIP"
older_than_min "$STATE/seen-$TIP" "$SOAK_MIN" || { log "new tip ${TIP:0:7} seen $(( ( $(date +%s) - $(stat -c %Y "$STATE/seen-$TIP") ) / 60 )) min ago; applying after ${SOAK_MIN} min"; exit 0; }

# Building costs memory beside the bot: only when a restart would be allowed now.
h=$(safe_now) || { log "SKIP this round before building: $(field "$h" why)"; exit 0; }
log "updating ${HEAD:0:7} -> ${TIP:0:7} ($(git -C "$DIR" rev-list --count "$HEAD..$TIP") commits)"

# 3. build and test beside the live checkout: no bot secrets in the environment, a home of its own
rm -rf "$NEXT"
git clone -q --no-checkout "$DIR" "$NEXT" || die "clone failed"
git -C "$NEXT" fetch -q "$DIR" refs/selfupdate/tip && git -C "$NEXT" checkout -q --detach "$TIP" || { rm -rf "$NEXT"; die "checkout of ${TIP:0:7} failed"; }
git -C "$NEXT" remote set-url origin "$REPO" 2>/dev/null || git -C "$NEXT" remote add origin "$REPO"
mkdir -p "$STATE/home"
clean() {
  env -i HOME="$STATE/home" PATH="$PATH" LANG=C.UTF-8 TMPDIR="${TMPDIR:-/tmp}" \
    npm_config_cache="$HOME/.npm" PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" "$@" 9>&-
}
# The same lockfile as the live checkout: copy its installed packages (a plain copy, low memory) instead of npm ci,
# which needs over 1 GB. npm test still runs on the result.
if git -C "$DIR" diff --quiet "$HEAD" "$TIP" -- package-lock.json package.json && [ -d "$DIR/node_modules" ]; then
  cp -a "$DIR/node_modules" "$NEXT/node_modules" || { rm -rf "$NEXT"; die "cannot copy node_modules"; }
  log "same lockfile: node_modules copied from the live checkout"
# shellcheck disable=SC2086
elif ! ( cd "$NEXT" && clean npm ci $NPM_CI_FLAGS >"$STATE/ci.log" 2>&1 ); then
  log "SKIP ${TIP:0:7}: npm ci failed (tail of $STATE/ci.log follows)"; tail -5 "$STATE/ci.log"
  rm -rf "$NEXT"; exit 1
else
  log "the lockfile moved: npm ci done"
fi
if ! ( cd "$NEXT" && clean npm test >"$STATE/test.log" 2>&1 ); then
  log "SKIP ${TIP:0:7}: npm test failed ($(grep -E '^# (pass|fail)' "$STATE/test.log" | tr '\n' ' '))"
  touch "$STATE/bad-$TIP"; rm -rf "$NEXT"; exit 1
fi
log "${TIP:0:7} built and tested: $(grep -E '^# (pass|fail)' "$STATE/test.log" | tr '\n' ' ')"

# 4. is a restart safe right now? Twice, PROBE_GAP apart: a sibling that has just gone must not still look fresh.
if [ $(( $(date +%s) - T_ROUND )) -gt $(( ROUND_MAX_MIN * 60 )) ]; then
  log "SKIP this round: it has run over ${ROUND_MAX_MIN} min, so it may now be the sibling's slot"; rm -rf "$NEXT"; exit 0
fi
B1=$(safe_now) || { log "SKIP this round: $(field "$B1" why)"; rm -rf "$NEXT"; exit 0; }
sleep "$PROBE_GAP"
BEFORE=$(safe_now) || { log "SKIP this round (second look): $(field "$BEFORE" why)"; rm -rf "$NEXT"; exit 0; }
log "before: $BEFORE"
want=$(field "$BEFORE" level); [ "$want" -lt 1 ] && want=1

# 5. swap. The marker names the commit to put back if this round dies before it is over.
swap_in() {   # $1 = commit to go live: the tree at $NEXT goes live and the live tree goes to $PREV
  systemctl --user stop "$SERVICE"
  if systemctl --user is-active --quiet "$SERVICE"; then log "the service did not stop"; return 1; fi
  rm -rf "$PTMP"
  mv -T "$DIR" "$PTMP" || { systemctl --user start "$SERVICE"; log "cannot move the live checkout"; return 1; }
  if ! mv -T "$NEXT" "$DIR"; then mv -T "$PTMP" "$DIR"; systemctl --user start "$SERVICE"; log "cannot move the new checkout in"; return 1; fi
  rm -rf "$PREV"; mv -T "$PTMP" "$PREV"
  pin_to "$1"
  systemctl --user start "$SERVICE"
}
wait_back() {   # until the bot stands at level >= $want, at most REJOIN_SEC
  local end=$(( $(date +%s) + REJOIN_SEC )) h=''
  while [ "$(date +%s)" -lt "$end" ]; do
    sleep 5
    h=$(health)
    if [ "$(field "$h" level)" -ge "$want" ]; then log "back: $h"; return 0; fi
  done
  log "not back in ${REJOIN_SEC} s: $h"; return 1
}
echo "$HEAD" > "$STATE/swapping"
t0=$(date +%s)
log "restarting $SERVICE on ${TIP:0:7}"
if ! swap_in "$TIP"; then rm -f "$STATE/swapping"; rm -rf "$NEXT"; die "swap failed; still on ${HEAD:0:7}"; fi

# 6. back in time, or roll back
if wait_back; then
  rm -f "$STATE/swapping"
  log "UPDATED ${HEAD:0:7} -> ${TIP:0:7}, back in $(( $(date +%s) - t0 )) s (previous checkout kept at $PREV)"
  exit 0
fi
log "ROLLBACK to ${HEAD:0:7}: ${TIP:0:7} did not take its seat back"
touch "$STATE/bad-$TIP"
mv -T "$PREV" "$NEXT" || die "rollback failed: no previous checkout at $PREV (the next round puts ${HEAD:0:7} back)"
swap_in "$HEAD" || die "rollback swap failed (the next round puts ${HEAD:0:7} back)"
rm -f "$STATE/swapping"; rm -rf "$PREV"
if wait_back; then log "ROLLED BACK to ${HEAD:0:7}, back in $(( $(date +%s) - t0 )) s"
else
  # The old commit does not come back either: the room or the site is at fault, not the new commit.
  rm -f "$STATE/bad-$TIP"; log "rolled back to ${HEAD:0:7}, but it is not back yet either; ${TIP:0:7} is not marked bad"
fi
exit 1
