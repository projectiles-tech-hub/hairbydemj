# Operations guide

How the live shop runs, how changes go live, how it is backed up and
watched, and what to do when something goes wrong. Module 19.

## The picture

```
Visitors and the app
      |
  Cloudflare (free plan: DNS, caching, attack protection, HTTPS to visitors)
      |
  Namecheap Quasar VPS, Ubuntu 24.04 LTS
      |-- Caddy (ports 80 and 443): serves uploaded photos and videos from disk,
      |     passes everything else on
      |-- Live shop     /srv/hairbydemj          port 3000  hairbydemj-web, hairbydemj-worker
      |-- Staging shop  /srv/hairbydemj-staging  port 3001  hairbydemj-staging-web, hairbydemj-staging-worker
      |-- PostgreSQL (databases hairbydemj, hairbydemj_staging, hairbydemj_restore_test)
      |-- Postfix (sends the shop's emails; accepts nothing from outside)
      '-- Timers: daily backup, monthly restore test, hourly server check
```

| Address | What |
| --- | --- |
| hairbydemj.com, admin.hairbydemj.com, api.hairbydemj.com | The live shop (`main` branch) |
| staging.hairbydemj.com, staging-admin.hairbydemj.com, staging-api.hairbydemj.com | Staging (`develop` branch), hidden from search engines |
| www.hairbydemj.com | Sends visitors to hairbydemj.com |

Staging uses one-level names (`staging-admin`, not `admin.staging`) because
Cloudflare's free certificate covers only one level below hairbydemj.com.

Each shop's folder holds `releases/` (the last 5 versions), `current` (a
link to the version running), `incoming/` (uploads from GitHub Actions) and
`shared/`: the settings file `.env`, `uploads/` (photos and videos),
`backups/` (local copies and status files) and, on the live shop,
`rclone.conf` (the backup connection).

## Where the secrets are

Nothing secret is in the repository. Secrets are only in these places:

| Secret | Where |
| --- | --- |
| Database password, `AUTH_SECRET`, payment, carrier, DKIM and push keys | `/srv/hairbydemj/shared/.env` and `/srv/hairbydemj-staging/shared/.env` on the server (readable only by the hairbydemj user) |
| The deploy key (private half) and the server's fingerprint | GitHub: Settings > Environments > production and staging > secrets |
| Cloudflare origin certificate key | `/etc/caddy/certs/origin-key.pem` on the server |
| Backup encryption passwords and the Google Drive sign-in | `/srv/hairbydemj/shared/rclone.conf` on the server |

**Keep your own copy** of the two backup encryption passwords and of the
live `.env` file in a password manager. Without the passwords, the backups
cannot be opened by anyone, including you.

## First-time set-up

What the owner provides: the Namecheap Quasar VPS (Ubuntu 24.04), a free
Cloudflare account, a Google account for the backups (the free 15 GB is
enough to start), and the domain.

1. **Cloudflare.** Add hairbydemj.com to Cloudflare (free plan), then at
   Namecheap change the domain's nameservers to the two Cloudflare gives.
2. **DNS records** in Cloudflare, all "Proxied" (orange cloud), pointing at
   the VPS's IP address: `A` records for `@`, `www`, `admin`, `api`,
   `staging`, `staging-admin`, `staging-api`. For email, also the SPF,
   DKIM and DMARC records in `notifications.md` (those are "DNS only").
   Point `mail.hairbydemj.com` (DNS only) at the VPS too, and ask Namecheap
   support to set the server's reverse DNS to `mail.hairbydemj.com`.
3. **Cloudflare settings:** SSL/TLS mode **Full (strict)**; "Always Use
   HTTPS" on; minimum TLS 1.2; Bot Fight Mode on. Under SSL/TLS > Origin
   Server, create an **Origin Certificate** for `hairbydemj.com` and
   `*.hairbydemj.com` (15 years) and keep the two pieces of text for step 5.
4. **Your SSH key and a deploy key.** On your own computer:
   `ssh-keygen -t ed25519 -f hairbydemj-deploy -C github-deploy` makes the
   deploy key (no passphrase). Add your personal public key to the VPS when
   Namecheap sets it up (or to `/root/.ssh/authorized_keys`).
5. **Run the set-up script** on the VPS as root:

   ```
   git clone https://github.com/projectiles-tech-hub/hairbydemj.git /root/hairbydemj
   cd /root/hairbydemj
   bash deploy/setup-server.sh --deploy-key "ssh-ed25519 AAAA... github-deploy" --alert-email you@example.com
   ```

   For `--deploy-key`, paste the one line in `hairbydemj-deploy.pub` from step 4.

   It updates Ubuntu, turns on automatic security updates (with a restart
   at 03:30 UTC when one needs it), sets the firewall (only SSH, HTTP,
   HTTPS), installs fail2ban, PostgreSQL, Node.js 24, Caddy, libvips,
   ffmpeg, Postfix and rclone, creates the hairbydemj user, the folders,
   the three databases, a settings file for each shop with new random
   secrets, and the services. It turns off SSH password logins once a key
   is in place. It can be run again safely.

   Then save the origin certificate from step 3 as
   `/etc/caddy/certs/origin.pem` and its key as
   `/etc/caddy/certs/origin-key.pem`, and run:
   `chgrp caddy /etc/caddy/certs/*; chmod 0640 /etc/caddy/certs/*; systemctl reload-or-restart caddy`.
