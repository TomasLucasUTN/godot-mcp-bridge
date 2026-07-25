/**
 * Testing & QA tools - static assertions and integrity checks against saved
 * scene (.tscn) state. Handled editor-side (see testing_tools.gd); no
 * running game required. Complements the runtime tools (query_runtime_node,
 * send_input, take_screenshot) for live testing of an already-running game.
 */

import type { ToolDefinition } from '../types.js';

export const testingTools: ToolDefinition[] = [
  {
    name: 'assert_node_property',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Assert that a node property in a saved scene (.tscn) matches an expected value. Loads the scene fresh (does not affect the currently open editor tab), reads the property, and compares it. Returns {pass, actual, expected} — does NOT throw when the assertion fails, so the agent can inspect the mismatch. For a running game instead, use query_runtime_node and compare in your own logic.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'res:// path to the .tscn file' },
        node_path: { type: 'string', description: 'Path to the node relative to the scene root (e.g. "Player/Sprite2D"), or "." for the root' },
        property: { type: 'string', description: 'Property name to check (e.g. "visible", "position", "health")' },
        expected: { description: 'Expected value. Compared against the actual property after coercing to the property\'s real type.' },
        operator: { type: 'string', description: 'Comparison operator: "eq" (default), "neq", "gt", "gte", "lt", "lte" (numeric only for the last four)' },
      },
      required: ['scene_path', 'node_path', 'property', 'expected'],
    },
  },
  {
    name: 'run_scene_assertions',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Run a batch of assert_node_property checks against one scene in a single call and get a pass/fail report. Loads the scene once for all assertions (cheaper than calling assert_node_property repeatedly). Useful as a pre-flight sanity check for a scene\'s configuration before or after edits.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'res:// path to the .tscn file' },
        assertions: {
          type: 'array',
          description: 'List of assertions to run: [{node_path, property, expected, operator?}, ...]',
          items: {
            type: 'object',
            properties: {
              node_path: { type: 'string' },
              property: { type: 'string' },
              expected: {},
              operator: { type: 'string' },
            },
            required: ['node_path', 'property', 'expected'],
          },
        },
      },
      required: ['scene_path', 'assertions'],
    },
  },
  {
    name: 'validate_scene_integrity',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Scan a saved scene for nodes left with an empty required resource slot (e.g. a CollisionShape2D with no shape, a Sprite2D with no texture, an AudioStreamPlayer with no stream). Catches the common "added the node but never configured it" mistake. Returns a list of {node_path, node_class, property, issue}.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'res:// path to the .tscn file' },
      },
      required: ['scene_path'],
    },
  },
  {
    name: 'validate_meshes',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Sweep mesh resources for empty/degenerate geometry: a mesh with zero surfaces, a surface with zero vertices, or a file that fails to load. Catches "created/imported but empty" meshes that silently render nothing. Pass "paths" (res:// .mesh/.obj/.tres/.res files) to check a specific set, or omit to sweep every mesh in the project. The mesh analogue of validate_scripts. Returns {total, invalid_count, invalid:[{path, issues}]}.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of res:// mesh resource paths to validate. Omit to sweep every mesh in the project.',
        },
      },
    },
  },
  {
    name: 'run_gut_tests',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Run the project's GUT (Godot Unit Test) suite in a headless Godot process and return structured results: scripts, total, passed, failed, all_passed, plus a log tail. GUT must be installed at res://addons/gut (from the AssetLib). Point test_dir at your tests (default res://test). Fast suites run synchronously; for large/integration suites that would time out or freeze the editor, pass async:true — it returns a job_id and you poll get_gut_status.",
    inputSchema: {
      type: 'object',
      properties: {
        test_dir: { type: 'string', description: 'Directory holding the GUT test scripts (default res://test).' },
        include_subdirs: { type: 'boolean', description: 'Recurse into subdirectories of test_dir (default true).' },
        async: { type: 'boolean', description: 'Run in the background and return a job_id instead of blocking (default false). Poll get_gut_status.' },
      },
    },
  },
  {
    name: 'get_gut_status',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Poll an async GUT run started by run_gut_tests({async:true}). Pass the job_id it returned. status is "running" until the suite finishes, then "done" with the same fields run_gut_tests returns synchronously (total/passed/failed/all_passed/log).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job_id returned by run_gut_tests with async:true.' },
      },
      required: ['job_id'],
    },
  },
];
