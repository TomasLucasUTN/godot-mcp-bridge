/**
 * `dry_run` is honoured in one place — SceneToolBase's two save helpers — so
 * every tool that writes a scene through them previews correctly, including
 * ones written later. That is the good part and also the trap: the guarantee
 * is invisible from the tool's own file, so a new scene tool silently gets the
 * behaviour and never advertises it, and a tool moved off the shared save path
 * keeps advertising a promise it no longer keeps.
 *
 * This derives the covered set from the code rather than a list: which handlers
 * a SceneToolBase subclass owns, and which of those write through
 * `_save_scene` / `_finish_scene_edit`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTools } from '../tools/index.js';

const ADDON = resolve(dirname(fileURLToPath(import.meta.url)), '../../../addons/godot_mcp');
const TOOLS_DIR = join(ADDON, 'tools');

/**
 * Tools that really do preview, by either mechanism:
 *  - a scene tool writing through SceneToolBase's guarded save helpers, or
 *  - a handler that reads `_dry_run` itself, which is how the file-writing
 *    tools do it (they are not scene tools and have no shared save point).
 */
function toolsCoveredByCentralDryRun(): Set<string> {
  const executor = readFileSync(join(ADDON, 'tool_executor.gd'), 'utf8');

  const sceneToolFiles = new Set(
    readdirSync(TOOLS_DIR).filter(f =>
      f.endsWith('.gd') && readFileSync(join(TOOLS_DIR, f), 'utf8').includes('extends SceneToolBase'))
  );

  const varToFile = new Map<string, string>();
  for (const [, handlerVar, file] of executor.matchAll(
    /(_[a-z_0-9]+) = preload\("res:\/\/addons\/godot_mcp\/tools\/([a-z_0-9]+\.gd)"\)/g)) {
    varToFile.set(handlerVar, file);
  }

  const covered = new Set<string>();
  for (const [, tool, handlerVar, method] of executor.matchAll(
    /&"([a-z_0-9]+)": \[(_[a-z_0-9]+), &"([a-z_0-9]+)"\]/g)) {
    const file = varToFile.get(handlerVar);
    if (!file) continue;
    const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
    const body = new RegExp(`func ${method}\\(args: Dictionary\\)[\\s\\S]*?(?=\\nfunc |$)`).exec(src)?.[0] ?? '';
    const guardedSave = sceneToolFiles.has(file)
      && (body.includes('_save_scene(') || body.includes('_finish_scene_edit('));
    // The file-writing tools are not scene tools and have no shared save
    // point, so they read the flag themselves. Both count as covered.
    const honoursItself = body.includes('_dry_run');
    if (guardedSave || honoursItself) covered.add(tool);
  }
  return covered;
}

describe('dry_run coverage', () => {
  const covered = toolsCoveredByCentralDryRun();
  const advertised = new Set(allTools.filter(t => t.inputSchema.properties?.dry_run).map(t => t.name));

  it('found the scene tools to check', () => {
    expect(covered.size).toBeGreaterThan(50);
  });

  it('advertises the preview on every tool that actually gets it', () => {
    const silent = [...covered].filter(name => !advertised.has(name) && allTools.some(t => t.name === name));
    expect(silent).toEqual([]);
  });

  // The other direction, which is the one that would lie to a caller: a tool
  // offering dry_run that no longer writes through the guarded path.
  it('does not promise a preview it cannot give', () => {
    // These implement dry_run themselves rather than through SceneToolBase:
    // they write files or settings, not scenes.
    const OWN_IMPLEMENTATION = new Set([
      'rename_symbol_project_wide',  // rewrites .gd/.tscn text
      'sync_localization',           // project settings
      'get_project_settings',        // read-only; dry_run is inert there
      'create_scene',                // writes a new file, not an edit of one
      'batch_scene_edit',            // forwards it to each operation
      // Delegates to batch_scene_edit, which is where the guarded save is;
      // its own body never touches the helpers.
      'modify_node_property',
    ]);
    const unbacked = [...advertised].filter(name => !covered.has(name) && !OWN_IMPLEMENTATION.has(name));
    expect(unbacked).toEqual([]);
  });
});
