#!/usr/bin/env node
// Stamp the app version (web/package.json → "version") into the wiki markdown.
//
// The GitHub wiki is static Markdown with no templating, so the version has to be
// written in. This is idempotent: it replaces the text BETWEEN the marker comments
//   <!--APP_VERSION-->0.0.0<!--/APP_VERSION-->
// so it can be re-run on every version bump. Drop that marker anywhere in a wiki
// page (the HTML comments are invisible on GitHub, so the reader just sees the
// number). Runs on `npm run build:inc` and standalone via `npm run stamp:wiki`.
//
// Usage: node scripts/stamp-wiki-version.mjs [--silent]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const silent = process.argv.includes('--silent') || process.argv.includes('-s');
const log = (msg) => { if (!silent) console.log(msg); };

const { version } = JSON.parse(readFileSync(join(root, 'web', 'package.json'), 'utf8'));
const wikiDir = join(root, 'wiki');
const MARKER = /(<!--APP_VERSION-->)[\s\S]*?(<!--\/APP_VERSION-->)/g;

let found = 0;
let changed = 0;
for (const name of readdirSync(wikiDir)) {
  if (!name.endsWith('.md')) continue;
  const path = join(wikiDir, name);
  const src = readFileSync(path, 'utf8');
  if (!src.includes('<!--APP_VERSION-->')) continue;
  found++;
  const out = src.replace(MARKER, `$1${version}$2`);
  if (out !== src) {
    writeFileSync(path, out);
    changed++;
    log(`  stamped ${name} → ${version}`);
  }
}

if (!found) log('No wiki files contain an <!--APP_VERSION--> marker; nothing to stamp.');
else if (changed) log(`Stamped ${changed} of ${found} marked wiki file(s) to version ${version}.`);
else log(`All ${found} marked wiki file(s) already at version ${version}.`);
