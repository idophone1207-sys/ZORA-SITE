#!/usr/bin/env node
// Kolbo.AI generation CLI — upload media, generate/edit images, generate video, poll, download.
// Docs: https://docs.kolbo.ai/developer-api
'use strict';

const fs = require('fs');
const path = require('path');

if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (_) {}
}

const API_KEY = process.env.KOLBO_API_KEY;
const BASE = 'https://api.kolbo.ai';

function requireKey() {
  if (!API_KEY) {
    console.error('Missing KOLBO_API_KEY in .env');
    process.exit(1);
  }
}

async function apiFetch(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, {
    ...opts,
    headers: { 'X-API-Key': API_KEY, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${pathname} -> HTTP ${res.status}: ${text}`);
  }
  return json;
}

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // large multipart bodies get their connection reset mid-transfer
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|heic|tiff?)$/i;

function downscaleImageForUpload(filePath) {
  const { execFileSync } = require('child_process');
  const outPath = path.join(require('os').tmpdir(), `kolbo-upload-${Date.now()}-${path.basename(filePath, path.extname(filePath))}.jpg`);
  execFileSync('sips', ['-Z', '2048', '-s', 'format', 'jpeg', filePath, '--out', outPath], { stdio: 'pipe' });
  return outPath;
}

async function uploadMedia(filePath, { description, projectId } = {}) {
  let effectivePath = filePath;
  let stat = fs.statSync(filePath);
  if (stat.size > MAX_UPLOAD_BYTES && IMAGE_EXT_RE.test(filePath)) {
    console.error(`  file is ${(stat.size / 1024 / 1024).toFixed(1)}MB, downscaling before upload to avoid connection resets...`);
    effectivePath = downscaleImageForUpload(filePath);
  }
  const buf = fs.readFileSync(effectivePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(effectivePath));
  if (description) form.append('description', description);
  if (projectId) form.append('project_id', projectId);
  const json = await apiFetch('/api/v1/media/upload', { method: 'POST', body: form });
  return json.media.url;
}

async function generateImage({ prompt, aspectRatio, model }) {
  const body = { prompt };
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (model) body.model = model;
  return apiFetch('/api/v1/generate/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function generateImageEdit({ sourceImages, prompt, aspectRatio, resolution }) {
  const body = { prompt, source_images: sourceImages };
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (resolution) body.resolution = resolution;
  return apiFetch('/api/v1/generate/image-edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function generateVideoFromImage({ imageUrl, prompt, aspectRatio, duration, resolution, soundEnabled }) {
  const body = { image_url: imageUrl };
  if (prompt) body.prompt = prompt;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (duration) body.duration = duration;
  if (resolution) body.resolution = resolution;
  if (soundEnabled !== undefined) body.sound_enabled = soundEnabled;
  return apiFetch('/api/v1/generate/video/from-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function editImage({ imageUrl, operation, prompt, aspectRatio, additionalImages }) {
  const body = { image_url: imageUrl, operation };
  if (prompt) body.prompt = prompt;
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (additionalImages) body.additional_images = additionalImages;
  return apiFetch('/api/v1/edit/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pollStatus(generationId, { intervalMs = 8000, timeoutMs = 15 * 60 * 1000 } = {}) {
  const start = Date.now();
  while (true) {
    const json = await apiFetch(`/api/v1/generate/${generationId}/status`);
    process.stderr.write(`  state=${json.state} progress=${json.progress ?? '?'}\n`);
    if (json.state === 'completed' || json.state === 'failed' || json.state === 'cancelled') {
      return json;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Polling timed out after ${timeoutMs}ms (job may still be running server-side; generation_id=${generationId})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function main() {
  requireKey();
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'upload') {
    const url = await uploadMedia(args._[0], { description: args.description, projectId: args['project-id'] });
    console.log(url);
    return;
  }

  if (cmd === 'generate-image') {
    const start = await generateImage({
      prompt: args.prompt,
      aspectRatio: args['aspect-ratio'],
      model: args.model,
    });
    console.error(`generation_id=${start.generation_id}`);
    const result = await pollStatus(start.generation_id, { intervalMs: (start.poll_interval_hint || 3) * 1000, timeoutMs: 2 * 60 * 1000 });
    if (result.state !== 'completed') {
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    const imgUrl = result.result.urls[0];
    console.log(imgUrl);
    if (args.out) await downloadFile(imgUrl, args.out);
    return;
  }

  if (cmd === 'image-edit') {
    const start = await generateImageEdit({
      sourceImages: args._,
      prompt: args.prompt,
      aspectRatio: args['aspect-ratio'],
      resolution: args.resolution,
    });
    console.error(`generation_id=${start.generation_id}`);
    const result = await pollStatus(start.generation_id, { intervalMs: (start.poll_interval_hint || 3) * 1000, timeoutMs: 2 * 60 * 1000 });
    if (result.state !== 'completed') {
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    const imgUrl = result.result.urls[0];
    console.log(imgUrl);
    if (args.out) await downloadFile(imgUrl, args.out);
    return;
  }

  if (cmd === 'video-from-image') {
    const start = await generateVideoFromImage({
      imageUrl: args._[0],
      prompt: args.prompt,
      aspectRatio: args['aspect-ratio'],
      duration: args.duration,
      resolution: args.resolution,
      soundEnabled: args.sound === 'true' ? true : args.sound === 'false' ? false : undefined,
    });
    console.error(`generation_id=${start.generation_id}`);
    const result = await pollStatus(start.generation_id, { intervalMs: (start.poll_interval_hint || 8) * 1000, timeoutMs: 15 * 60 * 1000 });
    if (result.state !== 'completed') {
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    const vidUrl = result.result.urls[0];
    console.log(vidUrl);
    if (args.out) await downloadFile(vidUrl, args.out);
    return;
  }

  if (cmd === 'edit-image') {
    const start = await editImage({
      imageUrl: args._[0],
      operation: args.operation,
      prompt: args.prompt,
      aspectRatio: args['aspect-ratio'],
    });
    console.error(`generation_id=${start.generation_id}`);
    const result = await pollStatus(start.generation_id, { intervalMs: (start.poll_interval_hint || 8) * 1000, timeoutMs: 5 * 60 * 1000 });
    if (result.state !== 'completed') {
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    const imgUrl = result.result.urls[0];
    console.log(imgUrl);
    if (args.out) await downloadFile(imgUrl, args.out);
    return;
  }

  console.error(`Usage:
  node tools/kolbo.js upload <file> [--description "..."]
  node tools/kolbo.js generate-image --prompt "..." [--aspect-ratio 9:16] [--out path.png]
  node tools/kolbo.js image-edit <sourceUrl1> [sourceUrl2 ...] --prompt "..." [--aspect-ratio 1:1] [--out path.png]
  node tools/kolbo.js edit-image <imageUrl> --operation removebg [--out path.png]
  node tools/kolbo.js video-from-image <imageUrl> --prompt "..." [--duration 5] [--aspect-ratio 16:9] [--out path.mp4]`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
