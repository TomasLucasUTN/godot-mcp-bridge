/**
 * Read-only project analysis that runs here in Node, against files on disk,
 * instead of inside the editor.
 *
 * Why it moved: `@tool` scripts run on the editor's main thread, so a
 * project-wide sweep freezes the UI — and because the bridge pings every 10s and
 * gives up after two misses, a sweep slower than 20s kills its own connection.
 * That was not hypothetical: measured against a 24,649-file project,
 * `find_unused_resources` in the editor took 26,293 ms and returned
 * "Godot disconnected". The same question answered here took 1,601 ms.
 *
 * Nothing in this file needs Godot's object model — it reads `.tscn`/`.tres`/
 * `.gd` as text, which is what the editor-side implementation did anyway. It
 * therefore also works with the editor closed, given GODOT_MCP_PROJECT.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ASSET_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'svg', 'webp', 'bmp', 'ogg', 'wav', 'mp3',
  'tres', 'res', 'tscn', 'scn', 'ttf', 'otf', 'fnt', 'glb', 'gltf', 'obj', 'gdshader',
]);
const TEXT_EXTS = new Set(['gd', 'tscn', 'tres', 'cfg', 'godot', 'gdshader', 'cs']);
const SKIP_DIRS = new Set(['.godot', '.git', 'addons']);

const MAX_DEPTH = 12;
/** Enough to keep the disk busy without exhausting file descriptors. */
const READ_CONCURRENCY = 32;

const RES_REF = /res:\/\/[^"'\)\]\s]+/g;
const UID_REF = /uid:\/\/[a-z0-9]+/g;

export interface UnusedScanOptions {
  includeAddons?: boolean;
  includeScripts?: boolean;
  limit?: number;
}

export interface UnusedScanResult {
  ok: true;
  unused: string[];
  unused_count: number;
  truncated: boolean;
  files_scanned: number;
  include_addons: boolean;
  include_scripts: boolean;
  scanned_in: 'node';
  elapsed_ms: number;
  note: string;
}

/** One file in the project, in both the forms we need. */
interface ProjectFile {
  res: string;
  abs: string;
  ext: string;
}

/**
 * Walk the project directory, mirroring the editor-side walk: dot-entries,
 * Godot's own `.godot` cache and `addons/` are skipped unless asked for.
 */
export async function walkProject(root: string, includeAddons: boolean): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];

  async function visit(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: Array<[string, string]> = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) && !(entry.name === 'addons' && includeAddons)) continue;
        subdirs.push([abs, childRel]);
      } else if (entry.isFile()) {
        out.push({ res: `res://${childRel}`, abs, ext: extensionOf(entry.name) });
      }
    }
    await Promise.all(subdirs.map(([abs, childRel]) => visit(abs, childRel, depth + 1)));
  }

  await visit(root, '', 0);
  return out;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

async function readTextOrEmpty(abs: string): Promise<string> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return '';
  }
}

/** Run `worker` over `items`, at most `limit` at a time. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * A file's own UID, which lives in a different place per file type:
 * imported assets keep it in a `.import` sidecar, scripts in a `.uid` sidecar
 * (Godot 4.4+), and scenes/resources in their own header line.
 */
async function ownUid(
  file: ProjectFile,
  byRes: Map<string, ProjectFile>,
  knownText?: string
): Promise<string | null> {
  const sidecar = byRes.get(`${file.res}.import`) ?? byRes.get(`${file.res}.uid`);
  if (sidecar) {
    const text = await readTextOrEmpty(sidecar.abs);
    const match = text.match(UID_REF);
    if (match) return match[0];
  }
  if (file.ext === 'tscn' || file.ext === 'tres' || file.ext === 'scn' || file.ext === 'res') {
    // Only the [gd_scene]/[gd_resource] header line, and only if it really is
    // that header: any uid further down the file belongs to something this
    // file *references*, and mistaking one for the file's own identity would
    // silently mark a used resource as unused.
    const firstLine = (knownText ?? await readTextOrEmpty(file.abs)).split('\n', 1)[0] ?? '';
    if (firstLine.startsWith('[gd_')) {
      const match = firstLine.match(UID_REF);
      if (match) return match[0];
    }
  }
  return null;
}

/**
 * Find assets nothing in the project points at, by res:// path or by UID.
 */
