/**
 * The on-disk unused-resource scan. Built against real temp projects rather
 * than mocks, because the whole point of moving this out of the editor was that
 * it answers from files — a mocked filesystem would not test the thing that
 * broke.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findUnusedResources, walkProject } from '../project-scan.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'godot-scan-'));
  await writeFile(join(root, 'project.godot'), '[application]\nrun/main_scene="res://main.tscn"\n', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, contents, 'utf8');
}

describe('walkProject', () => {
  it('skips .godot, .git and addons by default', async () => {
    await write('main.tscn', '[gd_scene]\n');
    await write('.godot/cache.bin', 'x');
    await write('addons/plugin/thing.gd', 'extends Node\n');

    const files = (await walkProject(root, false)).map(f => f.res).sort();
    expect(files).toEqual(['res://main.tscn', 'res://project.godot']);
  });

  it('includes addons when asked', async () => {
    await write('addons/plugin/thing.gd', 'extends Node\n');
    const files = (await walkProject(root, true)).map(f => f.res);
    expect(files).toContain('res://addons/plugin/thing.gd');
  });
});

describe('findUnusedResources', () => {
  it('reports an asset nothing references', async () => {
    await write('main.tscn', '[gd_scene]\n');
    await write('art/orphan.png', 'binary');

    const result = await findUnusedResources(root);
    expect(result.unused).toContain('res://art/orphan.png');
  });

  it('does not report an asset referenced by path', async () => {
    await write('main.tscn', '[ext_resource path="res://art/used.png" id="1"]\n');
    await write('art/used.png', 'binary');

    const result = await findUnusedResources(root);
    expect(result.unused).not.toContain('res://art/used.png');
  });

  it('does not report an asset referenced only by UID', async () => {
    await write('art/used.png', 'binary');
    await write('art/used.png.import', '[remap]\n\nuid="uid://cabc123"\n');
    await write('main.tscn', '[ext_resource type="Texture2D" uid="uid://cabc123" id="1"]\n');

    const result = await findUnusedResources(root);
    expect(result.unused).not.toContain('res://art/used.png');
  });

  // Godot writes a scene's own uid into its own header. Counting that as a
  // reference made every scene in the project look used, which is the bug the
  // editor-side implementation still has.
  it('does not treat a scene self-uid as a reference to itself', async () => {
    await write('orphan.tscn', '[gd_scene load_steps=1 format=3 uid="uid://cdead01"]\n');
    await write('main.tscn', '[gd_scene format=3 uid="uid://cmain99"]\n');

    const result = await findUnusedResources(root);
    expect(result.unused).toContain('res://orphan.tscn');
  });

  it('never reports the main scene named in project.godot', async () => {
    await write('main.tscn', '[gd_scene format=3]\n');

    const result = await findUnusedResources(root);
    expect(result.unused).not.toContain('res://main.tscn');
  });

  it('leaves scripts alone unless include_scripts is set', async () => {
    await write('orphan.gd', 'extends Node\n');

    expect((await findUnusedResources(root)).unused).not.toContain('res://orphan.gd');
    expect((await findUnusedResources(root, { includeScripts: true })).unused).toContain('res://orphan.gd');
  });

  it('truncates at the limit and says so', async () => {
    for (let i = 0; i < 5; i++) await write(`art/o${i}.png`, 'binary');

    const result = await findUnusedResources(root, { limit: 2 });
    expect(result.unused).toHaveLength(2);
    expect(result.unused_count).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('reports where it ran, so a slow answer can be traced', async () => {
    const result = await findUnusedResources(root);
    expect(result.scanned_in).toBe('node');
    expect(typeof result.elapsed_ms).toBe('number');
  });
});
