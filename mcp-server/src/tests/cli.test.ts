/**
 * Tests for the setup CLI (install / doctor).
 *
 * The install path edits a file the user's whole project depends on
 * (project.godot). A rival server's settings writer corrupting input mappings is
 * the most-cited complaint in this space, so the merge behaviour — keep every
 * other section, keep other plugins, always back up — is asserted here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInstall, runDoctor } from '../cli.js';

let dir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'godot-mcp-cli-'));
  // Silence the CLI's human-facing output during tests.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  cwdSpy?.mockRestore();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(contents: string): Promise<void> {
  await writeFile(join(dir, 'project.godot'), contents, 'utf8');
}

describe('install', () => {
  it('installs the addon and enables the plugin in a bare project', async () => {
    await writeProject('[application]\n\nconfig/name="Bare"\n');

    const code = await runInstall(['--project', dir]);

    expect(code).toBe(0);
    expect(existsSync(join(dir, 'addons/godot_mcp/plugin.cfg'))).toBe(true);
    const project = await readFile(join(dir, 'project.godot'), 'utf8');
    expect(project).toContain('[editor_plugins]');
    expect(project).toContain('res://addons/godot_mcp/plugin.cfg');
    expect(project).toContain('config/name="Bare"');
  });

  it('merges into an existing editor_plugins list without dropping other plugins or sections', async () => {
    await writeProject(
      '[application]\n\nconfig/name="Has Plugins"\n\n' +
      '[editor_plugins]\n\nenabled=PackedStringArray("res://addons/gut/plugin.cfg")\n\n' +
      '[input]\n\nui_jump={"deadzone":0.5}\n'
    );

    await runInstall(['--project', dir]);

    const project = await readFile(join(dir, 'project.godot'), 'utf8');
    expect(project).toContain('res://addons/gut/plugin.cfg');
    expect(project).toContain('res://addons/godot_mcp/plugin.cfg');
    // The input map is the thing a careless settings writer destroys.
    expect(project).toContain('ui_jump={"deadzone":0.5}');
    expect(project).toContain('config/name="Has Plugins"');
  });

  it('backs up project.godot before editing it', async () => {
    await writeProject('[application]\n\nconfig/name="Backup"\n');

    await runInstall(['--project', dir]);

    const backup = await readFile(join(dir, 'project.godot.bak'), 'utf8');
    expect(backup).toContain('config/name="Backup"');
    expect(backup).not.toContain('editor_plugins');
  });

  it('is idempotent: a second run does not duplicate the plugin entry', async () => {
    await writeProject('[application]\n\nconfig/name="Twice"\n');

    await runInstall(['--project', dir]);
    await runInstall(['--project', dir]);

    const project = await readFile(join(dir, 'project.godot'), 'utf8');
    const occurrences = project.split('res://addons/godot_mcp/plugin.cfg').length - 1;
    expect(occurrences).toBe(1);
  });

  it('fails clearly when the target is not a Godot project', async () => {
    const code = await runInstall(['--project', dir]);
    expect(code).toBe(1);
    expect(existsSync(join(dir, 'addons'))).toBe(false);
  });
});

describe('doctor', () => {
  it('reports a problem when the addon is missing', async () => {
    await writeProject('[application]\n\nconfig/name="NoAddon"\n');
    const code = await runDoctor(['--project', dir]);
    expect(code).toBe(1);
  });

  it('reports a problem when the addon is present but the plugin is not enabled', async () => {
    await writeProject('[application]\n\nconfig/name="NotEnabled"\n');
    await mkdir(join(dir, 'addons/godot_mcp'), { recursive: true });
    await writeFile(join(dir, 'addons/godot_mcp/plugin.cfg'), '[plugin]\nname="Godot MCP"\n', 'utf8');

    const code = await runDoctor(['--project', dir]);

    expect(code).toBe(1);
  });
});
