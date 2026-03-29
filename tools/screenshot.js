#!/usr/bin/env node
/**
 * screenshot.js — Take a full-page or viewport screenshot of any URL using Puppeteer.
 *
 * Usage:
 *   node tools/screenshot.js <url> [output_path] [--full-page] [--width=1280] [--height=800]
 *
 * Examples:
 *   node tools/screenshot.js https://example.com
 *   node tools/screenshot.js https://example.com .tmp/screenshots/home.png --full-page
 *   node tools/screenshot.js https://example.com .tmp/screenshots/mobile.png --width=390 --height=844
 *
 * Output: Saves PNG to .tmp/screenshots/<hostname>_<timestamp>.png (or specified path)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function screenshot({ url, outputPath, fullPage, width, height }) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await page.screenshot({ path: outputPath, fullPage });
    console.log(`Screenshot saved: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

// --- CLI argument parsing ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/screenshot.js <url> [output_path] [--full-page] [--width=N] [--height=N]');
  process.exit(1);
}

const url = args[0];
const flags = args.filter(a => a.startsWith('--'));
const positional = args.filter(a => !a.startsWith('--'));

const fullPage = flags.includes('--full-page');
const width = parseInt((flags.find(f => f.startsWith('--width=')) || '--width=1280').split('=')[1]);
const height = parseInt((flags.find(f => f.startsWith('--height=')) || '--height=800').split('=')[1]);

// Default output path: .tmp/screenshots/<hostname>_<timestamp>.png
const hostname = new URL(url).hostname.replace(/\./g, '_');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const defaultOut = path.join('.tmp', 'screenshots', `${hostname}_${timestamp}.png`);
const outputPath = positional[1] || defaultOut;

screenshot({ url, outputPath, fullPage, width, height }).catch(err => {
  console.error('Screenshot failed:', err.message);
  process.exit(1);
});
