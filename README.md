# Cold Email Sequencer

Self-hosted cold outreach: Google Sheets is the control panel and system of
record, Google Apps Script is the scheduler, and a small Node relay service
(deployed on Railway) does the actual SMTP sending and IMAP reply-polling
against your Titan mailboxes (Apps Script can't speak SMTP/IMAP directly).

See `../` conversation / the plan file for the full architecture writeup.
This file is the practical step-by-step to get it running.

## 1. Google Sheet + Apps Script

1. Create a new blank Google Sheet.
2. Extensions -> Apps Script. Delete the default `Code.gs` boilerplate.
3. Either paste every file from `apps-script/` in manually (File > New > Script
   file / Html file, matching names exactly, `dashboard.html` as an HTML file,
   the rest as Script files), **or** use `clasp` to push them all at once:

   ```
   npm install -g @google/clasp
   clasp login                     # opens a browser once, one-time auth
   cd apps-script
   clasp create --type sheet --title "Cold Email Sequencer" --rootDir .
   clasp push
   ```

   `clasp create` links the Apps Script project to a **new** spreadsheet it
   creates for you (prints the Sheet URL). If you already made a Sheet in
   step 1, use `clasp clone <scriptId>` instead (Extensions > Apps Script >
   Project Settings has the Script ID) so it pushes into that one.

4. In the script editor: Run > run `setupSystem` once. Authorize the
   permissions it asks for (Sheets access, plus URL Fetch and external
   requests since it'll call the relay later). This creates all 6 tabs with
   headers and sample rows, generates `RELAY_SHARED_SECRET`, and installs
   the recurring trigger.
5. Deploy > New deployment > type **Web app**. Execute as: **Me**. Who has
   access: **Anyone**. Deploy, copy the `/exec` URL.
6. In the Sheet's `Settings` tab, paste that URL into the
   `APPS_SCRIPT_WEB_APP_URL` row.

## 2. Titan mailbox details

For each sender mailbox you'll use, get from the Titan control panel:
- SMTP host/port (standard: `smtp.titan.email`, port `465` w/ SSL or `587` w/ STARTTLS)
- IMAP host/port (standard: `imap.titan.email`, port `993` w/ SSL)
- The mailbox's username (its full email address) and password

Also worth checking now (this matters far more for deliverability than any
code in this repo): SPF, DKIM, and DMARC records for your sending domain(s)
in your DNS provider. Titan's docs/support can give you the exact records
to add if you haven't set these up already.

## 3. Relay service on Railway

```
npm install -g @railway/cli
railway login                     # opens a browser once, one-time auth
cd relay-service
railway init                      # or: railway link, if you already made a project in the dashboard
railway up
```

Set environment variables (Railway dashboard, or via CLI):

```
railway variables set RELAY_SHARED_SECRET="<paste the value from Settings!RELAY_SHARED_SECRET>"
railway variables set APPS_SCRIPT_WEB_APP_URL="<the /exec URL from step 1.5>"
railway variables set SENDERS_CONFIG='[{"email":"sales1@yourdomain.com","smtpHost":"smtp.titan.email","smtpPort":465,"smtpSecure":true,"smtpUser":"sales1@yourdomain.com","smtpPass":"REAL_PASSWORD","imapHost":"imap.titan.email","imapPort":993,"imapUser":"sales1@yourdomain.com","imapPass":"REAL_PASSWORD"}]'
railway variables set POLL_INTERVAL_MINUTES=5
railway variables set POLL_SAFETY_MARGIN_MINUTES=2
```

`SENDERS_CONFIG` is a JSON array — one object per mailbox. Add more objects
for more senders. See `.env.example` for the full shape.

Railway auto-detects Node from `package.json` (no Dockerfile needed) and
exposes a public URL — copy it into the Sheet's `Settings!RELAY_BASE_URL`.
Health check path is `/health`.

## 4. Fill in real data

In the Sheet:
- **Senders**: one row per mailbox. `Email` must exactly match a `email`
  key in `SENDERS_CONFIG`. Set `Status = Active` when ready.
- **Campaigns**: one row per campaign, `SenderID` referencing a Senders row.
  Set `Status = Active` and a sending window when ready.
- **Templates**: rows for `Stage 0` (Initial) through however many
  follow-ups you want (up to `Stage 10`), each with `DelayDaysFromPrevious`
  and `{{first_name}}`/`{{last_name}}`/`{{company}}`/`{{email}}`/`{{custom1}}`/
  `{{custom2}}` merge tags in Subject/Body.
- **Prospects**: one row per prospect, `Status = Pending`, `CurrentStage = 0`.

Delete or repurpose the sample rows `setupSystem()` created.

## 5. Test before going live

`Settings!TEST_MODE` defaults to `TRUE`. Set
`Settings!TEST_MODE_EMAIL_OVERRIDE` to your own inbox, then:

1. Open the dashboard (Cold Email menu > Open Dashboard, or visit the Web
   App URL) and click **Run Scheduler Now** — or run `runScheduler` from the
   script editor.
2. Check the `Logs` tab for a `Success` row, and check your test inbox for
   the (fully personalized) email.
3. Back-date that prospect's `NextSendDate` to the past, run again, confirm
   the follow-up arrives threaded under the first (same subject w/ "Re:",
   `In-Reply-To` header set) and personalization is correct again.
4. Reply to the test email from your inbox. Wait one poll cycle
   (`POLL_INTERVAL_MINUTES`), then run the scheduler again — the prospect
   should now show `Status = Replied` and be skipped.
5. Only once all of that looks right: set `TEST_MODE = FALSE`, flip real
   Senders/Campaigns to `Active`, and let the trigger run unattended.

## Manual controls, day-to-day

- Pause one prospect without deleting it: set its `Status` cell to `Paused`.
- Pause everything instantly: `Settings!SYSTEM_STATUS = Paused`.
- `Settings!MAX_EMAILS_PER_RUN` caps how many sends happen per trigger firing
  (defensive, avoids the 6-minute Apps Script execution limit).
