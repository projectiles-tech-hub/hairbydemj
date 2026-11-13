#!/usr/bin/env bash
# Goes back to the version before the current one, without a new deployment:
#   rollback.sh <production|staging>
# Run on the server as the hairbydemj user. Database migrations are not
# undone; they only ever add, so the older version still works with them.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -eq 1 ] || die "usage: rollback.sh <production|staging>"
use_instance "$1"
CURRENT="$(readlink -f "$BASE/current")"
TARGET=""
while read -r dir; do
  dir="$(readlink -f "$dir")"
  if [ "$dir" != "$CURRENT" ] && [[ "$dir" < "$CURRENT" ]]; then TARGET="$dir"; break; fi
done < <(ls -1d "$BASE"/releases/*/ | sort -r)
[ -n "$TARGET" ] || die "there is no older version in $BASE/releases"
ln -sfn "$TARGET" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"
$SYSTEMCTL restart "$WEB_UNIT"
$SYSTEMCTL restart "$WORKER_UNIT"
say "Now running $(basename "$TARGET") (was $(basename "$CURRENT"))"
