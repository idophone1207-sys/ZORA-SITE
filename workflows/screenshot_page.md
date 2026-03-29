# Workflow: Screenshot a Web Page

## Objective
Capture a PNG screenshot of any URL using Puppeteer (headless Chrome).

## Prerequisites
- Node.js installed (`node --version`)
- Dependencies installed: `npm install` (installs `puppeteer` from package.json)

## Required Inputs
| Input | Description | Example |
|-------|-------------|---------|
| `url` | Full URL to screenshot | `https://zorasite.com` |
| `output_path` | (Optional) Where to save the PNG | `.tmp/screenshots/home.png` |
| `--full-page` | (Optional flag) Capture full scrollable page | — |
| `--width=N` | (Optional) Viewport width in px (default: 1280) | `--width=390` |
| `--height=N` | (Optional) Viewport height in px (default: 800) | `--height=844` |

## Steps

1. **Run the tool**
   ```bash
   node tools/screenshot.js <url> [output_path] [flags]
   ```

2. **Common invocations**
   ```bash
   # Desktop full-page screenshot (auto-named in .tmp/screenshots/)
   node tools/screenshot.js https://example.com --full-page

   # Mobile viewport, specific output path
   node tools/screenshot.js https://example.com .tmp/screenshots/mobile.png --width=390 --height=844

   # Custom output, viewport screenshot only
   node tools/screenshot.js https://example.com .tmp/screenshots/hero.png
   ```

3. **Output**
   - PNG file at the specified path (or `.tmp/screenshots/<hostname>_<timestamp>.png`)
   - File is ready to share, attach to a report, or review visually

## Edge Cases & Known Behavior
- Pages with heavy JavaScript may need `networkidle2` to finish loading — this is the default wait strategy (up to 30s timeout).
- If a page blocks headless browsers, add `--no-sandbox` (already included) or check for bot detection.
- For authenticated pages, you'll need to add cookie/session injection logic to the tool.
- Output directory is created automatically if it doesn't exist.

## Notes
- Screenshots are saved to `.tmp/screenshots/` by default — these are disposable intermediate files.
- Puppeteer downloads a bundled Chromium on `npm install`; no separate Chrome install needed.
