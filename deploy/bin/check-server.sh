#!/usr/bin/env bash
# Hourly health check of the server itself, run by hairbydemj-check.timer.
# Emails ALERT_EMAIL when something is wrong (at most every 6 hours for the
# same problem) and once more when it is fixed:
# - a service is not running (web, worker, database, Caddy, Postfix);
# - the disk is more than 85% full;
# - the last good backup is more than 26 hours old;
# - the live database is not answering.
# The outside check that the website answers is .github/workflows/uptime.yml.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

use_instance "${1:-production}"
STATE="$SHARED/backups/alerts"
mkdir -p "$STATE"
FULL="${HBD_DISK_LIMIT:-85}"
problems=()

for unit in "$WEB_UNIT" "$WORKER_UNIT" ${HBD_SYSTEM_UNITS-postgresql caddy postfix}; do
  $SYSTEMCTL is-active --quiet "$unit" || problems+=("service-$unit|The $unit service is not running.")
done

used="$(df --output=pcent "${HBD_DISK_PATH:-/}" | tail -n 1 | tr -dc '0-9')"
if [ -n "$used" ] && [ "$used" -gt "$FULL" ]; then
  problems+=("disk|The disk is ${used}% full. Old releases, logs and local backup copies can be removed; see docs/operations.md.")
fi

if [ "$INSTANCE" = production ]; then
  last="$SHARED/backups/last-success"
  if [ ! -f "$last" ] || [ -n "$(find "$last" -mmin +1560 2>/dev/null)" ]; then
    problems+=("backup|There has been no successful backup for more than 26 hours. See: journalctl -u hairbydemj-backup")
  fi
fi

DATABASE_URL="$(env_value DATABASE_URL)"
if [ -n "$DATABASE_URL" ] && ! psql --quiet --no-psqlrc --dbname="$DATABASE_URL" -c 'select 1' >/dev/null 2>&1; then
  problems+=("database|The database is not answering.")
fi

# Alert for new problems (or every 6 hours while they last).
current=()
for item in "${problems[@]+"${problems[@]}"}"; do
  key="${item%%|*}"
  message="${item#*|}"
  current+=("$key")
  stamp="$STATE/$key"
  if [ ! -f "$stamp" ] || [ -n "$(find "$stamp" -mmin +360 2>/dev/null)" ]; then
    alert "Server problem: $key" "$message"
    touch "$stamp"
  fi
  echo "problem: $message"
done

# Say when a problem has cleared.
for stamp in "$STATE"/*; do
  [ -f "$stamp" ] || continue
  key="$(basename "$stamp")"
  if [[ " ${current[*]-} " != *" $key "* ]]; then
    alert "Fixed: $key" "The earlier problem ($key) has cleared."
    rm -f "$stamp"
  fi
done

[ ${#problems[@]} -eq 0 ] && echo "All checks passed."
exit 0
