# Step by step: deploying hairbydemj

Every step to take the shop from the code on GitHub to a live website and
two apps taking real orders, in the order to do them. Tick each box as you
go. Where a step needs more detail, it names the guide that has it.

**Words used here**

- **VPS**: the Namecheap Quasar server the shop runs on.
- **Staging**: a private copy of the shop at staging.hairbydemj.com, for
  checking changes before they go live. It uses test payments.
- **Live** or **production**: the real shop at hairbydemj.com.
- **`develop` and `main`**: the two main branches on GitHub. Changes merged
  into `develop` go to staging; merging `develop` into `main` puts them live.
- **Secret**: a password or key. Secrets go only into the server's settings
  file, GitHub's secret store and your password manager; never into the code,
  an email or a chat.

**Before you start:** get a password manager (Bitwarden is free). Every
secret made below goes into it.

**Two things in the code to fix before Part 10** (they do not stop the
website; they affect the iPhone app):

1. The iPhone app has no entitlements file yet, which Apple needs for push
   notifications and for Sign in with Apple in App Store builds.
2. The server's default for `APNS_BUNDLE_ID` is `com.hairbydemj.app`, but the
   app's identifier is `com.hairbydemj.hairbydemj`. Step 5.8 sets it
   correctly, so this only matters if the setting is left out.

---

## Part 1. Accounts to open (start these first; some take days)

- [ ] **1.1 Paystack business account** (paystack.com), verified with the
  company's CAC documents and bank account. Verification can take a week
  or more. You get test keys at once and live keys after verification.
- [ ] **1.2 Stripe business account** (stripe.com), verified the same way.
  Stripe accepts Nigerian businesses through Stripe Atlas or a supported
  country entity; check what Stripe offers the company when you sign up.
- [ ] **1.3 Carrier accounts** for delivery abroad: any of DHL Express, UPS
  and FedEx (business accounts, then their developer portals). Each is
  optional; without any, only Nigerian delivery is offered. Details:
  `shipping.md`, "Getting each carrier ready".
- [ ] **1.4 Apple Developer Program** ($99 a year, developer.apple.com),
  enrolled as the company (needs a D-U-N-S number, free, can take a week).
- [ ] **1.5 Google Play Console** ($25 once, play.google.com/console), as
  an organisation.
- [ ] **1.6 Cloudflare** (free plan, cloudflare.com).
- [ ] **1.7 A Google account for backups** (a new Gmail just for this is
  best; the free 15 GB is enough to start).
- [ ] **1.8 A mailbox for hello@hairbydemj.com** (or the address customers
  should write to), so replies to the shop's emails reach someone. Namecheap
  Private Email or Zoho Mail's free plan both work. The shop sends its own
  emails; this mailbox is only for receiving.
- [ ] **1.9 Firebase** (free, console.firebase.google.com), signed in with
  the company's Google account. Used for Android push notifications.

---

## Part 2. Put the code on `main` (safe: nothing goes live yet)

GitHub only runs the deployment and uptime workflows from `main`, so they
must be on `main` before anything can be deployed. Until the server's
secrets are added (Part 6), the deployment workflow does nothing.

