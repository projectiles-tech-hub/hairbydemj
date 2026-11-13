#!/usr/bin/env bash
# Puts a backup back, after a disaster. This REPLACES the live database and
# uploaded files with the backup's, so it asks first.
#   restore.sh <production|staging> [YYYY-MM-DD] --yes
# Without a date, the newest copy is used. Run on the server as the
# hairbydemj user. Steps (and how to rebuild a whole server) are in
# docs/operations.md.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -ge 1 ] || die "usage: restore.sh <production|staging> [YYYY-MM-DD] --yes"
use_instance "$1"
shift
DAY=""
CONFIRMED=no
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=yes ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) DAY="$arg" ;;
    *) die "unknown option: $arg" ;;
  esac
done
REMOTE="$(backup_remote)"
DATABASE_URL="$(env_value DATABASE_URL)"
UPLOADS="$(env_value MEDIA_DIR "$SHARED/uploads")"
FOLDER=db/daily
if [ -n "$DAY" ]; then
  COPY="db-$DAY.dump"
  if ! "$RCLONE" lsf "${REMOTE}db/daily" | grep -qx "$COPY"; then FOLDER=db/monthly; fi
  "$RCLONE" lsf "${REMOTE}$FOLDER" | grep -qx "$COPY" || die "there is no database copy for $DAY"
else
  COPY="$("$RCLONE" lsf "${REMOTE}db/daily" | grep -E '^db-[0-9-]+\.dump$' | sort | tail -n 1 || true)"
fi
[ -n "$COPY" ] || die "no database copy found"

if [ "$CONFIRMED" != yes ]; then
  echo "This would replace the $INSTANCE database and uploaded files with the backup $COPY."
  echo "Run again with --yes to do it."
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
say "Downloading $COPY"
"$RCLONE" copyto "${REMOTE}$FOLDER/$COPY" "$WORK/db.dump"
pg_restore --list "$WORK/db.dump" >/dev/null

say "Stopping the shop"
$SYSTEMCTL stop "$WEB_UNIT"
$SYSTEMCTL stop "$WORKER_UNIT"

say "Restoring the database"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$WORK/db.dump"

say "Restoring uploaded photos and videos"
mkdir -p "$UPLOADS"
"$RCLONE" copy "${REMOTE}uploads/current" "$UPLOADS"

say "Starting the shop"
$SYSTEMCTL start "$WEB_UNIT"
$SYSTEMCTL start "$WORKER_UNIT"
say "Restored from $COPY"
