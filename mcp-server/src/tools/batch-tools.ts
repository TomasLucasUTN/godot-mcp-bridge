/**
 * Batch/refactor/analysis tools for Godot MCP Server
 * Tools for cross-node bulk edits and project-wide analysis
 */

import type { ToolDefinition } from '../types.js';

export const batchTools: ToolDefinition[] = [
  {
    name: 'batch_execute',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Run a sequence of {tool, args} calls in ONE request instead of N round-trips — the way to build several scenes at once (batch_scene_edit covers only one). Dispatches inside the EDITOR, so it cannot reach tools that live in the running game (take_screenshot, send_input, query_runtime_node, game_eval, ...); call those directly. NOT a transaction: each scene tool still does its own load/save. stop_on_error halts at the first failure. Cannot be nested.",
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: { type: 'object', description: '{tool: string, args: object}' },
          description: 'Ordered list of {tool, args} to run. Max 100. e.g. [{"tool":"add_node","args":{...}}, {"tool":"set_node_properties","args":{...}}]'
        },
        stop_on_error: { type: 'boolean', description: 'If true, stop at the first operation that returns ok:false. Default: false (run all).' }
      },
      required: ['operations']
    }
  },
  {
    name: 'find_nodes_by_type',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Recursively find all nodes of a given class (or subclass, unless exact_match) in a scene. Returns node_path/node_name/node_type for each match.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_type: { type: 'string', description: 'Class name to match, e.g. "CharacterBody2D"' },
        exact_match: { type: 'boolean', description: 'If true, match exact class only (not subclasses). Default: false' }
      },
      required: ['scene_path', 'node_type']
    }
  },
  {
    name: 'batch_set_property',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Set ONE property to the SAME value across MANY nodes, in a single call and save. Pairs with find_nodes_by_type. NOT for several properties on one node (set_node_properties) and NOT for a single node (modify_node_property). Nodes that don\'t exist or lack the property are reported in "failed" without aborting the rest.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_paths: { type: 'array', items: { type: 'string' }, description: 'Node paths (relative to scene root) to update' },
        property_name: { type: 'string', description: 'Property to set, e.g. "visible" or "floor_snap_length"' },
        value: { description: 'New value. Same shape as modify_node_property.value' }
      },
      required: ['scene_path', 'node_paths', 'property_name', 'value']
    }
  },
  {
    name: 'get_scene_dependencies',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List a scene\'s resource dependencies (instanced sub-scenes, scripts, external resources) via ResourceLoader.get_dependencies — reads the file\'s dependency table directly, no need to load the scene.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'rename_symbol_project_wide',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Rename a symbol across all .gd files by WORD-BOUNDARY TEXT MATCHING. Prefer gd_rename (toolset "code_intel") when it applies: it uses Godot\'s language server and understands scope, so it will not touch an unrelated symbol that happens to share the name — this tool will. Reach for this one when you need something the language server cannot do: renaming inside .tscn files (include_scenes=true, e.g. method names in signal connections), or a project-wide sweep of a name that is not a resolvable symbol. Defaults to dry_run=true — call once to preview matches (file, line, count), then again with dry_run=false to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        old_name: { type: 'string', description: 'Current symbol name (must be a valid identifier)' },
        new_name: { type: 'string', description: 'New symbol name (must be a valid identifier)' },
        dry_run: { type: 'boolean', description: 'Preview only, no changes written (default: true)' },
        include_scenes: { type: 'boolean', description: 'Also rewrite matches in .tscn files (default: false)' },
        root: { type: 'string', description: 'Root path to search from (default: res://)' }
      },
      required: ['old_name', 'new_name']
    }
  }
];
