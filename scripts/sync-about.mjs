#!/usr/bin/env node
/**
 * Keep the GitHub "About" description in step with the tool count.
 *
 * The description carried a tool count that was updated by hand, so it drifted:
 * it sat at 213 while the server shipped 228 — fifteen releases of drift on the
 * first thing anyone reads about the project. The fix is not to remember harder;
 * it is to DERIVE the text from the build, so "out of date" stops being a state
 * the repo can be in.
 *
 *   node scripts/sync-about.mjs           print what the description should be
 *   node scripts/sync-about.mjs --check   compare against GitHub, exit 1 on drift
 *   node scripts/sync-about.mjs --apply   write it to GitHub
 *
 * --check needs only read access, so CI runs it with the default GITHUB_TOKEN.
 * --apply edits repository metadata, which that token cannot do: run it locally,
 * or from a workflow with a PAT.
 *
 * The wording and the comparison live in about-description.mjs so a test can
 * pin them without touching the network.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDescription, isInSync } from './about-description.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function toolCount() {
  const distPath = path.join(ROOT, 'mcp-server', 'dist', 'tools', 'index.js');
  let mod;
  try {
    mod = require(distPath);
  } catch {
    console.error('Could not load the built tool registry. Run `npm run build` in mcp-server/ first.');
    process.exit(2);
  }
  const tools = mod.allTools;
  if (!Array.isArray(tools) || tools.length === 0) {
    console.error('The built registry exported no tools — refusing to write a description from it.');
    process.exit(2);
  }
  return tools.length;
}

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

const mode = process.argv[2] ?? '';
const wanted = buildDescription(toolCount());

if (mode === '--apply') {
  gh(['repo', 'edit', '--description', wanted]);
  console.log('About updated:\n  ' + wanted);
  process.exit(0);
}

if (mode === '--check') {
  let current;
  try {
    current = JSON.parse(gh(['repo', 'view', '--json', 'description'])).description ?? '';
  } catch {
    // No gh, no auth, no network: not a reason to fail someone's build. Said out
    // loud, because a silent skip reads identically to a passing check.
    console.log('SKIPPED: gh unavailable or not authenticated — the About was NOT verified.');
    process.exit(0);
  }
  if (isInSync(current, wanted)) {
    console.log('About is up to date (verified against GitHub).');
    process.exit(0);
  }
  console.error('GitHub About is out of date.\n');
  console.error('  current: ' + (current || '<empty>'));
  console.error('  should be: ' + wanted + '\n');
  console.error('Fix with:  node scripts/sync-about.mjs --apply');
  process.exit(1);
}

console.log(wanted);
