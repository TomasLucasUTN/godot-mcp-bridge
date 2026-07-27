#!/usr/bin/env node
/**
 * Copy the editor addon into the npm package so `godot-mcp-bridge install` can
 * drop it into a project without the user visiting the AssetLib.
 *
 * The addon lives at repo-root/addons/godot_mcp, which is outside the package
 * root, and npm's "files" cannot reach outside it — so it is staged here at
 * build time instead.
 */

import { cp, rm, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../addons/godot_mcp');
const target = resolve(here, '../bundled-addon/godot_mcp');

try {
  await access(source);
} catch {
  // Building from a published tarball (no repo checkout): the addon is either
  // already staged or genuinely unavailable. Not an error.
  console.error(`bundle-addon: no addon source at ${source}, skipping`);
  process.exit(0);
}

await rm(resolve(here, '../bundled-addon'), { recursive: true, force: true });
await cp(source, target, {
  recursive: true,
  // take_screenshot writes into addons/godot_mcp/cache at runtime. When the
  // addon is junctioned into a test project those images land in the repo, and
  // without this filter they would ship inside the published package.
  filter: (src) => !src.replace(/\\/g, '/').includes('/godot_mcp/cache'),
});
console.error(`bundle-addon: staged addon -> ${target}`);
