/**
 * Tool registry - exports all tool definitions
 */

import { fileTools } from './file-tools.js';
import { sceneTools } from './scene-tools.js';
import { scriptTools } from './script-tools.js';
import { projectTools } from './project-tools.js';
import { assetTools } from './asset-tools.js';
import { visualizerTools } from './visualizer-tools.js';
import { tilemapTools } from './tilemap-tools.js';
import { animationTools } from './animation-tools.js';
import { audioTools } from './audio-tools.js';
import { physicsTools } from './physics-tools.js';
import { themeTools } from './theme-tools.js';
import { particleTools } from './particle-tools.js';
import { scene3dTools } from './scene3d-tools.js';
import { batchTools } from './batch-tools.js';
import { navigationTools } from './navigation-tools.js';
import { animationTreeTools } from './animation-tree-tools.js';
import { debugTools } from './debug-tools.js';
import { shaderTools } from './shader-tools.js';
import { testingTools } from './testing-tools.js';
import { analysisTools } from './analysis-tools.js';
import type { ToolDefinition } from '../types.js';

// Every tool the server knows about, before grouping.
const ALL_DEFS: ToolDefinition[] = [
  ...fileTools, ...sceneTools, ...scriptTools, ...projectTools, ...batchTools,
  ...analysisTools, ...animationTools, ...animationTreeTools, ...physicsTools,
  ...audioTools, ...tilemapTools, ...scene3dTools, ...shaderTools,
  ...navigationTools, ...themeTools, ...particleTools, ...testingTools,
  ...assetTools, ...visualizerTools, ...debugTools,
];

// The default-enabled set, chosen by name rather than by source file. It is the
// smallest surface that can carry a normal editing session end to end: look
// around, read/edit scenes and scripts, run the game, read the errors.
//
// Why so small: a large always-on tool list measurably degrades agent behaviour
// (it wanders between unrelated capabilities) and burns context on definitions
// the session never uses. Nothing is lost — everything below is one
// enable_toolset call away, and unknown-tool errors name the toolset to enable.
const CORE_TOOL_NAMES: string[] = [
  // Look around
  'list_dir', 'read_file', 'search_project', 'scene_tree_dump', 'read_scene',
  'classdb_query', 'get_project_settings',
  // Scenes and nodes
  'create_scene', 'add_node', 'remove_node', 'modify_node_property',
  'set_node_properties', 'rename_node', 'move_node', 'duplicate_node',
  'instance_scene', 'attach_script', 'connect_signal', 'batch_scene_edit',
  // Scripts
  'create_script', 'edit_script', 'list_scripts', 'validate_scripts', 'delete_file',
  // Run and observe
  'run_scene', 'stop_scene', 'is_playing', 'get_runtime_log', 'take_screenshot',
  'get_errors', 'get_console_log', 'rescan_filesystem',
  // Cross-cutting
  'batch_execute', 'find_nodes_by_type', 'get_scene_dependencies',
];

// Named groups for everything else. A tool listed here leaves its file's default
// group and joins this one, so sets read by intent ("I want to drive the running
// game") rather than by which source file happens to hold the handler.
const SEMANTIC_GROUPS: Record<string, string[]> = {
  // Drive and inspect the running game.
  runtime: [
    'get_runtime_status', 'wait', 'send_input', 'query_runtime_node',
    'connect_signal_runtime', 'disconnect_signal_runtime', 'tween_property_runtime',
    'play_animation_runtime', 'dump_control_tree', 'click_control_runtime',
    'get_focused_control', 'assert_screen_text', 'monitor_properties', 'game_eval', 'replay_input_sequence',
    'start_input_recording', 'stop_input_recording', 'get_multiplayer_status',
    'call_rpc_runtime', 'call_method_runtime', 'set_runtime_property',
    'await_signal_runtime', 'serialize_runtime_tree', 'spawn_headless_peers',
    'stop_headless_peers',
  ],
  // Generate the boilerplate instead of hand-writing it.
  scaffolding: [
    'wire_signal', 'generate_onready_refs', 'scaffold_entity',
    'scaffold_state_machine', 'generate_property_forwarder', 'create_csharp_script',
  ],
  // Project health, dead code, visual regression.
  analysis: [
    'get_project_statistics', 'find_unused_resources', 'detect_circular_dependencies',
    'analyze_scene_complexity', 'analyze_signal_flow', 'compare_screenshots',
  ],
  // The editor itself: what the developer is doing, selection, tabs, perf.
  editor: [
    'get_editor_activity', 'get_editor_selection', 'select_nodes',
    'clear_editor_selection', 'close_scene_tab', 'open_in_godot',
    'get_performance_monitors', 'get_editor_performance', 'clear_console_log', 'get_uid',
  ],
  // Project-level configuration.
  project_config: [
    'list_settings', 'update_project_settings', 'set_main_scene', 'configure_input_map',
    'get_input_map', 'setup_autoload', 'remove_autoload', 'create_resource', 'sync_localization',
    'get_collision_layers', 'set_resource_property', 'save_resource_to_file',
    'get_resource_info',
  ],
  // Ship a build.
  export: ['list_export_presets', 'get_export_info', 'export_project', 'get_export_status'],
  // Project-wide renames and bulk edits.
  refactor: [
    'rename_symbol_project_wide', 'rename_file', 'create_folder', 'batch_set_property',
    'validate_script',
  ],
  // Step-debug the running game through Godot's own debug adapter. Kept out of
  // core deliberately: a debugger is a deep, deliberate move ("stop at the
  // failure and read real values"), not something an agent should reach for
  // while doing routine scene edits.
  debug: [
    'debug_launch', 'debug_attach', 'debug_set_breakpoints', 'debug_continue',
    'debug_step', 'debug_stack_trace', 'debug_scopes', 'debug_variables',
    'debug_evaluate', 'debug_status', 'debug_disconnect',
  ],
};

