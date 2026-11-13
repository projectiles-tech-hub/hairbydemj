#!/usr/bin/env bash
# Sets up a fresh Namecheap Quasar VPS (Ubuntu 24.04 LTS) for hairbydemj.
# Safe to run again: each step checks what is already done.
#
# On the server, as root, from a copy of this repository:
#   git clone https://github.com/projectiles-tech-hub/hairbydemj.git /root/hairbydemj
#   cd /root/hairbydemj
#   bash deploy/setup-server.sh --deploy-key "ssh-ed25519 AAAA... github-deploy" --alert-email you@example.com
#
# What it does (each step is explained in docs/operations.md):
#  1. Updates Ubuntu and turns on automatic security updates.
#  2. Firewall: only SSH, HTTP and HTTPS are open. fail2ban blocks
#     repeated wrong SSH logins. Password logins over SSH are turned off
#     once a key is in place.
#  3. Installs PostgreSQL, Node.js 24 LTS, Caddy, libvips, ffmpeg, Postfix
#     (send-only, for the shop's emails) and rclone (for backups).
#  4. Creates the hairbydemj user, the folders for production and staging,
#     the databases, and a settings file for each with new random secrets.
#  5. Installs the systemd services and timers, Caddy's settings and the
#     rule that lets deployments restart the shop.
# It never prints or overwrites an existing secret.

set -euo pipefail

DEPLOY_KEY=""
ALERT_EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --deploy-key) DEPLOY_KEY="$2"; shift 2 ;;
    --alert-email) ALERT_EMAIL="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo bash deploy/setup-server.sh ...)" >&2; exit 1; }
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$REPO/deploy/caddy/Caddyfile" ] || { echo "run from a copy of the repository" >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "warning: written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}" >&2

step() { echo; echo "== $*"; }
export DEBIAN_FRONTEND=noninteractive

step "1. Ubuntu updates and automatic security updates"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install unattended-upgrades apt-listchanges ca-certificates curl gnupg ufw fail2ban rsync
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
# Security updates that need a restart are applied at 03:30 UTC (04:30 in Lagos).
cat > /etc/apt/apt.conf.d/52hairbydemj-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
CONF
timedatectl set-timezone UTC

step "2. Firewall, fail2ban and SSH"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban

step "3. Software"
install -d -m 0755 /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
fi
if [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
fi
debconf-set-selections <<'CONF'
postfix postfix/main_mailer_type select Internet Site
postfix postfix/mailname string hairbydemj.com
CONF
apt-get update -q
apt-get -y -q install nodejs postgresql postgresql-contrib caddy libvips-tools ffmpeg postfix rclone
# Postfix only accepts mail from this machine (the shop); it never relays for others.
postconf -e 'inet_interfaces = loopback-only' 'myhostname = mail.hairbydemj.com' 'mydestination = localhost' 'smtpd_tls_security_level = may' 'smtp_tls_security_level = may'
systemctl restart postfix
node --version

step "4. The hairbydemj user, folders, databases and settings"
if ! id hairbydemj >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash hairbydemj
fi
if [ -n "$DEPLOY_KEY" ]; then
  install -d -m 0700 -o hairbydemj -g hairbydemj /home/hairbydemj/.ssh
  touch /home/hairbydemj/.ssh/authorized_keys
  grep -qxF "$DEPLOY_KEY" /home/hairbydemj/.ssh/authorized_keys || echo "$DEPLOY_KEY" >> /home/hairbydemj/.ssh/authorized_keys
  chown hairbydemj:hairbydemj /home/hairbydemj/.ssh/authorized_keys
  chmod 0600 /home/hairbydemj/.ssh/authorized_keys
fi
# Caddy reads uploaded files directly, so it joins the hairbydemj group.
usermod -aG hairbydemj caddy

random() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }

# Database role: one password, kept only in the settings files.
DB_PASSWORD=""
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='hairbydemj'" | grep -q 1; then
  DB_PASSWORD="$(random 40)"
  sudo -u postgres psql -q -c "create role hairbydemj login password '$DB_PASSWORD'"
fi
for db in hairbydemj hairbydemj_staging hairbydemj_restore_test; do
  if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname='$db'" | grep -q 1; then
    sudo -u postgres createdb --owner=hairbydemj "$db"
  fi
done

