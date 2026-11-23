#!/usr/bin/env bash
# Self-update for a guard bot (the welcome-room siblings): one round, run by gifos-meet-guard-update.timer.
# See docs/recipes/self-update.md. One rule decides everything: a bot restarts only when its restart cannot leave the
# room unheld, and only onto a commit that is a fast-forward of what it runs and passes its tests.
#
# A round:
#   1. Ask the update repo for its branch tip. The same commit as now: done.
#   2. Refuse anything that is not a fast-forward of the running commit, a commit that failed here before, and (when an
#      allowed-signers file exists) a commit without a good signature. Wait until the tip has been seen for SOAK_MIN.
#   3. Build it beside the live checkout (<dir>.next): npm ci, npm test, in a clean environment (no bot secrets).
#   4. Ask the running bot (guard_status) whether its restart is safe: a sibling held the room in its own view moments
#      ago, or it holds nothing itself. Not safe: skip this round.
#   5. Swap: pin the new commit, stop the service, <dir> -> <dir>.prev, <dir>.next -> <dir>, start.
#   6. Wait REJOIN_SEC for the bot to stand at least as well as before (holds the room if it held it, else seated).
#      Not back in time: swap the previous checkout back, pin it, start it, and never try that commit again.
# Logs go to stdout (the journal). The bot's token is read by the health probe only and never printed.
set -uo pipefail

DIR=${GIFOS_UPDATE_DIR:-$HOME/gifos-meet-mcp}
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
NPM_CI_FLAGS=${GIFOS_UPDATE_NPM_CI_FLAGS:---no-audit --no-fund --onnxruntime-node-install-cuda=skip}
NEXT="$DIR.next"
PREV="$DIR.prev"