// Where a tool goes when neither core nor a semantic group claims it: the group
// its source file belongs to. This is what guarantees no tool can be orphaned by
// an edit to the lists above.
const FILE_FALLBACK: Array<[string, ToolDefinition[]]> = [
  ['scene_editing', sceneTools],
  ['scene_editing', fileTools],
  ['scene_editing', scriptTools],
  ['scene_editing', batchTools],
  ['editor', projectTools],
  ['animation', animationTools],
  ['animation', animationTreeTools],
  ['physics', physicsTools],
  ['audio', audioTools],
  ['tilemap', tilemapTools],
  ['3d', scene3dTools],
  ['shaders', shaderTools],
  ['navigation', navigationTools],
  ['ui', themeTools],
  ['vfx', particleTools],
  ['testing', testingTools],
  ['analysis', analysisTools],
  ['utility', assetTools],
  ['utility', visualizerTools],
  ['debug', debugTools],
];

function buildToolsets(): Record<string, ToolDefinition[]> {
  const byName = new Map<string, ToolDefinition>();
  for (const def of ALL_DEFS) byName.set(def.name, def);

  const sets: Record<string, ToolDefinition[]> = { core: [] };
  const assigned = new Set<string>();

  const put = (group: string, def: ToolDefinition) => {
    (sets[group] ??= []).push(def);
    assigned.add(def.name);
  };

  for (const name of CORE_TOOL_NAMES) {
    const def = byName.get(name);
    // A typo in CORE_TOOL_NAMES would silently shrink core; fail loudly instead.
    if (!def) throw new Error(`core tool "${name}" is not a registered tool`);
    put('core', def);
  }

  for (const [group, names] of Object.entries(SEMANTIC_GROUPS)) {
    for (const name of names) {
      const def = byName.get(name);
      if (!def) throw new Error(`toolset "${group}" lists unknown tool "${name}"`);
      if (assigned.has(name)) continue;
      put(group, def);
    }
  }

  for (const [group, defs] of FILE_FALLBACK) {
    for (const def of defs) {
      if (assigned.has(def.name)) continue;
      put(group, def);
    }
  }

  // Nothing may be unreachable: a tool in no toolset can never be enabled.
  const orphans = ALL_DEFS.filter(d => !assigned.has(d.name)).map(d => d.name);
  if (orphans.length > 0) {
    throw new Error(`tools not reachable from any toolset: ${orphans.join(', ')}`);
  }
  return sets;
}

export const TOOLSETS: Record<string, ToolDefinition[]> = buildToolsets();

/** One-line purpose per toolset, surfaced by list_toolsets so a client can pick
 *  the right one without loading its definitions first. */
export const TOOLSET_DESCRIPTIONS: Record<string, string> = {
  core: 'Always on. Read the project, edit scenes/nodes/scripts, run the game, read errors.',
  scene_editing: 'Deeper scene work: collision shapes, sprites/meshes/materials, groups, anchors, spatial queries, signal disconnects.',
  runtime: 'Drive and inspect the running game: input, eval, live node/property access, signals, recording/replay, multiplayer peers.',
  scaffolding: 'Generate boilerplate: signal handlers, @onready refs, entity scenes, state machines, C# scripts.',
  analysis: 'Project health: unused resources, circular dependencies, scene complexity, signal-flow orphans, statistics, screenshot diffing.',
  editor: 'The editor itself: what the developer is doing (get_editor_activity), selection, scene tabs, performance.',
  project_config: 'Project settings, input map, autoloads, resources.',
  export: 'Build and ship: export presets and async export jobs.',
  refactor: 'Project-wide renames, bulk property edits, file moves.',
  debug: "Breakpoint debugging over Godot's Debug Adapter: stop the game and read real stack frames and variable values.",
  animation: 'AnimationPlayer tracks/keyframes and AnimationTree state machines.',
  physics: 'Collision shapes, raycasts, physics layers (by name or index), collision presets.',
  audio: 'AudioStreamPlayer nodes and buses.',
  tilemap: 'TileMapLayer cells, terrain, deterministic autotiling.',
  '3d': 'Mesh instances, lighting, materials, environment, cameras, gridmaps.',
  shaders: 'Create/read/edit GDShader, assign materials, set params.',
  navigation: 'NavigationRegion setup, mesh baking, agents, layers.',
  ui: 'Theme resources, colors, styleboxes, fonts.',
  vfx: 'GPUParticles2D/3D, gradients, presets.',
  testing: 'GUT test runner, scene/mesh validation, assertions.',
  utility: '2D asset generation, project/scene visualizer.',
};

export const allTools: ToolDefinition[] = Object.values(TOOLSETS).flat();

export function toolExists(toolName: string): boolean {
  return allTools.some(t => t.name === toolName);
}

/** Toolset a tool belongs to, so an unknown/disabled-tool error can tell the
 *  caller exactly which enable_toolset call unlocks it. */
export function toolsetOf(toolName: string): string | undefined {
  for (const [group, defs] of Object.entries(TOOLSETS)) {
    if (defs.some(t => t.name === toolName)) return group;
  }
  return undefined;
}