- [ ] **2.1** Merge any open pull requests into `develop` (at the time of
  writing: #31, homepage pictures).
- [ ] **2.2** On GitHub, open a pull request from `develop` into `main`
  (Pull requests, New, base `main`, compare `develop`), check that the
  checks pass, and merge it.
- [ ] **2.3** Check: on GitHub, with the branch set to `main`, the folder
  `docs/` has `operations.md` and this file.

---

## Part 3. The server

- [ ] **3.1 Order the VPS** at Namecheap: a Quasar plan, with **Ubuntu 24.04
  LTS**. Note its IP address (call it `SERVER_IP` below).
- [ ] **3.2 Your SSH key.** On your computer, if you do not have one:
  `ssh-keygen -t ed25519` (press Enter for the defaults; choose a
  passphrase). Give the public half (`~/.ssh/id_ed25519.pub`) to Namecheap
  when setting up the VPS, or add it after logging in as root to
  `/root/.ssh/authorized_keys`. Check you can log in: `ssh root@SERVER_IP`.
- [ ] **3.3 The deploy key** (lets GitHub put new versions on the server).
  On your computer: `ssh-keygen -t ed25519 -f hairbydemj-deploy -C github-deploy`
  and press Enter twice for **no** passphrase. This makes two files:
  `hairbydemj-deploy` (private: goes into GitHub in Part 6, and your
  password manager) and `hairbydemj-deploy.pub` (public: used in 3.5).
- [ ] **3.4 Port 25** (needed to send emails). Log in to the VPS and run
  `nc -vz gmail-smtp-in.l.google.com 25`. If it does not say "succeeded",
  ask Namecheap support to open outgoing port 25 for this server.
- [ ] **3.5 Run the set-up script** on the VPS, as root:

  ```
  git clone -b main https://github.com/projectiles-tech-hub/hairbydemj.git /root/hairbydemj
  cd /root/hairbydemj
  bash deploy/setup-server.sh --deploy-key "PASTE THE ONE LINE FROM hairbydemj-deploy.pub" --alert-email YOUR_EMAIL
  ```

  It takes about ten minutes. It updates Ubuntu, turns on automatic security
  updates, sets the firewall, installs PostgreSQL, Node.js 24, Caddy,
  libvips, ffmpeg, Postfix and rclone, creates the `hairbydemj` user, the
  live and staging folders and databases, writes a settings file for each
  with new random secrets, and installs the services. What each part does:
  `operations.md`, "First-time set-up", step 5.
- [ ] **3.6** Check the end of its output says "Done.". If it says
  "password logins are still on", your SSH key was not found: add it (3.2)
  and run the script again (it is safe to run again).
- [ ] **3.7 Reverse DNS.** Ask Namecheap support to set the reverse DNS
  (PTR) of `SERVER_IP` to `mail.hairbydemj.com`. Mail providers check it.

---

## Part 4. Cloudflare and the domain

- [ ] **4.1** If hairbydemj.com is attached to a Vercel project (the old
  design preview), remove the domain from that project in Vercel first.
- [ ] **4.2** In Cloudflare, "Add a site": `hairbydemj.com`, free plan.
  Cloudflare shows two nameservers.
- [ ] **4.3** At Namecheap (Domain List, Manage, Nameservers, "Custom DNS"),
  enter Cloudflare's two nameservers. It can take up to a day to switch;
  Cloudflare emails when it is active.
- [ ] **4.4 DNS records for the shop** (Cloudflare, DNS, Records), each type
  `A`, value `SERVER_IP`, proxy status **Proxied** (orange cloud):
  `@`, `www`, `admin`, `api`, `staging`, `staging-admin`, `staging-api`.
- [ ] **4.5 DNS records for email**, proxy status **DNS only** (grey cloud):

  | Type | Name | Value |
  | --- | --- | --- |
  | A | `mail` | `SERVER_IP` |
  | TXT | `@` | `v=spf1 ip4:SERVER_IP -all` (if your mailbox service from 1.8 also sends mail, add its include before `-all`, for example `include:zoho.com`) |
  | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:YOUR_EMAIL` (change `p=none` to `p=quarantine` after two weeks of good reports) |
  | MX | `@` | As your mailbox service from 1.8 tells you |

  The DKIM record is added in 5.4.
- [ ] **4.6 Cloudflare settings:** SSL/TLS, Overview: **Full (strict)**.
  SSL/TLS, Edge Certificates: "Always Use HTTPS" on, minimum TLS 1.2.
  Security, Bots: "Bot Fight Mode" on.
- [ ] **4.7 Origin certificate.** SSL/TLS, Origin Server, "Create
  Certificate": keep RSA, hostnames `hairbydemj.com` and `*.hairbydemj.com`,
  15 years. Cloudflare shows two blocks of text. On the VPS, as root:

  ```
  nano /etc/caddy/certs/origin.pem       # paste the "Origin Certificate" block, save
  nano /etc/caddy/certs/origin-key.pem   # paste the "Private Key" block, save
  chgrp caddy /etc/caddy/certs/*; chmod 0640 /etc/caddy/certs/*
  caddy validate --config /etc/caddy/Caddyfile && systemctl reload-or-restart caddy
  ```

  Keep the private key in your password manager too.

---

## Part 5. The live settings file

The set-up script wrote `/srv/hairbydemj/shared/.env` (live) and
`/srv/hairbydemj-staging/shared/.env` (staging) with the database password,
`AUTH_SECRET` and the basics. Now add the rest. Edit as root with
`nano /srv/hairbydemj/shared/.env`. Every setting is explained in
`.env.example`. Never paste these values anywhere else except your password
manager.

- [ ] **5.1 Copy both files into your password manager** as they are now.
- [ ] **5.2 Email sender** (both files):

  ```
  MAIL_FROM=hairbydemj <hello@hairbydemj.com>
  MAIL_REPLY_TO=hello@hairbydemj.com
  DKIM_DOMAIN=hairbydemj.com
  DKIM_SELECTOR=mail
  ```

- [ ] **5.3 The DKIM key** (signs every email). On the VPS, as root:

  ```
  cd /root && openssl genrsa -out dkim.pem 2048
  openssl rsa -in dkim.pem -pubout -outform der | base64 -w0; echo      # the PUBLIC half, for 5.4
  awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' dkim.pem; echo          # the PRIVATE key on one line
  ```

  Add `DKIM_PRIVATE_KEY=` followed by the one-line private key to **both**
  settings files. Save the private key in your password manager, then
  `rm /root/dkim.pem`.
- [ ] **5.4 DKIM DNS record** in Cloudflare, **DNS only**: type `TXT`, name
  `mail._domainkey`, value `v=DKIM1; k=rsa; p=` followed by the public half
  from 5.3.
- [ ] **5.5 Payments: test keys first** (both files for now; the live file
  switches to live keys in Part 12). From the Paystack dashboard (Settings,
  API Keys and Webhooks) and Stripe (Developers, API keys):

  ```
  PAYSTACK_SECRET_KEY=sk_test_...
  PAYSTACK_PUBLIC_KEY=pk_test_...
  STRIPE_SECRET_KEY=sk_test_...
  STRIPE_PUBLISHABLE_KEY=pk_test_...
  ```

- [ ] **5.6 Payment webhooks (test mode).** Paystack test webhook URL:
  `https://staging-api.hairbydemj.com/webhooks/paystack`. Stripe, test mode,
  Developers, Webhooks, "Add endpoint":
  `https://staging-api.hairbydemj.com/webhooks/stripe` with the events
  `payment_intent.succeeded`, `payment_intent.payment_failed`,
  `refund.updated`, `charge.refund.updated`, `refund.failed`. Put that
  endpoint's signing secret in the staging file: `STRIPE_WEBHOOK_SECRET=whsec_...`.
- [ ] **5.7 Carriers: test addresses first** (staging file), for each carrier
  you have: the keys, account number and the test address from `shipping.md`
  (for example `DHL_API_URL=https://express.api.dhl.com/mydhlapi/test`).
- [ ] **5.8 Apple push** (both files, once the Apple account is ready). In
  the Apple Developer site, Keys, "+", tick "Apple Push Notifications
  service", download the `.p8` file (only once). Then:

  ```
  APNS_KEY_ID=the key's ID
  APNS_TEAM_ID=your team ID (Membership page)
  APNS_PRIVATE_KEY=the .p8 file on one line (use the awk command from 5.3 on it)
  APNS_BUNDLE_ID=com.hairbydemj.hairbydemj
  APNS_URL=https://api.push.apple.com
  ```

  `APNS_BUNDLE_ID` must be set exactly like this: it is the app's real
  identifier.
- [ ] **5.9 Android push** (both files). Firebase console: create a project,
  add an Android app `com.hairbydemj.hairbydemj` and an iOS app with the same
  identifier. Project settings, Service accounts, "Generate new private
  key". From that file:

  ```
  FCM_PROJECT_ID=project_id from the file
  FCM_CLIENT_EMAIL=client_email from the file
  FCM_PRIVATE_KEY=private_key from the file (it is already one line with \n)
  ```

  Then delete the downloaded file. Keep the Firebase app settings (API key,
  project ID, sender ID, the two app IDs) for Part 10.
- [ ] **5.10 Google sign-in** (optional). Google Cloud console, the same
  project as Firebase, APIs and Services, Credentials, "Create OAuth client
  ID": a **Web** client (authorised JavaScript origins
  `https://hairbydemj.com` and `https://staging.hairbydemj.com`), an
  **Android** client (package `com.hairbydemj.hairbydemj` and the signing
  key's SHA-1 from the Play Console's App signing page, so this one waits
  until step 10.5), and an **iOS**
  client (bundle ID `com.hairbydemj.hairbydemj`). In both files:
  `GOOGLE_CLIENT_IDS=web client ID,android client ID,ios client ID`.
- [ ] **5.11 Sign in with Apple** (needed on iPhone when Google sign-in is
  offered). In the Apple Developer site, turn on "Sign in with Apple" for the
  identifier `com.hairbydemj.hairbydemj`. In both files:
  `APPLE_CLIENT_IDS=com.hairbydemj.hairbydemj`.
- [ ] **5.12** Copy both finished files into your password manager again.

The services read the files when they start; the first deployment (Part 7)
starts them. After any later change: `systemctl restart hairbydemj-web hairbydemj-worker`
(live) or `systemctl restart hairbydemj-staging-web hairbydemj-staging-worker`.

---

## Part 6. Connect GitHub to the server

- [ ] **6.1** On your computer: `ssh-keyscan -t ed25519 SERVER_IP` and copy
  the line it prints.
- [ ] **6.2** On GitHub: the repository, Settings, Environments, "New
  environment" named `staging`. Under "Deployment branches", choose
  "Selected branches" and add both `develop` and `main` (GitHub runs the
  automatic deployments from `main`, even for staging). Add three secrets:
  - `DEPLOY_HOST`: `SERVER_IP`
  - `DEPLOY_SSH_KEY`: the whole content of the file `hairbydemj-deploy` (from 3.3)
  - `DEPLOY_KNOWN_HOSTS`: the line from 6.1
- [ ] **6.3** The same again for an environment named `production`, with
  the branch `main` and the same three secrets. Tick "Required reviewers"
  and add yourself if you want to approve every live deployment.

---

## Part 7. First deployment, to staging

- [ ] **7.1** GitHub, Actions, "Deploy", "Run workflow": branch `develop`,
  target `staging`. Wait for the green tick (about five minutes). It builds
  the shop, copies it to the server, sets up the database tables and starts
  the staging services.
- [ ] **7.2** Open https://staging.hairbydemj.com. You should see the shop,
  empty of products.
- [ ] **7.3 Your owner account on staging.** On the VPS:

  ```
  sudo -iu hairbydemj
  cd /srv/hairbydemj-staging/current
  node --env-file=../shared/.env dist/server/accounts/cli.js invite-owner "Emmanuel Chukwuka Oraegbu" YOUR_EMAIL
  exit
  ```

  Open the link it prints, choose a password, and scan the key with an
  authenticator app (Google Authenticator or 1Password). Then sign in at
  https://staging-admin.hairbydemj.com.
- [ ] **7.4 Email check.** In the staging admin, Emails, open any email,
  "Send me a test". In Gmail, open it, "Show original": SPF, DKIM and DMARC
  should all say PASS. If not, check Parts 4.5, 5.3 and 5.4.

---

## Part 8. Set the shop up on staging and test everything

Everything here is done in the staging admin, so you learn it before the
live shop.

- [ ] **8.1 Store settings:** shop name, support email, WhatsApp number.
- [ ] **8.2 Shipping settings** (details: `shipping.md`, "Set up in the admin"):
  the store address printed on labels; your boxes; each carrier you have,
  switched on with its markup; the delivery zones and prices inside Nigeria.
- [ ] **8.3 Payments and currencies:** check the four currencies and their
  markups and rounding.
- [ ] **8.4 Staff:** invite your staff and give each a role (Staff and roles).
- [ ] **8.5 A few products** with photos, lengths, prices and stock, a
  category picture, and the homepage banner pictures (Homepage).
- [ ] **8.6 The test-mode check.** On the VPS:

  ```
  sudo -iu hairbydemj
  cd /srv/hairbydemj-staging/current
  node --env-file=../shared/.env dist/server/ops/provider-check.js
  exit
  ```

  Every line should say "ok". It starts a test payment in each currency and
  asks each carrier for test quotes; nobody is charged.
- [ ] **8.7 Test orders** with the test cards in `testing.md`: one in naira
  (Paystack) and one each in dollars, pounds and euros (Stripe). For each,
  check the order shows as paid in the admin, the confirmation email
  arrives, a label can be bought (carriers in test mode), and a refund from
  the admin shows in the provider's dashboard.
- [ ] **8.8 FedEx only:** print a test label for each FedEx service and send
  them to FedEx for label certification (`shipping.md`). FedEx turns on the
  live key after that.

---

## Part 9. Backups

- [ ] **9.1** On your computer, install rclone (rclone.org/downloads) and run
  `rclone authorize "drive"`. Sign in with the backup Google account (1.7)
  and copy the long text it prints.
- [ ] **9.2** On the VPS:

  ```
  sudo -iu hairbydemj
  RCLONE_CONFIG=/srv/hairbydemj/shared/rclone.conf rclone config
  ```

  - `n` (new remote), name `gdrive`, storage `drive`, leave client ID and
    secret empty, scope `drive.file`, leave the rest as offered, answer `n`
    to "Use web browser", and paste the text from 9.1.
  - `n` again, name `hbd-backup`, storage `crypt`, remote
    `gdrive:hairbydemj-backups`, filename encryption `standard`, directory
    name encryption `true`, then choose to type **two different long
    passwords**. **Save both in your password manager now**: without them
    the backups cannot be opened by anyone, ever.
  - `q` to finish, then `exit`.
- [ ] **9.3** Test it (after the first live deployment in Part 11, since
  the scripts run from the live copy):

  ```
  sudo -iu hairbydemj
  /srv/hairbydemj/current/deploy/bin/backup.sh production
  /srv/hairbydemj/current/deploy/bin/restore-test.sh production
  exit
  ```

  You get an email saying the restore test passed. From then on, backups run
  every night and the restore test every month by themselves.

---

## Part 10. The apps

Details for every step: `launch.md`, "Signing the apps" and "Sending the
apps for review".

- [ ] **10.1 Android upload key.** On your computer:
  `keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`.
  Save the file and its passwords in your password manager.
- [ ] **10.2 Apple signing files:** an Apple Distribution certificate
  (exported as .p12 with a password), an App Store provisioning profile for
  `com.hairbydemj.hairbydemj`, and an App Store Connect API key (.p8).
- [ ] **10.3 GitHub secrets** (Settings, Secrets and variables, Actions,
  "Secrets"): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `IOS_CERTIFICATE_P12_BASE64`,
  `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`,
  `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
  `APP_STORE_CONNECT_KEY_P8`, and later `PLAY_SERVICE_ACCOUNT_JSON` (10.6).
- [ ] **10.4 GitHub variables** (same page, "Variables"): `APPLE_TEAM_ID`;
  the Firebase settings from 5.9 as `APP_FIREBASE_API_KEY`,
  `APP_FIREBASE_PROJECT_ID`, `APP_FIREBASE_SENDER_ID`,
  `APP_FIREBASE_ANDROID_APP_ID`, `APP_FIREBASE_IOS_APP_ID`; the WhatsApp
  number as `APP_WHATSAPP`; for Google sign-in `APP_GOOGLE_SERVER_CLIENT_ID`
  (the web client ID) and `APP_GOOGLE_IOS_CLIENT_ID`; and
  `APP_APPLE_SIGN_IN` = `true`. Leave `APP_API_BASE` and `APP_SITE_BASE`
  unset (they default to the live shop).
- [ ] **10.5 First builds.** Actions, "App release", "Run workflow", track
  `internal`. The iPhone build goes to TestFlight. The Android bundle is kept
  as a download on the run's page: in the Play Console, create the app
  (`com.hairbydemj.hairbydemj`), turn on Play App Signing, and upload that
  first bundle by hand to "Internal testing".
- [ ] **10.6 Automatic Play uploads.** In Google Cloud, create a service
  account, make a JSON key, invite its email in the Play Console (Users and
  permissions) with release rights, and add the JSON as the secret
  `PLAY_SERVICE_ACCOUNT_JSON`.
- [ ] **10.7 Beta testers:** invite them through TestFlight and Play internal
  testing; they test against the live server once Part 11 is done, and the
  website on staging. What to ask them: `testing.md`, "Testing with real
  people".
- [ ] **10.8 Store listings:** fill in both stores' listings, screenshots,
  privacy answers and (for Apple) the reviewer notes and a reviewer account,
  from `launch.md`.

---

## Part 11. First deployment to the live server

- [ ] **11.1** GitHub, Actions, "Deploy", "Run workflow": branch `main`,
  target `production`. Approve it if you set "Required reviewers".
- [ ] **11.2** Open https://hairbydemj.com and https://admin.hairbydemj.com.
- [ ] **11.3 Your owner account on the live shop**, the same as 7.3 but in
  `/srv/hairbydemj/current`:

  ```
  sudo -iu hairbydemj
  cd /srv/hairbydemj/current
  node --env-file=../shared/.env dist/server/accounts/cli.js invite-owner "Emmanuel Chukwuka Oraegbu" YOUR_EMAIL
  exit
  ```

- [ ] **11.4** Do Part 9.3 (backup test) now.
- [ ] **11.5 Uptime checks.** GitHub, Settings, Secrets and variables,
  Actions, Variables, new variable `UPTIME_URLS` with these four lines:

  ```
  https://hairbydemj.com/health?db=1
  https://admin.hairbydemj.com/health
  https://api.hairbydemj.com/health
  https://hairbydemj.com/
  ```

  Then on the repository's main page, "Watch", "All activity", so GitHub
  emails you if the shop stops answering.
- [ ] **11.6** Set up the live shop as in Part 8.1 to 8.5, this time with
  all the real products, photos, prices, stock, pages (about, shipping,
  returns, privacy, terms, FAQ), homepage pictures and staff.

---

## Part 12. Switch the live shop to real payments

When Paystack and Stripe have verified the business (Part 1). Details:
`launch.md`, "Switching to live payments and carriers".

- [ ] **12.1** In `/srv/hairbydemj/shared/.env` (live only): the **live**
  Paystack and Stripe keys (`sk_live_`, `pk_live_`).
- [ ] **12.2** Paystack (live mode) webhook URL:
  `https://api.hairbydemj.com/webhooks/paystack`.
- [ ] **12.3** Stripe (live mode) webhook endpoint:
  `https://api.hairbydemj.com/webhooks/stripe` with the same five events as
  5.6, and its **live** signing secret in `STRIPE_WEBHOOK_SECRET`.
- [ ] **12.4** Carriers: live keys, and delete the `*_API_URL` test lines.
- [ ] **12.5** `systemctl restart hairbydemj-web hairbydemj-worker`.
- [ ] **12.6 The launch check:**

  ```
  sudo -iu hairbydemj
  cd /srv/hairbydemj/current
  node --env-file=../shared/.env dist/server/ops/launch-check.js
  exit
  ```

  Fix every line that says PROBLEM, then run it again until it says "Ready".
- [ ] **12.7** Place one real order in naira and one in another currency with
  your own card, check both, and refund both from the admin.

---

## Part 13. Send the apps for review (about a week before launch)

- [ ] **13.1** Actions, "App release", "Run workflow", track `production`.
- [ ] **13.2** Play Console: send the draft release for review, with
  **managed publishing** on so it waits for you.
- [ ] **13.3** App Store Connect: choose the build, set "Manually release
  this version", and send for review.

---

## Part 14. Launch day

- [ ] **14.1** Run the launch check (12.6) once more: it must say "Ready".
- [ ] **14.2** Play Console: "Publish changes".
- [ ] **14.3** App Store Connect: "Release this version".
- [ ] **14.4** When both store links work, announce the shop.
- [ ] **14.5** In Cloudflare, after two weeks of DMARC reports showing your
  emails pass, change the `_dmarc` record to `p=quarantine`.

---

## Part 15. After launch

- **Changes:** merged into `develop` they go to staging by themselves; check
  them there, then merge `develop` into `main` to put them live.
- **Watching:** the list in `launch.md`, "The first days".
- **When an alert email or a "downtime" issue arrives:** `operations.md`,
  "When an alert arrives".
- **Going back a version, restoring a backup, rebuilding the server:**
  `operations.md`.
- **The old design preview on Vercel** is not the shop. Leave it or delete
  that Vercel project; it does not affect the live site.
