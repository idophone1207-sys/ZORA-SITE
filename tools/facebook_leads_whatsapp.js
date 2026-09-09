/**
 * ZORA Facebook Lead Ads → Google Sheet → WhatsApp
 * Receives Meta Lead Ads webhook events, logs each lead to a Google Sheet,
 * and sends a WhatsApp template message to the lead via the Cloud API.
 * Run: node tools/facebook_leads_whatsapp.js
 * Setup: see workflows/facebook_leads_to_whatsapp.md
 */

const http = require('http');
const path = require('path');

if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (_) {}
}

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const PORT = process.env.PORT || 3002;
const GRAPH_VERSION = 'v19.0';
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'credentials.json');
const SHEET_TITLE = 'לידים - פייסבוק';
const HEADERS = ['leadgen_id', 'שם מלא', 'טלפון', 'אימייל', 'תאריך פנייה', 'סטטוס הודעה'];

const {
  META_VERIFY_TOKEN,
  META_PAGE_ACCESS_TOKEN,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_TEMPLATE_NAME,
  GOOGLE_SHEET_ID,
} = process.env;

const REQUIRED_ENV = { META_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME, GOOGLE_SHEET_ID };
for (const [key, val] of Object.entries(REQUIRED_ENV)) {
  if (!val) console.warn(`[warn] ${key} is not set in .env — see workflows/facebook_leads_to_whatsapp.md`);
}

// ── Google Sheet (lazy singleton) ──────────────────────────
let sheetPromise = null;

function getSheet() {
  if (sheetPromise) return sheetPromise;
  sheetPromise = (async () => {
    const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
      : require(SERVICE_ACCOUNT_PATH);
    const auth = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, auth);
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle[SHEET_TITLE];
    if (!sheet) sheet = await doc.addSheet({ title: SHEET_TITLE, headerValues: HEADERS });
    return sheet;
  })();
  return sheetPromise;
}

// ── Phone normalization (Israeli mobile numbers) ───────────
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '972' + digits.slice(1);
  else if (digits.length === 9) digits = '972' + digits;
  return digits;
}

// ── Graph API: fetch full lead field data by leadgen_id ────
async function fetchLead(leadgenId) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?access_token=${META_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(`Graph API lead fetch failed: ${JSON.stringify(json)}`);
  const fields = {};
  for (const f of json.field_data || []) fields[f.name] = f.values && f.values[0];
  return fields;
}

// ── WhatsApp Cloud API: send the approved template message ─
async function sendWhatsAppTemplate(toPhone, name) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      language: { code: 'he' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: name || '' }] }],
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`WhatsApp send failed: ${JSON.stringify(json)}`);
  return json;
}

// ── Process one leadgen event (idempotent — checked against the Sheet) ─
async function processLead(leadgenId) {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  if (rows.some((r) => r.get('leadgen_id') === leadgenId)) {
    console.log(`[${leadgenId}] already processed, skipping`);
    return;
  }

  const fields = await fetchLead(leadgenId);
  const name = fields.full_name || fields.first_name || '';
  const phone = normalizePhone(fields.phone_number);
  const email = fields.email || '';
  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

  let status = 'נשלח';
  try {
    await sendWhatsAppTemplate(phone, name);
  } catch (err) {
    console.error(`[${leadgenId}] WhatsApp send failed:`, err.message);
    status = 'שגיאה בשליחה';
  }

  await sheet.addRow({
    leadgen_id: leadgenId,
    'שם מלא': name,
    'טלפון': phone,
    'אימייל': email,
    'תאריך פנייה': now,
    'סטטוס הודעה': status,
  });

  console.log(`[${leadgenId}] ליד חדש: ${name} | ${phone} | ${status}`);
}

// ── HTTP server ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/webhook') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      res.writeHead(200);
      res.end(challenge || '');
    } else {
      res.writeHead(403);
      res.end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      // Ack immediately — Meta retries on timeout/non-200, and processing can take a few seconds.
      res.writeHead(200);
      res.end('EVENT_RECEIVED');

      try {
        const payload = JSON.parse(body);
        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === 'leadgen') {
              const leadgenId = change.value.leadgen_id;
              processLead(leadgenId).catch((err) =>
                console.error(`[${leadgenId}] processing failed:`, err.message)
              );
            }
          }
        }
      } catch (err) {
        console.error('Error parsing webhook payload:', err.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`\nZORA Facebook Leads → WhatsApp server פעיל על פורט ${PORT}`);
  console.log('Webhook: GET/POST /webhook | Health: GET /health\n');
});