export async function findUnusedResources(root: string, options: UnusedScanOptions = {}): Promise<UnusedScanResult> {
  const startedAt = Date.now();
  const includeAddons = options.includeAddons === true;
  const includeScripts = options.includeScripts === true;
  const limit = options.limit ?? 200;

  const files = await walkProject(root, includeAddons);
  const byRes = new Map(files.map(f => [f.res, f]));

  const referencedPaths = new Set<string>();
  const referencedUids = new Set<string>();

  const textFiles = files.filter(f => TEXT_EXTS.has(f.ext));
  await mapLimit(textFiles, READ_CONCURRENCY, async (file) => {
    const text = await readTextOrEmpty(file.abs);
    for (const ref of text.match(RES_REF) ?? []) {
      // A file pointing at itself is not usage. Left in, every scene would look
      // referenced: Godot writes a scene's own uid into its own header.
      if (ref !== file.res) referencedPaths.add(ref);
    }
    const selfUid = await ownUid(file, byRes, text);
    for (const uid of text.match(UID_REF) ?? []) {
      if (uid !== selfUid) referencedUids.add(uid);
    }
  });

  // project.godot sits outside the text walk in some layouts, and its
  // main_scene / autoloads / input events must never read as unused.
  const projectFile = await readTextOrEmpty(path.join(root, 'project.godot'));
  for (const ref of projectFile.match(RES_REF) ?? []) referencedPaths.add(ref);
  for (const uid of projectFile.match(UID_REF) ?? []) referencedUids.add(uid);

  const candidates = files.filter((file) => {
    if (referencedPaths.has(file.res)) return false;
    if (includeScripts && file.ext === 'gd') return true;
    return ASSET_EXTS.has(file.ext);
  });

  const stillUnused: string[] = [];
  await mapLimit(candidates, READ_CONCURRENCY, async (file) => {
    const uid = await ownUid(file, byRes);
    if (uid && referencedUids.has(uid)) return;
    stillUnused.push(file.res);
  });

  stillUnused.sort();
  const truncated = stillUnused.length > limit;

  return {
    ok: true,
    unused: truncated ? stillUnused.slice(0, limit) : stillUnused,
    unused_count: truncated ? limit : stillUnused.length,
    truncated,
    files_scanned: files.length,
    include_addons: includeAddons,
    include_scripts: includeScripts,
    scanned_in: 'node',
    elapsed_ms: Date.now() - startedAt,
    note: 'A file is reported unused when no .gd/.tscn/.tres/project.godot references its res:// path or its UID. Resources loaded from a runtime-built string path cannot be detected - review before deleting.',
  };
}

export interface ProjectStatistics {
  ok: true;
  include_addons: boolean;
  files_total: number;
  files_by_extension: Record<string, number>;
  scripts: number;
  scenes: number;
  resources: number;
  script_lines: number;
  script_functions: number;
  scripts_with_class_name: number;
  signal_declarations: number;
  todo_markers: number;
  nodes_in_scenes: number;
  scenes_scanned: number;
  project_bytes: number;
  scanned_in: 'node';
  elapsed_ms: number;
}

const FUNC_DECL = /^[ \t]*(?:static[ \t]+)?func[ \t]/gm;
const SIGNAL_DECL = /^[ \t]*signal[ \t]/gm;
const TODO_MARKER = /TODO|FIXME|HACK|XXX/gi;
/** Every node in a text scene is one `[node ...]` block, which is what
 *  PackedScene.get_state().get_node_count() counts. */
const SCENE_NODE = /^\[node /gm;

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let n = 0;
  while (pattern.exec(text) !== null) n++;
  return n;
}

/**
 * Project-wide counts, read from disk here instead of in the editor.
 *
 * Moved for the same reason as findUnusedResources, and it was worse: measured
 * against the same 24,649-file project the editor-side version took 120,685 ms
 * — six times the bridge's 20s watchdog — and a live call did drop the editor
 * off the bridge. Two things made it that slow, and neither needs the engine:
 * it opened every file with FileAccess just to read its length (a `stat` here),
 * and it called ResourceLoader.load() on every .tscn, which pulls each scene's
 * textures and scripts into the resource cache to count its nodes.
 */
export async function projectStatistics(root: string, includeAddons = false): Promise<ProjectStatistics> {
  const startedAt = Date.now();
  const files = await walkProject(root, includeAddons);

  const byExt: Record<string, number> = {};
  let scripts = 0;
  let scenes = 0;
  let resources = 0;
  let scriptLines = 0;
  let scriptFunctions = 0;
  let scriptsWithClassName = 0;
  let signalDeclarations = 0;
  let todoMarkers = 0;
  let nodesInScenes = 0;
  let scenesScanned = 0;
  let projectBytes = 0;

  await mapLimit(files, READ_CONCURRENCY, async (file) => {
    byExt[file.ext] = (byExt[file.ext] ?? 0) + 1;
    try {
      projectBytes += (await stat(file.abs)).size;
    } catch {
      // A file that vanished mid-scan contributes nothing rather than failing
      // the whole call.
    }

    if (file.ext === 'gd') {
      scripts++;
      const src = await readTextOrEmpty(file.abs);
      scriptLines += src.split('\n').length;
      scriptFunctions += countMatches(src, FUNC_DECL);
      signalDeclarations += countMatches(src, SIGNAL_DECL);
      todoMarkers += countMatches(src, TODO_MARKER);
      if (src.includes('class_name ')) scriptsWithClassName++;
    } else if (file.ext === 'tscn' || file.ext === 'scn') {
      scenes++;
      // Only text scenes can be counted without the engine; a binary .scn is
      // skipped, exactly as the editor-side version skipped it.
      if (file.ext === 'tscn') {
        const text = await readTextOrEmpty(file.abs);
        nodesInScenes += countMatches(text, SCENE_NODE);
        scenesScanned++;
      }
    } else if (file.ext === 'tres' || file.ext === 'res') {
      resources++;
    }
  });

  return {
    ok: true,
    include_addons: includeAddons,
    files_total: files.length,
    files_by_extension: byExt,
    scripts,
    scenes,
    resources,
    script_lines: scriptLines,
    script_functions: scriptFunctions,
    scripts_with_class_name: scriptsWithClassName,
    signal_declarations: signalDeclarations,
    todo_markers: todoMarkers,
    nodes_in_scenes: nodesInScenes,
    scenes_scanned: scenesScanned,
    project_bytes: projectBytes,
    scanned_in: 'node',
    elapsed_ms: Date.now() - startedAt,
  };
}

/** Does this look like a Godot project root? */
export async function isProjectRoot(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, 'project.godot'))).isFile();
  } catch {
    return false;
  }
}
