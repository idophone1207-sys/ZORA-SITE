# Workflow: Facebook Lead Ads → Google Sheet → WhatsApp

## Objective
Replace the Zapier subscription with a self-hosted pipeline: when someone submits a Meta Lead Ads form (Facebook/Instagram), automatically log them to a Google Sheet and send them a WhatsApp message from ZORA's business number — no Zapier, no per-month automation fee.

## Why this replaces Zapier (and what it costs instead)
Zapier just glued together three things that we now run ourselves: a Facebook Lead Ads trigger, a spreadsheet write, and a WhatsApp send. Running it ourselves means:
- **Free**: Render's free Web Service tier, Google Sheets API, and Meta's Graph/WhatsApp Cloud API are all free at this volume.
- **Trade-off**: no drag-and-drop UI — setup is a one-time technical pass (below), and any future changes to the message or fields mean editing `tools/facebook_leads_whatsapp.js` instead of a Zapier canvas.

## Prerequisites
- Admin access to the Meta Business Manager account that owns the ZORA Page and ad account
- Admin access to the ZORA Google account (to create a Sheet + Google Cloud service account)
- A GitHub account connected to this repo (already: `idophone1207-sys/ZORA-SITE`) and a free Render.com account
- **Important:** ZORA's WhatsApp number is currently live on Wati (running the flow-builder chatbot). This pipeline needs the number on Meta's direct Cloud API instead — a number can only be on one platform at a time. Do the number migration **last** (Step 7), after everything else is verified with Meta's free sandbox test number, so the chatbot keeps working until the new pipeline is proven.

## Required Inputs (env vars in `.env`, or Render's dashboard once deployed)
| Variable | Description | Where to get it |
|---|---|---|
| `META_VERIFY_TOKEN` | Any string you choose | Make one up, e.g. `zora_webhook_2026` |
| `META_PAGE_ACCESS_TOKEN` | Long-lived Page token with `leads_retrieval` | Meta Business Manager → System User |
| `WHATSAPP_ACCESS_TOKEN` | Cloud API access token | Meta App → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | The Cloud API phone number's ID (not the phone number itself) | Meta App → WhatsApp → API Setup |
| `WHATSAPP_TEMPLATE_NAME` | Name of the approved outbound template | Meta Business Manager → Message Templates |
| `GOOGLE_SHEET_ID` | The ID from the Sheet's URL | `docs.google.com/spreadsheets/d/<THIS PART>/edit` |
| `credentials.json` (file, not env var) | Google service-account key | Google Cloud Console → IAM → Service Accounts |

## Steps

### 1. Create the Meta App and get Lead Ads access
1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → type **Business**.
2. Add products: **Webhooks** and **WhatsApp**.
3. In Meta Business Manager, create a **System User** (Business Settings → Users → System Users), assign it as an admin of the ZORA Page and the App, and generate a token with permissions: `pages_manage_ads`, `pages_read_engagement`, `leads_retrieval`. System User tokens don't expire like personal user tokens — use this as `META_PAGE_ACCESS_TOKEN`.
4. If Meta requires App Review to unlock `leads_retrieval` for your Page in Live mode: for a Page/ad account you personally administer, you can usually test end-to-end in Development mode first (Step 6) — submit for App Review only if Meta blocks you when going live.

### 2. Create the WhatsApp message template
1. Meta Business Manager → **Message Templates** → create a new template, category **Marketing** or **Utility**, language Hebrew.
2. Body text, one variable for the name, e.g.:
   > היי {{1}}, תודה שהשארת פרטים ל-ZORA! ניצור איתך קשר בקרוב 💛