make_instance() {
  local name="$1" base="$2" port="$3" db="$4" site="$5" admin="$6" api="$7" env
  install -d -m 0750 -o hairbydemj -g hairbydemj "$base" "$base/releases" "$base/incoming" "$base/shared" "$base/shared/uploads" "$base/shared/backups"
  env="$base/shared/.env"
  if [ -f "$env" ]; then
    echo "$env already exists; left as it is."
    return
  fi
  if [ -z "$DB_PASSWORD" ]; then
    echo "The database role already existed, so its password is not known here."
    echo "Write $env by hand from .env.example (docs/operations.md)."
    return
  fi
  {
    echo "# $name settings. SECRET: readable only by the hairbydemj user. Made by setup-server.sh on $(date -u +%F)."
    echo "# Every setting is explained in .env.example and docs/operations.md."
    echo "NODE_ENV=production"
    echo "HOST=127.0.0.1"
    echo "PORT=$port"
    echo "SITE_HOST=$site"
    echo "ADMIN_HOST=$admin"
    echo "API_HOST=$api"
    echo "PUBLIC_DIR=public"
    echo "LOG_LEVEL=info"
    echo "TRUST_PROXY=true"
    echo "DATABASE_URL=postgres://hairbydemj:$DB_PASSWORD@127.0.0.1:5432/$db"
    echo "AUTH_SECRET=$(random 64)"
    echo "MEDIA_DIR=$base/shared/uploads"
    echo "MAIL_TRANSPORT=smtp"
    echo "SMTP_HOST=127.0.0.1"
    echo "SMTP_PORT=25"
    echo "ALERT_EMAIL=$ALERT_EMAIL"
    if [ "$name" = production ]; then
      echo "BACKUP_REMOTE=hbd-backup"
      echo "RESTORE_TEST_DATABASE_URL=postgres://hairbydemj:$DB_PASSWORD@127.0.0.1:5432/hairbydemj_restore_test"
    fi
    echo
    echo "# Still to fill in (see .env.example): payment keys, carrier keys, MAIL_FROM,"
    echo "# DKIM_PRIVATE_KEY, push keys, Google and Apple sign-in IDs."
  } > "$env"
  chown hairbydemj:hairbydemj "$env"
  chmod 0600 "$env"
  echo "Wrote $env"
}
make_instance production /srv/hairbydemj 3000 hairbydemj hairbydemj.com admin.hairbydemj.com api.hairbydemj.com
make_instance staging /srv/hairbydemj-staging 3001 hairbydemj_staging staging.hairbydemj.com staging-admin.hairbydemj.com staging-api.hairbydemj.com

step "5. Services, timers, Caddy and the deployment rule"
install -m 0644 "$REPO"/deploy/systemd/*.service "$REPO"/deploy/systemd/*.timer /etc/systemd/system/
install -m 0440 "$REPO/deploy/sudoers/hairbydemj" /etc/sudoers.d/hairbydemj
visudo -cf /etc/sudoers.d/hairbydemj
systemctl daemon-reload
systemctl enable hairbydemj-web hairbydemj-worker hairbydemj-staging-web hairbydemj-staging-worker
systemctl enable --now hairbydemj-backup.timer hairbydemj-restore-test.timer hairbydemj-check.timer
install -d -m 0750 -o root -g caddy /etc/caddy/certs
install -d -m 0755 -o caddy -g caddy /var/log/caddy
install -m 0644 "$REPO/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile
if [ -f /etc/caddy/certs/origin.pem ] && [ -f /etc/caddy/certs/origin-key.pem ]; then
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl reload-or-restart caddy
else
  echo "Caddy is waiting for the Cloudflare origin certificate:"
  echo "  save it as /etc/caddy/certs/origin.pem and the key as /etc/caddy/certs/origin-key.pem,"
  echo "  then: chgrp caddy /etc/caddy/certs/*; chmod 0640 /etc/caddy/certs/*; systemctl reload-or-restart caddy"
fi

# SSH: no password logins once a key is in place for root or hairbydemj.
if [ -s /root/.ssh/authorized_keys ] || [ -s /home/hairbydemj/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/50-hairbydemj.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  systemctl reload ssh
else
  echo "No SSH key found, so password logins are still on. Add your key and run this again."
fi

echo
echo "Done. Next steps are in docs/operations.md (\"First-time set-up\"), from step 5."
