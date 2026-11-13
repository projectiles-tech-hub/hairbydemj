#!/usr/bin/env bash
# Puts a new version of the shop live. Run by GitHub Actions over SSH
# (.github/workflows/deploy.yml) as the hairbydemj user:
#   release.sh <production|staging> <commit>
# The built files must already be at <base>/incoming/<commit>.tgz.
#
# Steps: unpack into a new folder under releases/, run new database
# migrations, point "current" at it, restart the web server and worker,
# check /health. If the check fails, "current" goes back to the previous
# version and the services are restarted again. The last 5 versions are kept.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -eq 2 ] || die "usage: release.sh <production|staging> <commit>"
use_instance "$1"
COMMIT="$2"
[[ "$COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || die "not a commit id: $COMMIT"
TARBALL="$BASE/incoming/$COMMIT.tgz"
[ -f "$TARBALL" ] || die "$TARBALL is missing"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing: the server is not set up (docs/operations.md)"

RELEASE="$BASE/releases/$(date -u +%Y%m%d%H%M%S)-${COMMIT:0:7}"
say "Unpacking $COMMIT into $RELEASE"
mkdir -p "$RELEASE"
tar -xzf "$TARBALL" -C "$RELEASE"
rm -f "$TARBALL"
echo "$COMMIT" > "$RELEASE/COMMIT"

say "Running database migrations"
(cd "$RELEASE" && NODE_ENV=production "$NODE" --env-file="$ENV_FILE" dist/server/db/cli.js migrate)

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"

switch_to() {
  ln -sfn "$1" "$BASE/current.next"
  mv -Tf "$BASE/current.next" "$BASE/current"
}

restart() {
  $SYSTEMCTL restart "$WEB_UNIT"
  $SYSTEMCTL restart "$WORKER_UNIT"
}

healthy() {
  local port host
  port="$(env_value PORT 3000)"
  host="$(env_value API_HOST api.hairbydemj.com)"
  for _ in $(seq 1 "${HBD_HEALTH_TRIES:-20}"); do
    if curl -fsS --max-time 5 -H "Host: $host" "http://127.0.0.1:$port/health?db=1" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${HBD_HEALTH_WAIT:-2}"
  done
  return 1
}

say "Switching to the new version and restarting"
switch_to "$RELEASE"
restart

if ! healthy; then
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    say "The new version did not answer its health check; going back to $PREVIOUS"
    switch_to "$PREVIOUS"
    restart
    alert "Deployment of ${COMMIT:0:7} failed" "The new version did not answer its health check, so the previous version ($(basename "$PREVIOUS")) was put back. See: journalctl -u $WEB_UNIT"
  fi
  die "the new version did not answer its health check"
fi

say "Live: $(basename "$RELEASE")"

# Keep the newest 5 versions (never the one in use).
ls -1dt "$BASE"/releases/*/ 2>/dev/null | tail -n +6 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$BASE/current")" ] || rm -rf "$old"
done