3. Submit for approval (usually minutes to a few hours). Put the approved template's exact name in `WHATSAPP_TEMPLATE_NAME`.
4. `tools/facebook_leads_whatsapp.js` sends exactly one body parameter (the lead's name) — if you change the template's variable count, update `sendWhatsAppTemplate()` to match.

### 3. Create the Google Sheet + service account
1. Create a new Google Sheet (any name) — this becomes ZORA's live lead log. Copy its ID from the URL.
2. Google Cloud Console → new (or existing) project → **APIs & Services** → enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts** → create one → **Keys** → **Add Key** → JSON. Save the downloaded file as `credentials.json` at the repo root (already in `.gitignore` — never commit it).
4. Open the Sheet → **Share** → paste the service account's `client_email` (from the JSON file) with **Editor** access.
5. The tool creates a tab named `לידים - פייסבוק` automatically on first run — no manual tab setup needed.

### 4. Install dependencies and test locally
```bash
npm install
node tools/facebook_leads_whatsapp.js
```
Verify the webhook handshake:
```bash
curl "http://localhost:3002/webhook?hub.mode=subscribe&hub.verify_token=YOUR_META_VERIFY_TOKEN&hub.challenge=test123"
# should print: test123
```
Simulate a lead event (use a real `leadgen_id` once you have test access, or check server logs for parse errors with a sample payload from [Meta's leadgen webhook docs](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/#leadgen)).

### 5. Deploy to Render (free tier)
1. [render.com](https://render.com) → **New → Web Service** → connect the `ZORA-SITE` GitHub repo.
2. Build command: `npm install`. Start command: `node tools/facebook_leads_whatsapp.js`.
3. Add all the env vars from the table above in Render's **Environment** tab (Render doesn't read local `.env` files).
4. For `credentials.json`, use Render's **Secret Files** feature (mount it at `/opt/render/project/src/credentials.json`) rather than an env var, since it's a JSON file.
5. Once deployed, note the public URL, e.g. `https://zora-leads.onrender.com`.
6. **Keep-warm ping:** Render's free tier sleeps after ~15 min idle, which would delay a real lead's message on cold start. Set up a free monitor at [cron-job.org](https://cron-job.org) to `GET https://zora-leads.onrender.com/health` every 10 minutes.

### 6. Subscribe the webhook and do a dry run (before touching the real number)
1. Meta App → **Webhooks** → subscribe the Page to the `leadgen` field, callback URL `https://zora-leads.onrender.com/webhook`, verify token = `META_VERIFY_TOKEN`.
2. In WhatsApp API Setup, Meta gives every app a **free test phone number** — use it with `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` and add your own phone as a verified recipient. Send yourself a test template message to confirm the Cloud API call works.
3. In Ads Manager, use the Lead Ads form's **Preview → Test Leads** tool to fire a test `leadgen` event with no ad spend. Confirm: a row appears in the Google Sheet, and the WhatsApp template arrives on your test-verified number.

### 7. Go live: migrate the real number (last step)
1. Only once Step 6 passes end-to-end, go to Wati and disconnect the ZORA WhatsApp number (or export/pause the chatbot flow if you want to keep it for later).
2. In Meta's WhatsApp API Setup, add the real ZORA business number to the Cloud API (this requires the number not be connected elsewhere — Wati must be disconnected first).
3. Update `WHATSAPP_PHONE_NUMBER_ID` in Render's env vars to the real number's ID, redeploy.
4. Fire one more real or test lead to confirm the live number sends correctly.

## Edge Cases & Known Behavior
- **Duplicate webhook deliveries**: Meta retries webhooks that don't return `200` fast enough. `processLead()` checks the Google Sheet for an existing `leadgen_id` before sending, so retries are safe — no duplicate WhatsApp messages.
- **Phone formatting**: Lead Ads forms sometimes store Israeli numbers without a country code (`05X-XXXXXXX`). `normalizePhone()` strips non-digits and prepends `972`, dropping a leading `0`. Recheck this if leads come from other countries.
- **Template approval**: Meta can reject templates for wording (marketing language, missing opt-out context for Marketing-category templates). Utility category with clearly transactional wording approves faster.
- **`leads_retrieval` permission**: works in Development mode for Pages/ad accounts you personally administer without App Review; if Meta blocks it once ads are live/public, submit for App Review (can take a few days) — start Step 1 early if the launch is time-sensitive.

## Notes
- This pipeline is separate from `tools/crm_server.js` (on-site contact-form leads → local `leads.xlsx`) — the two lead sources stay in separate sheets/files so channels don't mix.
- Server code: `tools/facebook_leads_whatsapp.js`. Run locally with `npm run leads:fb`.
