#!/usr/bin/env bash
# Monthly restore test, run by hairbydemj-restore-test.timer:
#   restore-test.sh [production]
# Proves the backups can really be used: downloads the newest database copy
# from Google Drive, restores it into a separate empty database
# (RESTORE_TEST_DATABASE_URL), compares it with the live one, and checks a few
# uploaded files against the live copies. The live database is only read.
# The result is emailed to ALERT_EMAIL either way.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

use_instance "${1:-production}"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing"
REMOTE="$(backup_remote)"
LIVE_URL="$(env_value DATABASE_URL)"
TEST_URL="$(env_value RESTORE_TEST_DATABASE_URL)"
[ -n "$LIVE_URL" ] || die "DATABASE_URL is not set"
[ -n "$TEST_URL" ] || die "RESTORE_TEST_DATABASE_URL is not set (an empty database used only for this test)"
[ "$TEST_URL" != "$LIVE_URL" ] || die "RESTORE_TEST_DATABASE_URL must not be the live database"
UPLOADS="$(env_value MEDIA_DIR "$SHARED/uploads")"
WORK="$(mktemp -d)"
REPORT="$WORK/report.txt"

fail() {
  local message="$1"
  alert "Monthly restore test FAILED" "$message

$(cat "$REPORT" 2>/dev/null || true)"
  rm -rf "$WORK"
  die "$message"
}

empty_test_database() {
  psql --quiet --no-psqlrc --set ON_ERROR_STOP=1 --dbname="$TEST_URL" -c 'drop schema if exists public cascade; create schema public;' >/dev/null
}

LATEST="$("$RCLONE" lsf "${REMOTE}db/daily" 2>/dev/null | grep -E '^db-[0-9-]+\.dump$' | sort | tail -n 1 || true)"
[ -n "$LATEST" ] || fail "There is no database copy in the backups."
echo "Newest database copy: $LATEST" >> "$REPORT"

say "Downloading $LATEST"
"$RCLONE" copyto "${REMOTE}db/daily/$LATEST" "$WORK/db.dump" || fail "The database copy could not be downloaded."

say "Restoring into the test database"
empty_test_database || fail "The test database could not be emptied."
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TEST_URL" "$WORK/db.dump" 2>>"$REPORT" || fail "The database copy could not be restored."

count() {
  psql --quiet --no-psqlrc --tuples-only --no-align --dbname="$1" -c "select count(*) from $2" 2>/dev/null || echo "?"
}
for table in schema_migrations products orders customers; do
  restored="$(count "$TEST_URL" "$table")"
  live="$(count "$LIVE_URL" "$table")"
  printf '%-18s restored %s, live now %s\n' "$table" "$restored" "$live" >> "$REPORT"
  [ "$restored" != "?" ] || fail "The restored copy has no $table table."
done
[ "$(count "$TEST_URL" schema_migrations)" -gt 0 ] || fail "The restored copy is empty."

if [ -d "$UPLOADS" ]; then
  say "Checking uploaded files"
  checked=0
  while read -r file; do
    [ -n "$file" ] || continue
    [ -f "$UPLOADS/$file" ] || continue
    "$RCLONE" copyto "${REMOTE}uploads/current/$file" "$WORK/sample" || fail "Uploaded file $file could not be downloaded."
    cmp -s "$WORK/sample" "$UPLOADS/$file" || fail "Uploaded file $file in the backup differs from the live one."
    checked=$((checked + 1))
  done < <("$RCLONE" lsf --recursive --files-only "${REMOTE}uploads/current" 2>/dev/null | shuf -n 5 || true)
  echo "Uploaded files checked: $checked" >> "$REPORT"
fi

empty_test_database || true
date -u +%FT%TZ > "$SHARED/backups/last-restore-test"
alert "Monthly restore test passed" "$(cat "$REPORT")"
rm -rf "$WORK"
say "Restore test passed"