log() { echo "self-update: $*"; }
die() { log "$*"; exit 1; }
case "$DIR" in /*/gifos-meet-mcp*) ;; *) die "refusing an odd checkout path: $DIR" ;; esac

mkdir -p "$STATE" || die "cannot make $STATE"
exec 9>"$STATE/lock"
flock -n 9 || { log "another round is running; skip"; exit 0; }

# The probe runs from a copy, so the swap never pulls it out from under us.
health() {
  node "$STATE/guard-health.mjs" --port "$PORT" --env "$GUARD_ENV" --fresh "$FRESH_SEC" 2>/dev/null \
    || echo '{"level":0,"safe":false,"why":"the probe failed"}'
}
field() { node -e 'const v=JSON.parse(process.argv[1]);const x=v[process.argv[2]];process.stdout.write(x===undefined||x===null?"":String(x))' "$1" "$2"; }
cp "$DIR/scripts/guard-health.mjs" "$STATE/guard-health.mjs" || die "no health probe in $DIR"

systemctl --user is-active --quiet "$SERVICE" || { log "$SERVICE is not running (stopped by its operator?); skip"; exit 0; }
[ -z "$(git -C "$DIR" status --porcelain)" ] || die "the live checkout has local changes; skip (an operator is working on it)"
HEAD=$(git -C "$DIR" rev-parse HEAD) || die "no git checkout at $DIR"
PIN=$(sed -n 's/^GIFOS_GUARD_PIN=//p' "$PIN_FILE" 2>/dev/null)
[ "$PIN" = "$HEAD" ] || die "the live checkout ($HEAD) is not the pinned commit ($PIN); skip"

# 1. the tip
TIP=$(git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -f1)
[ -n "$TIP" ] || die "cannot read $BRANCH from the update repo"
[ "$TIP" = "$HEAD" ] && { log "up to date at ${HEAD:0:7}"; exit 0; }
[ -e "$STATE/bad-$TIP" ] && { log "tip ${TIP:0:7} failed here before; waiting for a newer one"; exit 0; }

# 2. fast-forward, signature, soak
git -C "$DIR" fetch -q --no-tags "$REPO" "+refs/heads/$BRANCH:refs/selfupdate/tip" || die "fetch failed"
[ "$(git -C "$DIR" rev-parse refs/selfupdate/tip)" = "$TIP" ] || die "the tip moved while fetching; next round"
git -C "$DIR" merge-base --is-ancestor "$HEAD" "$TIP" || { log "REFUSED ${TIP:0:7}: not a fast-forward of ${HEAD:0:7} (history rewritten?)"; touch "$STATE/bad-$TIP"; exit 1; }
if [ -s "$SIGNERS" ]; then
  git -C "$DIR" -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$SIGNERS" verify-commit "$TIP" >/dev/null 2>&1 \
    || { log "REFUSED ${TIP:0:7}: no good signature from an allowed signer"; touch "$STATE/bad-$TIP"; exit 1; }
  log "signature on ${TIP:0:7} is good"
fi
[ -e "$STATE/seen-$TIP" ] || touch "$STATE/seen-$TIP"
age_min=$(( ( $(date +%s) - $(stat -c %Y "$STATE/seen-$TIP") ) / 60 ))
if [ "$age_min" -lt "$SOAK_MIN" ]; then log "new tip ${TIP:0:7} seen ${age_min} min ago; applying after ${SOAK_MIN} min"; exit 0; fi
log "updating ${HEAD:0:7} -> ${TIP:0:7} ($(git -C "$DIR" rev-list --count "$HEAD..$TIP") commits)"

# 3. build and test beside the live checkout, with no bot secrets in the environment
rm -rf "$NEXT"
git clone -q --no-checkout "$DIR" "$NEXT" || die "clone failed"
git -C "$NEXT" fetch -q "$DIR" refs/selfupdate/tip && git -C "$NEXT" checkout -q --detach "$TIP" \
  && git -C "$NEXT" remote set-url origin "$(git -C "$DIR" remote get-url origin)" || { rm -rf "$NEXT"; die "checkout of ${TIP:0:7} failed"; }
clean() { env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 TMPDIR="${TMPDIR:-/tmp}" "$@"; }
# shellcheck disable=SC2086
if ! ( cd "$NEXT" && clean npm ci $NPM_CI_FLAGS >"$STATE/ci.log" 2>&1 ); then
  log "SKIP ${TIP:0:7}: npm ci failed (tail of $STATE/ci.log follows)"; tail -5 "$STATE/ci.log"
  rm -rf "$NEXT"; exit 1
fi
if ! ( cd "$NEXT" && clean npm test >"$STATE/test.log" 2>&1 ); then
  log "SKIP ${TIP:0:7}: npm test failed ($(grep -E '^# (pass|fail)' "$STATE/test.log" | tr '\n' ' '))"
  touch "$STATE/bad-$TIP"; rm -rf "$NEXT"; exit 1
fi
log "${TIP:0:7} built and tested: $(grep -E '^# (pass|fail)' "$STATE/test.log" | tr '\n' ' ')"

# 4. is a restart safe right now?
BEFORE=$(health)
log "before: $BEFORE"
if [ "$(field "$BEFORE" safe)" != true ]; then
  log "SKIP this round: $(field "$BEFORE" why)"; rm -rf "$NEXT"; exit 0
fi
want=$(field "$BEFORE" level); [ "$want" -lt 2 ] && want=2

# 5. swap
swap_in() {   # $1 = commit to pin, then the tree at $NEXT goes live and the live tree goes to $PREV
  printf 'GIFOS_GUARD_PIN=%s\n' "$1" > "$PIN_FILE.tmp" && mv "$PIN_FILE.tmp" "$PIN_FILE"
  systemctl --user stop "$SERVICE"
  mv "$DIR" "$PREV.tmp" && mv "$NEXT" "$DIR" && mv "$PREV.tmp" "$PREV"
  systemctl --user start "$SERVICE"
}
wait_back() {   # until the bot stands at level >= $want, at most REJOIN_SEC
  local end=$(( $(date +%s) + REJOIN_SEC )) h
  while [ "$(date +%s)" -lt "$end" ]; do
    sleep 5
    h=$(health)
    if [ "$(field "$h" level)" -ge "$want" ]; then log "back: $h"; return 0; fi
  done
  log "not back in ${REJOIN_SEC} s: $h"; return 1
}
rm -rf "$PREV"
t0=$(date +%s)
log "restarting $SERVICE on ${TIP:0:7}"
swap_in "$TIP"

# 6. back in time, or roll back
if wait_back; then
  log "UPDATED ${HEAD:0:7} -> ${TIP:0:7}, back in $(( $(date +%s) - t0 )) s (previous checkout kept at $PREV)"
  exit 0
fi
log "ROLLBACK to ${HEAD:0:7}: ${TIP:0:7} did not take its seat back"
touch "$STATE/bad-$TIP"
mv "$PREV" "$NEXT" || die "rollback failed: no previous checkout at $PREV"
swap_in "$HEAD"
rm -rf "$PREV"
if wait_back; then log "ROLLED BACK to ${HEAD:0:7}, back in $(( $(date +%s) - t0 )) s"; else log "rolled back to ${HEAD:0:7}, but it is not back yet either"; fi
exit 1
