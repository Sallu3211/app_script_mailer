# Cold Email Sequencer

Self-hosted cold outreach: Google Sheets is the control panel and system of
record, Google Apps Script is the scheduler, and a small Node relay service
does the actual SMTP sending and IMAP reply-polling against Titan mailboxes
(Apps Script can't speak SMTP/IMAP directly — it has no raw socket access).

## Current deployment (this instance)

- **Sheet / Apps Script**: bound to the spreadsheet created via `clasp create`.
  Web App URL: `https://script.google.com/macros/s/AKfycbxxAV3AfgI92ZvaPiJCkFTsOkeng8K0on26FUdQENkw2CPg0IOreGx7M7SfPY9Ba5rKdQ/exec`
- **Relay service**: runs on a Hetzner VPS (`157.180.121.10`, Helsinki), **not**
  Railway — Railway blocks all outbound SMTP ports (25/465/587/2525) on
  anything below their paid Pro plan, which broke sending entirely. Hetzner
  has no such restriction and is a flat monthly cost regardless of load.
  - Public HTTPS URL: `https://relay.byterise.online:8443`
  - Runs as a systemd service (`cold-email-relay`, auto-restarts, survives
    reboots): `/opt/cold-email-relay`, env file at `/etc/cold-email-relay.env`
    (root-only permissions, holds real Titan credentials — never in the Sheet)
  - Fronted by **Caddy** for automatic HTTPS (Let's Encrypt), listening on
    port `8443` instead of the standard `443` because that port is already
    used by an unrelated `danted` SOCKS proxy already running on that box —
    config at `/etc/caddy/Caddyfile`
  - The raw Node process only binds `127.0.0.1:3000` (set via `HOST` env
    var) — it is **not** directly internet-reachable, only through Caddy's
    TLS. Don't remove that `HOST` setting; without it the secret would
    travel in plaintext to anyone who hits the port directly.
- SSH access: `ssh -i ~/.ssh/hetzner root@157.180.121.10`

## Architecture, at a glance

```
Google Sheet (data + control)
      |
Apps Script (scheduler, runs every N min via time trigger)
      |  HTTPS, X-Relay-Secret header
      v
Hetzner relay service (Node/Express)
      |                              ^
      | SMTP (nodemailer)            | IMAP poll every 5 min
      v                              |
Titan mailbox(es) --------------------
      |
   (reply arrives) --> relay reports it --> doPost --> Apps Script marks
   the matching Prospect row Status = Replied, sequence stops for them
```

## Sheet tabs

- **Settings** — key/value config (relay URL/secret, timezone, test mode, etc.)
- **Senders** — one row per Titan mailbox. `Email` must *exactly* match an
  `email` key in the relay's `SENDERS_CONFIG` env var, or sends fail with
  "unknown sender."
- **Campaigns** — one row per campaign: which sender, daily limit, send
  window, Active/Paused.
- **Prospects** — one row per prospect: name/email/company/custom fields,
  `Status` (`Pending` / `Scheduled` / `Paused` / `Replied` / `Bounced` /
  `Completed`), `CurrentStage`, `NextSendDate`.
- **Templates** — one row per campaign per stage (`0` = Initial, `1`-`10` =
  Follow-up 1-10), with `{{first_name}}` / `{{last_name}}` / `{{company}}` /
  `{{email}}` / `{{custom1}}` / `{{custom2}}` merge tags and
  `DelayDaysFromPrevious`.
- **Logs** — every send attempt and every scheduler skip reason, newest last.
- **Replies** — every inbound message the relay's IMAP poller sees, whether
  or not it matched a tracked prospect (unmatched ones stay here for
  visibility — e.g. catching a typo'd prospect email — but the dashboard's
  "Recent Replies" panel only shows matched ones).

## How personalization actually works with many prospects, one sender

One sender mailbox can serve any number of prospects. Each prospect is its
own row with its own progress (`CurrentStage`/`NextSendDate`) — they don't
move in lockstep. Templates are written *once* per stage per campaign using
merge tags, so the same template produces a different, personalized email
per prospect at send time. All of them still go out from that one sender's
mailbox and respect its `DailyLimit`, so a lower daily limit naturally
spreads sends out over time instead of firing them all at once.

## Setup from scratch (if redeploying elsewhere)

### 1. Google Sheet + Apps Script

```
npm install -g @google/clasp
clasp login
cd apps-script
clasp create --type sheets --title "Cold Email Sequencer" --rootDir .
clasp push
```

Then, from the Sheet itself (not the script editor) so the confirmation
popup can render: reload the Sheet's browser tab, use **Cold Email → Setup
System** from the menu (creates all 7 tabs, seeds sample data, generates
`RELAY_SHARED_SECRET`, installs the time-based trigger). If the menu doesn't
appear, reload the tab again — it's created by a simple `onOpen` trigger
that only fires on a fresh page load.

Deploy as a Web App: `clasp deploy` (Execute as: Me, Access: Anyone). To
push code changes to an *existing* deployment without changing its URL:
`clasp deploy --deploymentId <id> --description "..."`.

Paste the resulting `/exec` URL into `Settings!APPS_SCRIPT_WEB_APP_URL`.

### 2. Titan mailbox details

Standard endpoints (confirm in the Titan control panel): SMTP
`smtp.titan.email:465` (SSL), IMAP `imap.titan.email:993` (SSL). Also check
SPF/DKIM/DMARC are set for your sending domain — matters far more for
deliverability than anything in this codebase.

### 3. Relay service (on a plain VPS, not Railway)

Railway's SMTP port block makes it unusable for the sending side without a
paid upgrade. Any regular VPS (Hetzner, DigitalOcean, etc.) works fine:

```
# On the server:
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
# copy relay-service/src, package.json, package-lock.json to /opt/cold-email-relay
cd /opt/cold-email-relay && npm ci --omit=dev
```

Create `/etc/cold-email-relay.env` (root-only, `chmod 600`):
```
PORT=3000
HOST=127.0.0.1          # keep this -- see security note above
NODE_ENV=production
RELAY_SHARED_SECRET=<same value as Settings!RELAY_SHARED_SECRET>
APPS_SCRIPT_WEB_APP_URL=<the /exec URL from step 1>
SENDERS_CONFIG=[{"email":"...","smtpHost":"smtp.titan.email","smtpPort":465,"smtpSecure":true,"smtpUser":"...","smtpPass":"...","imapHost":"imap.titan.email","imapPort":993,"imapUser":"...","imapPass":"..."}]
POLL_INTERVAL_MINUTES=5
POLL_SAFETY_MARGIN_MINUTES=2
```

Run it as a systemd service (see the live unit at
`/etc/systemd/system/cold-email-relay.service` on the Hetzner box for the
exact template) so it survives reboots and restarts on crash.

Put a reverse proxy with automatic HTTPS in front of it (Caddy is a
one-file config: `reverse_proxy localhost:3000` under your domain). A
domain is required — free HTTPS certs can't be issued for a bare IP. If
port 443 is already in use by something else on the box, point Caddy at
a different port (e.g. `yourdomain.com:8443`) instead of fighting for 443.

Copy the resulting public HTTPS URL into `Settings!RELAY_BASE_URL`.

### 4. Fill in real data

Replace the sample Sender/Campaign/Prospect/Template rows `Setup System`
created. `Senders!Email` must exactly match a `SENDERS_CONFIG` entry.

### 5. Test before going live

`Settings!TEST_MODE` defaults to `TRUE`. Set `TEST_MODE_EMAIL_OVERRIDE` to
your own inbox first. Then: **Run Scheduler Now** from the dashboard →
check the `Logs` tab and your inbox → reply to it and wait one poll cycle
→ confirm the prospect flips to `Status = Replied` in the Sheet and shows
up in the dashboard's Recent Replies panel. Only then flip `TEST_MODE` off
and set real Senders/Campaigns to `Active`.

## Manual controls, day-to-day

- Pause one prospect without deleting it: set its `Status` cell to `Paused`.
- Pause everything instantly: `Settings!SYSTEM_STATUS = Paused`.
- `Settings!MAX_EMAILS_PER_RUN` caps sends per trigger firing (defensive,
  avoids the 6-minute Apps Script execution limit).
- If a campaign is silently sending nothing, check the **Logs** tab first —
  the scheduler logs a specific skip reason (sender inactive, outside send
  window, no capacity, etc.) every time it skips a campaign, so this
  shouldn't require guesswork.

## Gotchas hit during setup (so you don't re-debug them)

- **Sheet cells auto-converting typed times**: typing `09:00` into
  `Campaigns!SendWindowStart`/`End` can get silently reinterpreted by
  Google Sheets into an internal time-serial value instead of staying
  plain text, which broke the scheduler's "is it within the send window"
  check in a way that produced no visible error. `Setup System` now forces
  those two columns to Plain Text formatting and self-heals any row
  that's already corrupted this way — safe to re-run any time this is
  suspected.
- **The "Cold Email" menu only appears on a fresh page load** — it's
  created by Apps Script's `onOpen` simple trigger, which doesn't re-fire
  on code pushes. Reload the Sheet's browser tab if the menu seems to be
  missing.
- **Both the Campaign *and* its Sender must be `Active`** for the scheduler
  to pick anything up — either one being off causes a silent skip (now
  logged explicitly in the Logs tab as of the latest deploy).
