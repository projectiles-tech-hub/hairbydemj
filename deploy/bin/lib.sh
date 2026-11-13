# Shared by the scripts in deploy/bin. Not run on its own.
#
# Each copy of the shop on the server is an "instance":
#   production  /srv/hairbydemj          services hairbydemj-web, hairbydemj-worker
#   staging     /srv/hairbydemj-staging  services hairbydemj-staging-web, hairbydemj-staging-worker
# Settings (with the secrets) are in <base>/shared/.env, readable only by the
# hairbydemj user. HBD_ROOT changes /srv, for tests only.

set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

say() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

# use_instance NAME: sets INSTANCE, BASE, SHARED, ENV_FILE, WEB_UNIT, WORKER_UNIT.
use_instance() {
  local root="${HBD_ROOT:-/srv}"
  INSTANCE="$1"
  case "$INSTANCE" in
    production)
      BASE="$root/hairbydemj"
      WEB_UNIT=hairbydemj-web
      WORKER_UNIT=hairbydemj-worker
      ;;
    staging)
      BASE="$root/hairbydemj-staging"
      WEB_UNIT=hairbydemj-staging-web
      WORKER_UNIT=hairbydemj-staging-worker
      ;;
    *) die "the instance must be production or staging, not '$INSTANCE'" ;;
  esac
  SHARED="$BASE/shared"
  ENV_FILE="$SHARED/.env"
  RCLONE_CONFIG="${RCLONE_CONFIG:-$SHARED/rclone.conf}"
  export INSTANCE BASE SHARED ENV_FILE WEB_UNIT WORKER_UNIT RCLONE_CONFIG
}

# env_value NAME [DEFAULT]: one setting from the instance's .env, without
# running the file (values may hold characters the shell would act on).
env_value() {
  local line value
  line="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
  if [ -z "$value" ]; then value="${2:-}"; fi
  printf '%s' "$value"
}

# Commands that tests replace with stand-ins.
SYSTEMCTL="${HBD_SYSTEMCTL:-sudo -n /usr/bin/systemctl}"
RCLONE="${HBD_RCLONE:-rclone}"
NODE="${HBD_NODE:-node}"

# alert SUBJECT BODY: emails ALERT_EMAIL from the shop's own mail settings
# (signed like every other email). Never fails the calling script.
alert() {
  local current="$BASE/current"
  if [ -f "$current/dist/server/ops/alert.js" ] && (cd "$current" && NODE_ENV=production "$NODE" --env-file="$ENV_FILE" dist/server/ops/alert.js "[$INSTANCE] $1" "$2"); then
    return 0
  fi
  # The email could not be sent: at least leave it in the system log.
  logger -t hairbydemj "ALERT [$INSTANCE] $1: $2" 2>/dev/null || true
  echo "ALERT [$INSTANCE] $1: $2" >&2
}

# backup_remote: where backups go (an encrypted rclone remote).
backup_remote() {
  local remote
  remote="$(env_value BACKUP_REMOTE hbd-backup)"
  remote="${remote%:}"
  # Refuse to send anything to a remote that is not encrypted.
  if ! "$RCLONE" listremotes --long 2>/dev/null | grep -Eq "^$remote:[[:space:]]+crypt\$"; then
    die "the rclone remote '$remote' is not set up as an encrypted (crypt) remote in $RCLONE_CONFIG; see docs/operations.md"
  fi
  printf '%s:' "$remote"
}