6. **Fill in the settings.** Edit `/srv/hairbydemj/shared/.env` (and the
   staging one) as root with `nano`, adding what `.env.example` lists:
   payment keys (test keys on staging), carrier keys, `MAIL_FROM`,
   `DKIM_PRIVATE_KEY`, push keys, Google and Apple sign-in IDs. Copy the
   live file into your password manager.
7. **GitHub.** In the repository's Settings > Environments, create
   `production` (tick "Required reviewers" if you want to approve each
   live deployment, and limit it to the `main` branch) and `staging`
   (limited to `develop`). In each, add the secrets:
   - `DEPLOY_HOST`: the VPS's IP address;
   - `DEPLOY_SSH_KEY`: the whole private key file `hairbydemj-deploy`;
   - `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan -t ed25519 <the VPS's IP>`.
   Optional variables: `DEPLOY_PORT` (if SSH is not on 22), `DEPLOY_USER`.
8. **First deployment.** Actions > Deploy > Run workflow > staging (from
   `develop`), then production (from `main`). Each one runs the database
   migrations. Then on the server, once, as the hairbydemj user
   (`sudo -iu hairbydemj`), in `/srv/hairbydemj/current`:
   `node --env-file=../shared/.env dist/server/accounts/cli.js invite-owner`
   to get the owner's admin invitation (`accounts.md`). Same for staging.
9. **Backups to Google Drive** (as the hairbydemj user):
   1. On your own computer, install rclone and run `rclone authorize "drive"`;
      sign in with the backup Google account and copy the long token it prints.
   2. On the server: `RCLONE_CONFIG=/srv/hairbydemj/shared/rclone.conf rclone config`:
      - `n` (new remote), name `gdrive`, type `drive`, leave client id and
        secret empty, scope `drive.file`, answer `n` to "Use web browser"
        and paste the token from step 1;
      - `n` again, name `hbd-backup`, type `crypt`, remote
        `gdrive:hairbydemj-backups`, filename encryption `standard`,
        directory name encryption `true`, then choose **two different long
        passwords** and save both in your password manager.
   3. Test it: `/srv/hairbydemj/current/deploy/bin/backup.sh production`,
      then `/srv/hairbydemj/current/deploy/bin/restore-test.sh production`.
      You get an email with the restore test's result.
10. **Uptime checks.** In GitHub, Settings > Secrets and variables > Actions >
    Variables, add `UPTIME_URLS` with these lines:

    ```
    https://hairbydemj.com/health?db=1
    https://admin.hairbydemj.com/health
    https://api.hairbydemj.com/health
    https://hairbydemj.com/
    ```

    Optionally `UPTIME_NOTIFY` with GitHub usernames to mention. Make sure you
    "Watch" the repository (All activity, or Custom > Issues) so GitHub emails
    you when the downtime issue opens.

## Everyday

**Changes go live by merging.** Merging into `develop` puts the change on
staging; merging `develop` into `main` puts it live. After the checks pass,
GitHub Actions (`.github/workflows/deploy.yml`) builds the shop, copies it
to the server, runs any new database migrations, switches to the new
version and restarts. It then asks the shop's `/health?db=1`; if the new
version does not answer within about 40 seconds, the previous version is
put back automatically and you get an email. The restart takes a second
or two.

**Looking at what the shop is doing** (on the server):

| To see | Command |
| --- | --- |
| Live web server log | `journalctl -u hairbydemj-web -f` |
| Worker log | `journalctl -u hairbydemj-worker -f` |
| Backups | `journalctl -u hairbydemj-backup` |
| Which version is running | `cat /srv/hairbydemj/current/COMMIT` |
| Visits (Caddy) | `tail -f /var/log/caddy/3000.log` |
| Timers and when they run next | `systemctl list-timers 'hairbydemj*'` |

**Restarting:** `sudo systemctl restart hairbydemj-web hairbydemj-worker`.

**Going back a version** without a new deployment, as the hairbydemj user:
`/srv/hairbydemj/current/deploy/bin/rollback.sh production`. Database
migrations are never undone: they only ever add, so an older version still
works with them.

**Changing a setting:** edit the `.env` file, then restart both services.

**Updates:** Ubuntu installs security updates every day by itself. Once a
month, log in and run `sudo apt update && sudo apt upgrade`, then check the
shop. Node.js stays on version 24 (LTS) until it is replaced by the next LTS.

## Backups

