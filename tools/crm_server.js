/**
 * ZORA CRM Server
 * Receives lead form submissions and writes them to leads.xlsx
 * Run: node tools/crm_server.js
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');

const PORT      = 3001;
const XLSX_PATH = path.join(__dirname, '..', 'leads.xlsx');

// Lazy-load xlsx so the error is clear if not installed
function getXlsx() {
  try { return require('xlsx'); }
  catch { console.error('xlsx not installed — run: npm install'); process.exit(1); }
}

// ── Read existing workbook or create new ──────────────────
function loadWorkbook() {
  const xlsx = getXlsx();
  if (fs.existsSync(XLSX_PATH)) {
    return xlsx.readFile(XLSX_PATH);
  }
  const wb  = xlsx.utils.book_new();
  const hdr = [['שם מלא', 'טלפון', 'אימייל', 'משך נשירה', 'תאריך פנייה', 'סטטוס ליד']];
  const ws  = xlsx.utils.aoa_to_sheet(hdr);
  xlsx.utils.book_append_sheet(wb, ws, 'לידים');
  return wb;
}

// ── Append one lead row ───────────────────────────────────
function appendLead(lead) {
  const xlsx = getXlsx();
  const wb   = loadWorkbook();
  const ws   = wb.Sheets['לידים'];

  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const row = [lead.name, lead.phone, lead.email, lead.duration, now, 'חדש'];

  xlsx.utils.sheet_add_aoa(ws, [row], { origin: -1 }); // append at end
  xlsx.writeFile(wb, XLSX_PATH);
}

// ── HTTP server ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS headers (allow local file:// or any dev origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/lead') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const lead = JSON.parse(body);
        if (!lead.name || !lead.phone || !lead.email || !lead.duration) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing fields' }));
          return;
        }
        appendLead(lead);
        console.log(`[${new Date().toLocaleTimeString('he-IL')}] ליד חדש: ${lead.name} | ${lead.phone} | ${lead.duration}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Error saving lead:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'server error' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`\nZORA CRM Server פעיל על פורט ${PORT}`);
  console.log(`לידים נשמרים ב: ${XLSX_PATH}\n`);
});
