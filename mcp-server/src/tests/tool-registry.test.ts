import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { allTools, toolExists } from '../tools/index.js';
import { RUNTIME_ONLY_TOOLS } from '../godot-bridge.js';
import { isDebugTool, DEBUG_TOOL_NAMES } from '../debug-session.js';
import { isLspTool, LSP_TOOL_NAMES } from '../lsp-session.js';

function getExecutorToolNames(): Set<string> {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const executorPath = path.resolve(testDir, '../../../addons/godot_mcp/tool_executor.gd');
  const source = readFileSync(executorPath, 'utf8');
  const mapped = [...source.matchAll(/&"([^"]+)": \[_[a-z0-9_]+, &"[^"]+"\]/g)]
    .map(match => match[1]);
  // Tools handled by a special early-dispatch (e.g. batch_execute) rather than the
  // _tool_map dict — matched via `if tool_name == "..."`.
  const specialDispatch = [...source.matchAll(/tool_name == "([a-z_]+)"/g)]
    .map(match => match[1]);
  return new Set(
    [...mapped, ...specialDispatch].filter(name => !name.startsWith('visualizer._internal_'))
  );
}

function getRuntimeToolNames(): Set<string> {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const runtimePath = path.resolve(testDir, '../../../addons/godot_mcp/runtime/mcp_runtime.gd');
  const source = readFileSync(runtimePath, 'utf8');
  const dispatched = [...source.matchAll(/"([a-z_]+)":\s*\n\s*return _[a-z_]+\(/g)]
    .map(match => match[1]);
  // Runtime tools handled outside the _dispatch match (e.g. monitor_properties runs
  // an async per-frame job) are wired via `if tool_name == "..."`.
  const specialDispatch = [...source.matchAll(/tool_name == "([a-z_]+)"/g)]
    .map(match => match[1]);
  return new Set([...dispatched, ...specialDispatch]);
}

describe('Tool registry', () => {
  it('exports a non-empty list of tools', () => {
    expect(allTools.length).toBeGreaterThan(0);
  });

  it('every tool has name, description, and inputSchema', () => {
    for (const tool of allTools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('tool names are unique', () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('toolExists returns true for known tools', () => {
    const firstTool = allTools[0].name;
    expect(toolExists(firstTool)).toBe(true);
  });

  it('toolExists returns false for unknown tools', () => {
    expect(toolExists('definitely_not_a_tool_xyz')).toBe(false);
  });

  it('every advertised MCP tool is registered in the Godot executor map OR the runtime helper OR handled server-side', () => {
    const executorTools = getExecutorToolNames();
    const runtimeTools = getRuntimeToolNames();
    // debug_* tools speak DAP to the editor's own adapter from the Node server,
    // so they have no GDScript handler by design — isDebugTool is the single
    // source of truth for that set, and index.ts dispatches on the same check.
    const missing = allTools
      .map(tool => tool.name)
      .filter(name => !executorTools.has(name) && !runtimeTools.has(name) && !isDebugTool(name) && !isLspTool(name));

    expect(missing).toEqual([]);
  });

  it('every name the server-side dispatchers claim is actually advertised', () => {
    // The reverse guard. The test above proves no advertised tool is unreachable;
    // this one proves the exemption sets aren't hiding a tool that was renamed or
    // dropped. A name in DEBUG_TOOL_NAMES/LSP_TOOL_NAMES with no matching tool
    // definition would be routed to a handler nobody can call, instead of
    // erroring as unknown.
    const advertised = new Set(allTools.map(t => t.name));
    const claimed = [...DEBUG_TOOL_NAMES, ...LSP_TOOL_NAMES];
    const orphaned = claimed.filter(name => !advertised.has(name));

    expect(orphaned).toEqual([]);
  });

  it('runtime-only tools are declared in the runtime helper, not the editor map', () => {
    const executorTools = getExecutorToolNames();
    const runtimeTools = getRuntimeToolNames();
    for (const name of RUNTIME_ONLY_TOOLS) {
      expect(runtimeTools.has(name), `${name} missing from mcp_runtime.gd`).toBe(true);
      expect(executorTools.has(name), `${name} should NOT be in tool_executor.gd`).toBe(false);
    }
  });
});

/**
 * server.json is what the MCP registry publishes, and it is a separate file from
 * package.json with its own copy of the version. `npm version` does not touch it.
 *
 * That drift is not theoretical: 1.1.4 was tagged and released with server.json
 * still saying 1.1.3. The release workflow caught it, but only at release time —
 * after npm was already published and the tag already pushed, which then had to
 * be moved. Checking it here means a mismatch fails on the push that caused it.
 */
describe('version consistency', () => {
  const read = (p: string) =>
    JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as Record<string, any>;

  it('server.json agrees with package.json', () => {
    const pkg = read('../../package.json');
    const server = read('../../server.json');
    expect(server.version).toBe(pkg.version);
    // The registry installs packages[0]; a stale entry there advertises a
    // version that npm may not have.
    expect(server.packages[0].version).toBe(pkg.version);
  });
});