| What | How often | Kept |
| --- | --- | --- |
| The database (`pg_dump`, checked it reads back) | Daily, 02:30 Lagos time | 35 days; the copy from the 1st of each month for 13 months; 7 days on the server too |
| Uploaded photos and videos | Daily, mirrored | Files changed or deleted are kept 90 days |
| The live settings file | Daily | 35 days |

All of it is encrypted on the server before it goes to Google Drive (rclone
"crypt"), so Google holds only scrambled files. The script refuses to send
anything if the remote is not encrypted.

**Monthly restore test** (the 3rd of each month): downloads the newest
database copy, restores it into the separate `hairbydemj_restore_test`
database, compares it with the live one, and checks five uploaded files
against the live copies. You get an email with the result either way.

**Restoring after a problem** (replaces the live data, so it asks first),
as the hairbydemj user:

```
/srv/hairbydemj/current/deploy/bin/restore.sh production            # shows what it would do
/srv/hairbydemj/current/deploy/bin/restore.sh production --yes      # newest copy
/srv/hairbydemj/current/deploy/bin/restore.sh production 2027-03-14 --yes
```

**Rebuilding on a new server:** steps 1 to 7 of the first-time set-up
(pointing DNS at the new server), put the live `.env` back from your
password manager (or from the backup's `settings/` folder), set up rclone
with the **same two passwords** (step 9), deploy, then run `restore.sh
production --yes`.

## Monitoring

| Check | How | You hear by |
| --- | --- | --- |
| The shop answers from outside | GitHub Actions every 5 minutes (`uptime.yml`); three tries over 30 seconds before it counts | A GitHub issue labelled "downtime" (emailed to watchers); closed with a note when it answers again |
| Services running, disk under 85%, a backup in the last 26 hours, database answering | Hourly on the server (`check-server.sh`) | Email to `ALERT_EMAIL`, repeated every 6 hours while it lasts, and a "Fixed" email |
| A service keeps failing | systemd gives up after 10 failures in 5 minutes | Email |
| Backup or restore test fails | The timer's job fails | Email |
| A deployment fails its health check | `release.sh` | Email, and the previous version is put back |

Alerts are sent through Postfix with the shop's own DKIM signature, like
every other email. If email itself is broken, alerts still go to the system
log (`journalctl -t hairbydemj`).

Note: GitHub turns off scheduled workflows in a public repository after 60
days with no commits; a commit, or "Enable workflow" on the Actions tab,
turns the uptime check back on.

## When an alert arrives

1. **The shop is not answering.** Open https://hairbydemj.com. If Cloudflare
   shows its own error page "Host error" (521, 522, 523), the server is down
   or Caddy is stopped: log in to the VPS (or restart it from Namecheap's
   control panel) and run `sudo systemctl status caddy hairbydemj-web`. If the
   shop shows an error, see `journalctl -u hairbydemj-web -n 200`.
2. **A service stopped.** `sudo systemctl status <name>` shows why;
   `sudo systemctl restart <name>` starts it again.
3. **The disk is nearly full.** `sudo du -sh /srv/* /var/log` shows what is
   large. Local backup copies older than 7 days are removed by themselves;
   `sudo journalctl --vacuum-size=500M` trims the system log. If uploads have
   grown, it is time for a bigger plan (Magnetar).
4. **A backup failed.** `journalctl -u hairbydemj-backup -n 100`. The usual
   cause is the Google sign-in expiring: repeat step 9.1, then on the server
   `RCLONE_CONFIG=/srv/hairbydemj/shared/rclone.conf rclone config reconnect gdrive:`.
5. **A deployment failed.** The previous version is already back. The
   GitHub Actions run and `journalctl -u hairbydemj-web -n 200` show why; fix
   it in a new pull request.

## Cloudflare notes

- Cloudflare's free plan accepts uploads up to 100 MB per request, which
  limits product videos uploaded through the admin (`media.md`).
- Photos, videos, styles and scripts are cached by Cloudflare (they are sent
  with long cache times); pages are not, so prices and stock are always current.
- Live chat streams pass through Cloudflare; the server sends a small message
  every 25 seconds so they stay open.
- Caddy believes the visitor's address only from Cloudflare's own addresses
  (listed in `deploy/caddy/Caddyfile`, from https://www.cloudflare.com/ips/;
  check the list once a year).

## Files

| File | What |
| --- | --- |
| `deploy/setup-server.sh` | Sets up a new server |
| `deploy/caddy/Caddyfile` | Caddy's settings |
| `deploy/systemd/` | Services (web, worker, for live and staging) and timers (backup, restore test, check, alert) |
| `deploy/sudoers/hairbydemj` | Lets deployments restart only the shop's services |
| `deploy/bin/release.sh`, `rollback.sh` | Putting a version live; going back one |
| `deploy/bin/backup.sh`, `restore-test.sh`, `restore.sh` | Backups, the monthly test, restoring |
| `deploy/bin/check-server.sh`, `alert.sh` | The hourly check; emailing an alert |
| `server/ops/alert.ts` | Builds and sends the alert email |
| `.github/workflows/deploy.yml`, `uptime.yml` | Deployments; the outside uptime check |
