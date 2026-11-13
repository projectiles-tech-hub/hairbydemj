#!/usr/bin/env bash
# Daily backup of the live shop, run by hairbydemj-backup.timer:
#   backup.sh [production]
# 1. The database, dumped with pg_dump and checked that it can be read back.
# 2. Uploaded photos and videos (MEDIA_DIR), mirrored; files that change or
#    are deleted are kept for 90 days under uploads/changed/<date>.
# 3. The settings file (.env), so the server can be rebuilt.
# Everything goes to Google Drive through an rclone "crypt" remote, so it is
# encrypted on this server before it leaves; Google only ever holds
# scrambled files. Kept: daily database copies for 35 days, the copy from the
# 1st of each month for 13 months, a local copy for 7 days.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

use_instance "${1:-production}"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing"
REMOTE="$(backup_remote)"
DATABASE_URL="$(env_value DATABASE_URL)"
[ -n "$DATABASE_URL" ] || die "DATABASE_URL is not set in $ENV_FILE"
UPLOADS="$(env_value MEDIA_DIR "$SHARED/uploads")"
LOCAL="$SHARED/backups"
TODAY="$(date -u +%F)"
mkdir -p "$LOCAL"

say "Dumping the database"
DUMP="$LOCAL/db-$TODAY.dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$DUMP.part"
pg_restore --list "$DUMP.part" >/dev/null
mv -f "$DUMP.part" "$DUMP"

say "Sending the database copy"
"$RCLONE" copyto "$DUMP" "${REMOTE}db/daily/db-$TODAY.dump"
if [ "$(date -u +%d)" = "01" ]; then
  "$RCLONE" copyto "$DUMP" "${REMOTE}db/monthly/db-$TODAY.dump"
fi

say "Sending the settings file"
"$RCLONE" copyto "$ENV_FILE" "${REMOTE}settings/env-$TODAY"

if [ -d "$UPLOADS" ]; then
  say "Mirroring uploaded photos and videos"
  "$RCLONE" sync "$UPLOADS" "${REMOTE}uploads/current" --backup-dir "${REMOTE}uploads/changed/$TODAY" --exclude "/tmp/**"
fi

# remove_older PATH DAYS: deletes dated entries (files or folders named with a
# YYYY-MM-DD date) older than DAYS. Dates in names, not file times, decide.
remove_older() {
  local cutoff entry day
  cutoff="$(date -u -d "-$2 days" +%F)"
  { "$RCLONE" lsf "${REMOTE}$1" 2>/dev/null || true; } | while read -r entry; do
    day="$(grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' <<<"$entry" | head -n 1 || true)"
    [ -n "$day" ] || continue
    if [[ "$day" < "$cutoff" ]]; then
      if [[ "$entry" == */ ]]; then "$RCLONE" purge "${REMOTE}$1/${entry%/}"; else "$RCLONE" deletefile "${REMOTE}$1/$entry"; fi
    fi
  done
}

say "Removing old copies"
remove_older db/daily 35
remove_older db/monthly 400
remove_older settings 35
remove_older uploads/changed 90
find "$LOCAL" -maxdepth 1 -name 'db-*.dump' -mtime +7 -delete

date -u +%FT%TZ > "$LOCAL/last-success"
say "Backup finished"
