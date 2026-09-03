/**
 * Project analysis tools for Godot MCP Server
 * Read-only quality/health analysis over the whole project, plus visual-regression
 * screenshot diffing. Nothing here mutates the project (compare_screenshots only
 * writes the optional diff image you ask for).
 */

import type { ToolDefinition } from '../types.js';

export const analysisTools: ToolDefinition[] = [
  {
    name: 'get_project_statistics',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Project-wide counts in one call: files by extension, script/scene/resource totals, lines of GDScript, function and signal declarations, TODO/FIXME markers, and total nodes across all .tscn scenes. Use it to size up an unfamiliar project before diving in, or to track growth over time. Answered by the MCP server from disk, not inside the editor, so a large project cannot freeze the editor UI — and it works with Godot closed when GODOT_MCP_PROJECT is set.',
    inputSchema: {
      type: 'object',
      properties: {
        include_addons: { type: 'boolean', description: 'Include the addons/ folder. Default false (your code only).' }
      }
    }
  },
  {
    name: 'find_unused_resources',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Find assets (textures, audio, .tres/.tscn, fonts, meshes, shaders) that no .gd, .tscn, .tres or project.godot references — by res:// path OR by UID. Catches the dead weight that accumulates in a project. Caveat: a resource loaded from a path built at runtime cannot be detected, so review the list before deleting anything.',
    inputSchema: {
      type: 'object',
      properties: {
        include_addons: { type: 'boolean', description: 'Include the addons/ folder. Default false.' },
        include_scripts: { type: 'boolean', description: 'Also report unreferenced .gd files. Default false (a script can be attached in ways this scan does not model).' },
        limit: { type: 'number', description: 'Max entries to return. Default 200.' }
      }
    }
  },
  {
    name: 'detect_circular_dependencies',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Build the dependency graph between .gd, .tscn and .tres files (from res:// and uid:// references) and report every cycle as an ordered path. A preload() cycle is a hard parse error in GDScript; a load() cycle is legal but usually a design smell. Use before a refactor to know what is entangled.',
    inputSchema: {
      type: 'object',
      properties: {
        include_addons: { type: 'boolean', description: 'Include the addons/ folder. Default false.' }
      }
    }
  },
  {
    name: 'analyze_scene_complexity',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Per-scene complexity metrics (node count, max depth, scripted nodes, instanced children, connection count, distinct types) plus actionable warnings for scenes that are too big, too deeply nested, or over-connected. With no scene_path it ranks every scene in the project heaviest-first — the fastest way to find what to split up.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Analyze one scene. Omit to analyze and rank every scene in the project.' },
        include_addons: { type: 'boolean', description: 'Include the addons/ folder. Default false.' },
        limit: { type: 'number', description: 'Max scenes to return when scanning the whole project. Default 40.' }
      }
    }
  },
  {
    name: 'validate_references',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Check that the names your scripts USE actually exist in the project: group names, input actions, and signals emitted but never declared. validate_scripts only answers 'does this parse' — these failures are silent at runtime instead. get_first_node_in_group(\"player\") against a project where nothing is in that group returns null and the enemy simply never moves, with no error anywhere. Reports file, line, the offending name and the closest existing one. Only literal names are checked; a name built at runtime is skipped rather than guessed at.",
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Directory to scan (default res://).' },
        include_addons: { type: 'boolean', description: 'Also scan res://addons (default false — third-party addons reference their own groups and actions).' }
      }
    }
  },
  {
    name: 'analyze_signal_flow',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Map every persisted signal connection in a scene (or the whole project) and flag ORPHANS: connections whose receiver has no script, or whose script never declares the handler method. Those fail silently until the signal actually fires at runtime, so this catches a class of bug the editor does not. Handlers inherited from a base class or written in C# are not detected and may show as false positives.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Analyze one scene. Omit to scan every scene in the project.' },
        include_addons: { type: 'boolean', description: 'Include the addons/ folder. Default false.' },
        only_problems: { type: 'boolean', description: 'Return only the orphan list, omitting the full connection map. Default false. Use it to keep the response small on a big project.' }
      }
    }
  },
  {
    name: 'compare_screenshots',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Pixel-diff two PNGs for visual regression testing: returns diff_percentage, changed_pixels, and the bounding box of what changed. Pair it with take_screenshot to capture a baseline, change something, capture again, and prove whether the frame actually changed. Optionally writes a diff image (changed pixels in red over a dimmed backdrop). Both images must be the same size. Only writes the diff image you explicitly request.',
    inputSchema: {
      type: 'object',
      properties: {
        baseline: { type: 'string', description: 'Path to the baseline PNG (res:// path)' },
        current: { type: 'string', description: 'Path to the PNG to compare against the baseline' },
        tolerance: { type: 'number', description: 'Per-channel 0-255 difference tolerated before a pixel counts as changed. Default 8 — absorbs codec/AA noise.' },
        diff_output: { type: 'string', description: 'Optional res:// path to write the visual diff image to.' },
        return_base64: { type: 'boolean', description: 'Also return the diff image as base64 (requires diff_output). Default false — the file path is usually enough and base64 is token-expensive.' }
      },
      required: ['baseline', 'current']
    }
  },
  {
    name: 'texture_info',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Size and content alpha bbox of a texture, computed in-engine — no PIL round trip needed for sprite alignment work (standing height, feet position, crop centring). With `hframes`, splits the image into that many equal-width columns and returns bbox per frame. Also flags `has_internal_gap`: true when a row inside the content bbox is fully transparent, which a plain bbox cannot detect — it means the crop contains two disconnected art pieces, not one (this is how three world-tileset PNGs shipped broken in this project: bush/rock/grass_tuft each had a real gap that getbbox()-only verification missed).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Texture to inspect (res:// or user:// path)' },
        hframes: { type: 'number', description: 'If the image is a horizontal sprite sheet, the number of equal-width frames to split it into. Default 1 (whole image). Must evenly divide the width.' }
      },
      required: ['path']
    }
  },
  {
    name: 'scene_diff',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Answer "what changed in this scene since I last looked" without re-reading the whole tree. Call once with just scene_path to take a snapshot (returns a snapshot_id, no tree), then call again with that snapshot_id to get only the added, removed and modified nodes — with per-property before/after for the ones that changed. Catches the developer\'s edits as well as your own, because it compares the actual tree rather than tracking tool calls. Use this instead of a second read_scene: on a scene of any size, almost all of a re-read is nodes that did not change. Snapshots live in the editor session and are dropped when it restarts.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene to snapshot or compare' },
        snapshot_id: { type: 'string', description: 'A snapshot_id from an earlier call. Omit to take a fresh baseline.' },
        include_properties: { type: 'boolean', description: 'Compare node properties, not just structure. Default true. Set false for a cheaper structure-only diff.' }
      },
      required: ['scene_path']
    }
  }
];
