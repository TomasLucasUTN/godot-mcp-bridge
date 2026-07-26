#!/usr/bin/env node
/**
 * Godot MCP Server
 *
 * An MCP server that provides Godot game engine tools to AI assistants.
 * Works with Claude Desktop, Cursor, Codex, or any MCP-compatible client.
 *
 * Architecture (connect-or-spawn):
 *   When started, the server probes for an existing primary instance.
 *   - If found  → enters PROXY mode (forwards tool calls via HTTP)
 *   - If absent → enters PRIMARY mode (owns Godot bridge + HTTP API)
 *
 * Primary mode:
 *   - WebSocket server on port 6505 for Godot plugin communication
 *   - HTTP server on port 6506 for proxy instances
 *   - MCP protocol via stdio for the launching AI client
 *
 * Proxy mode:
 *   - MCP protocol via stdio for the launching AI client
 *   - Forwards tool calls to the primary via HTTP
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve as resolvePath } from 'path';
import { allTools, toolExists, TOOLSETS, TOOLSET_DESCRIPTIONS, toolsetOf } from './tools/index.js';
import { GodotBridge } from './godot-bridge.js';
import { registerResources, GUIDES } from './resources.js';
import { ActivityFeed, type ActivityEvent } from './activity-feed.js';
import { serveVisualization, stopVisualizationServer, setGodotBridge } from './visualizer-server.js';
import { PrimaryHttpServer, type ToolCallResult } from './primary-http.js';
import { probeExistingServer, proxyToolCall, registerProxyClient, unregisterProxyClient } from './proxy-client.js';
import { isDebugTool, handleDebugTool } from './debug-session.js';
import { isLspTool, handleLspTool } from './lsp-session.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_NAME = 'godot-mcp-bridge';

// Read version from package.json so it stays in sync with the published
// package.  Falls back to a hardcoded string only if the file is unreadable
// (e.g. the file got renamed in a custom build).
const SERVER_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../package.json   |   src/index.ts (tsx) → ../package.json
    const pkgPath = resolvePath(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // ignore — fall through to default
  }
  return '0.0.0-dev';
})();
const WEBSOCKET_PORT = parseInt(process.env.GODOT_MCP_PORT || '6505', 10);
// When set, the bridge refuses any Godot editor that doesn't have this exact
// project open. Off by default (the common case is one project, one server);
// worth setting when several projects or a CI editor share a machine, since the
// addon dials a fixed port and cannot tell which server it reached.
const EXPECTED_PROJECT = process.env.GODOT_MCP_PROJECT || null;
// Optional shared secret for the editor/runtime handshake. The bridge already
// refuses any connection that sends an Origin header, which is what keeps a web
// page from driving the editor; this covers the remaining case of another local
// process. Set the same value in the editor via GODOT_MCP_SECRET or the
// `godot_mcp/network/secret` project setting. Unset = no check (unchanged).
const EXPECTED_SECRET = process.env.GODOT_MCP_SECRET || null;
const HTTP_PORT = parseInt(process.env.GODOT_MCP_HTTP_PORT || '6506', 10);
const TOOL_TIMEOUT = parseInt(process.env.GODOT_MCP_TIMEOUT_MS || '30000', 10);
const IDLE_TIMEOUT = parseInt(process.env.GODOT_MCP_IDLE_TIMEOUT_MS || '30000', 10);

const args = process.argv.slice(2);
const noForce = args.includes('--no-force');

// Setup subcommands. These run instead of the MCP server: a client always
// launches the binary with no subcommand, so `install`/`doctor` can only come
// from a human at a terminal.
const subcommand = args[0];
if (subcommand === 'install' || subcommand === 'doctor' || subcommand === 'help' || subcommand === '--help') {
  const { runInstall, runDoctor, printCliHelp } = await import('./cli.js');
  if (subcommand === 'install') process.exit(await runInstall(args.slice(1)));
  if (subcommand === 'doctor') process.exit(await runDoctor(args.slice(1)));
  printCliHelp();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Tool execution (shared logic used by both primary MCP handler & HTTP API)
// ---------------------------------------------------------------------------

let godotBridge: GodotBridge | null = null;
let activityFeed: ActivityFeed | undefined;

// Toolsets currently visible in list_tools, for this process. "core" is
// always on; the rest are opt-in via enable_toolset so a fresh session
// isn't handed all ~150 tool definitions at once. This only controls what
// list_tools *shows* — executeToolCall below still executes any known tool
// regardless of toolset state, so a client that already knows a tool name
// (e.g. from a previous session) doesn't get a confusing hard failure.
const activeToolsets = new Set<string>(['core']);
const OPTIONAL_TOOLSET_NAMES = Object.keys(TOOLSETS).filter(name => name !== 'core');

// Tools that write to a scene file and thus can leave dangling resource
// references behind (empty CollisionShape2D.shape, etc.). After one of
// these succeeds, we auto-run validate_scene_integrity on the same scene
// and attach the result so the agent doesn't have to ask for it.
const SCENE_INTEGRITY_CHECK_TOOLS = new Set([
  'remove_node',
  'set_node_properties',
  'modify_node_property',
  'batch_set_property',
]);

// Operations that cannot be taken back from inside the editor.
//
// Deliberately NOT every destructive tool: an edit to a scene that's OPEN goes
// through Godot's undo history, so Ctrl+Z (or undo_last) already covers it —
// including batch_scene_edit, which lands as a single entry. What's listed here
// writes to disk or to project config with no undo entry — deleting or renaming
// files, rewriting script text, mass renames, and settings/autoload changes.
//
// Gating is opt-in (GODOT_MCP_REQUIRE_CONFIRM=true). Default off because
// turning it on by default would break every existing 1.x caller; on, each of
// these needs an explicit `confirm: true`, which is what an agent operating
// unattended on a real project should be running with.
const IRREVERSIBLE_TOOLS = new Set([
  'delete_file', 'rename_file',
  'edit_script',
  'rename_symbol_project_wide', 'gd_rename',
  'update_project_settings', 'set_main_scene',
  'setup_autoload', 'remove_autoload',
  'sync_localization',
]);

const REQUIRE_CONFIRM = process.env.GODOT_MCP_REQUIRE_CONFIRM?.toLowerCase() === 'true';

/**
 * True when a call must be refused for lack of confirmation.
 *
 * A tool already in preview mode (dry_run, or gd_rename without apply) is not
 * blocked — the preview IS the confirmation step, and demanding both would be
 * noise. delete_file is skipped because it has always enforced its own confirm
 * gate deeper down; double-reporting would just confuse the caller.
 *
 * `requireConfirm` is a parameter rather than a direct env read so the rule is
 * testable without mutating process.env.
 */
export function needsConfirmation(
  name: string,
  args: Record<string, unknown>,
  requireConfirm: boolean = REQUIRE_CONFIRM,
): boolean {
  if (!requireConfirm) return false;
  if (!IRREVERSIBLE_TOOLS.has(name)) return false;
  if (args.confirm === true) return false;
  if (args.dry_run === true) return false;
  if (name === 'gd_rename' && args.apply !== true) return false;
  if (name === 'delete_file') return false;
  return true;
}

function confirmationBlock(name: string, args: Record<string, unknown>): ToolCallResult | null {
  if (!needsConfirmation(name, args)) return null;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: `'${name}' makes a change that cannot be undone from the editor, and confirmation is required (GODOT_MCP_REQUIRE_CONFIRM=true).`,
        tool: name,
        hint: `Re-run with confirm: true once you've checked the arguments.${
          name.includes('rename') ? ' A dry_run/preview pass first is cheaper than undoing this by hand.' : ''
        }`,
      }),
    }],
    isError: true,
  };
}

async function executeToolCall(
  name: string,
  toolArgs: Record<string, unknown>
): Promise<ToolCallResult> {
  if (name === 'list_toolsets') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          toolsets: Object.entries(TOOLSETS).map(([toolsetName, tools]) => ({
            name: toolsetName,
            tool_count: tools.length,
            enabled: activeToolsets.has(toolsetName),
            description: TOOLSET_DESCRIPTIONS[toolsetName] ?? '',
            // Names only (not full schemas) so a client can find the tool it
            // needs and enable exactly one toolset, without paying for every
            // definition up front.
            tools: tools.map(t => t.name),
          })),
        }),
      }],
    };
  }

  if (name === 'enable_toolset' || name === 'disable_toolset') {
    const toolsetName = typeof toolArgs.name === 'string' ? toolArgs.name : '';
    if (toolsetName === 'core') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: '"core" is always enabled.' }) }],
        isError: true,
      };
    }
    if (!TOOLSETS[toolsetName]) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Unknown toolset: ${toolsetName}`,
            available: OPTIONAL_TOOLSET_NAMES,
          }),
        }],
        isError: true,
      };
    }
    if (name === 'enable_toolset') {
      activeToolsets.add(toolsetName);
    } else {
      activeToolsets.delete(toolsetName);
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          toolset: toolsetName,
          enabled: activeToolsets.has(toolsetName),
          hint: 'Call list_tools again to see the updated tool list.',
        }),
      }],
    };
  }

  if (name === 'get_guide') {
    const slug = typeof toolArgs.slug === 'string' ? toolArgs.slug.trim() : '';
    if (!slug) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            guides: GUIDES.map((g) => ({
              slug: g.slug,
              name: g.name,
              description: g.description,
              uri: g.uri,
            })),
            hint: 'Call get_guide again with one of these slugs to read the full markdown.',
          }),
        }],
      };
    }
    const guide = GUIDES.find((g) => g.slug === slug || g.uri === slug);
    if (!guide) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: `Unknown guide slug: ${slug}`,
            available_slugs: GUIDES.map((g) => g.slug),
          }),
        }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          slug: guide.slug,
          name: guide.name,
          uri: guide.uri,
          markdown: guide.text,
        }),
      }],
    };
  }

  if (name === 'get_godot_status') {
    const status = godotBridge!.getStatus();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          connected: status.connected,
          server_version: SERVER_VERSION,
          websocket_port: status.port,
          mode: status.connected ? 'live' : 'waiting',
          project_path: status.projectPath || null,
          connected_at: status.connectedAt?.toISOString() || null,
          pending_requests: status.pendingRequests,
          message: status.connected
            ? `Godot is connected${status.projectPath ? ` (${status.projectPath})` : ''}. Tools will execute in the Godot editor.`
            : 'Godot is not connected. Open a Godot project with the MCP plugin enabled to connect.'
        })
      }]
    };
  }

  // Checked before any dispatch path so it covers addon tools, LSP tools and
  // debugger tools alike.
  const blocked = confirmationBlock(name, toolArgs);
  if (blocked) return blocked;

  // Language-server tools, same rationale as the debugger block below: they talk
  // to the editor's LSP listener (6005), not the addon.
  if (isLspTool(name)) {
    try {
      const payload = await handleLspTool(name, toolArgs, godotBridge!.getStatus().projectPath ?? null);
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message, tool: name }) }],
        isError: true,
      };
    }
  }

  // Debugger tools speak DAP straight to the editor's own adapter, not through
  // the addon bridge, so they're answered here — and deliberately BEFORE the
  // isConnected() guard below, since the adapter is reachable whether or not
  // the addon has connected.
  if (isDebugTool(name)) {
    try {
      const payload = await handleDebugTool(name, toolArgs, godotBridge!.getStatus().projectPath ?? null);
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message, tool: name }) }],
        isError: true,
      };
    }
  }

  if (name === 'diagnose_connection') {
    const status = godotBridge!.getStatus();
    const listening = godotBridge!.isListening();
    const checks = [
      { check: 'MCP server (Node) running', ok: true, detail: `v${SERVER_VERSION}` },
      { check: 'WebSocket bridge listening', ok: listening, detail: `port ${WEBSOCKET_PORT}` },
      { check: 'Godot editor connected', ok: status.connected, detail: status.connected ? `${status.projectPath || 'connected'} since ${status.connectedAt?.toISOString()}` : 'no editor on the bridge' },
    ];
    const healthy = status.connected && listening;
    const remedies = healthy ? [] : [
      `Open your project in the Godot editor — the plugin auto-connects to port ${WEBSOCKET_PORT} on load.`,
      'Enable the plugin: Project > Project Settings > Plugins > "Godot MCP" checkbox ON.',
      'Confirm the addon exists at res://addons/godot_mcp/ with plugin.cfg present.',
      'Godot 4.3+ is required (the tools use the 4.x TileMapLayer / EditorInterface API).',
      `If another program holds port ${WEBSOCKET_PORT}, close it (or set GODOT_MCP_PORT on BOTH the server and the addon).`,
      'Launch the full Godot .exe, not the *_console.exe stub (it dies with CreateProcess error 193 on Windows).',
      'Check the editor Output panel for "[Godot MCP] Plugin loading..." / "[MCP] Connected to server".',
    ];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          healthy,
          server_version: SERVER_VERSION,
          websocket_port: WEBSOCKET_PORT,
          http_bridge_port: HTTP_PORT,
          editor_connected: status.connected,
          project_path: status.projectPath || null,
          connected_at: status.connectedAt?.toISOString() || null,
          pending_requests: status.pendingRequests,
          checks,
          message: healthy
            ? 'Connection healthy — the editor is connected and tools will run.'
            : 'Editor not connected. Work through the remedies in order; the first that applies usually fixes it.',
          ...(healthy ? {} : { remedies }),
        })
      }]
    };
  }

  if (!toolExists(name)) {
    // Dumping all ~180 tool names here costs a lot of context for little help.
    // Point at close matches and at list_toolsets instead.
    const needle = name.toLowerCase();
    const close = allTools
      .map(t => t.name)
      .filter(n => n.includes(needle) || needle.includes(n) || n.split('_').some(part => needle.includes(part)))
      .slice(0, 8);
    const hint = close.length > 0
      ? ` Did you mean: ${close.map(n => `${n} (toolset: ${toolsetOf(n)})`).join(', ')}?`
      : ` Call list_toolsets to see every toolset and the tools it holds.`;
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}.${hint}`);
  }

  if (!godotBridge!.isConnected()) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Godot editor is not connected',
          tool: name,
          hint: `Open a Godot project with the MCP plugin enabled. The plugin will auto-connect to this server on port ${WEBSOCKET_PORT}.`
        })
      }],
      isError: true
    };
  }

  try {
    const result = await godotBridge!.invokeTool(name, toolArgs);

    if (name === 'map_project' && result && typeof result === 'object' && 'project_map' in (result as Record<string, unknown>)) {
      try {
        const projectMap = (result as Record<string, unknown>).project_map;
        const url = await serveVisualization(projectMap);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...(result as Record<string, unknown>),
              visualization_url: url,
              message: `Project mapped: ${(projectMap as any).total_scripts} scripts, ${(projectMap as any).total_connections} connections. Interactive visualization opened in browser at ${url}`
            })
          }]
        };
      } catch (vizError) {
        console.error(`[${SERVER_NAME}] Visualization failed:`, vizError);
      }
    }

    let resultPayload: Record<string, unknown> = result as Record<string, unknown>;

    if (
      SCENE_INTEGRITY_CHECK_TOOLS.has(name) &&
      resultPayload &&
      resultPayload.ok !== false &&
      typeof toolArgs.scene_path === 'string' &&
      toolArgs.dry_run !== true &&
      resultPayload.dry_run !== true
    ) {
      try {
        const integrityResult = await godotBridge!.invokeTool('validate_scene_integrity', {
          scene_path: toolArgs.scene_path,
        });
        resultPayload = { ...resultPayload, _integrity_check: integrityResult };
      } catch (integrityError) {
        console.error(`[${SERVER_NAME}] Auto integrity check failed for ${name}:`, integrityError);
        resultPayload = { ...resultPayload, _integrity_check: { ok: false, error: 'Automatic integrity check could not run.' } };
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(resultPayload)
      }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Merge any structured details the tool shipped back (open_in_editor,
    // where, is_active, clamped, requested_ms, …) into the visible response
    // so the agent doesn't lose context on failure.
    const details =
      error && typeof error === 'object' && 'details' in error
        ? (error as { details?: unknown }).details
        : undefined;
    const payload: Record<string, unknown> = {
      error: errorMessage,
      tool: name,
      args: toolArgs,
      mode: 'live',
      hint: 'The tool call was sent to Godot but failed. Check Godot editor for details.',
    };
    if (details && typeof details === 'object') {
      // Spread structured fields at the top level (callers already look for
      // `open_in_editor`, `clamped`, etc. at the root). Drop `ok` since it
      // is always false here and adds no information.
      const { ok: _ok, error: _err, ...rest } = details as Record<string, unknown>;
      Object.assign(payload, rest);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP server factory (creates an MCP Server wired to a tool handler)
// ---------------------------------------------------------------------------

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>;

function createMcpServer(handleTool: ToolHandler): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: true }, resources: { subscribe: true } } }
  );

  // The live editor-activity feed. Only wired in primary mode: a proxy client
  // has no bridge to ask, and advertising a feed that can never fire is worse
  // than not advertising it.
  activityFeed = godotBridge
    ? new ActivityFeed(
        server,
        async (sinceId) => {
          if (!godotBridge?.isConnected()) return null;
          const raw = await godotBridge.invokeTool('get_editor_activity', { since_id: sinceId, limit: 50 });
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return parsed as { events: ActivityEvent[]; latest_id: number };
        },
        (level, message) => console.error(`[${SERVER_NAME}] [${level}] ${message}`)
      )
    : undefined;

  // The addon pushes each human action as it happens, so the feed does not have
  // to poll for it in the steady state.
  if (activityFeed && godotBridge) {
    const feed = activityFeed;
    godotBridge.onEditorActivity((event) => feed.push(event as unknown as ActivityEvent));
  }

  registerResources(server, activityFeed);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const connectionStatusTool = {
      name: 'get_godot_status',
      description: 'Check if Godot editor is connected to the MCP server.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: []
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    };

    const diagnoseConnectionTool = {
      name: 'diagnose_connection',
      description: 'Diagnose why the Godot editor is (or is not) connected — the #1 setup frustration. Works even when nothing is connected (runs entirely in the MCP server). Returns a pass/fail checklist plus, when disconnected, an ordered list of concrete remedies (enable the plugin, wrong port, Godot version, the _console.exe stub, etc.). Call this first when tools report "Godot editor is not connected".',
      inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
      annotations: { readOnlyHint: true, openWorldHint: false }
    };

    const getGuideTool = {
      name: 'get_guide',
      description: `Read a short markdown guide from the server. Same content as the MCP resources/read protocol, exposed as a tool so it works in MCP clients that do not support resources (e.g. Claude Desktop, Cursor chat). Call with no args to list available guides: ${GUIDES.map((g) => g.slug).join(', ')}. Call with {slug: "..."} to get the full markdown. Useful when a workflow is non-obvious (testing a running game, choosing between scene-editing tools, troubleshooting "Runtime helper not connected", etc.).`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          slug: {
            type: 'string',
            description: `Guide slug. Omit to list all available guides. Known slugs: ${GUIDES.map((g) => g.slug).join(', ')}.`,
          },
        },
        required: [] as string[],
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    };

    const listToolsetsTool = {
      name: 'list_toolsets',
      description: `List every toolset with what it is for and the names of the tools it holds, plus whether it is currently enabled. Only "core" is on by default; if the tool you need is not in list_tools, find it here and enable that one toolset. Optional toolsets: ${OPTIONAL_TOOLSET_NAMES.join(', ')}.`,
      inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
      annotations: { readOnlyHint: true, openWorldHint: false }
    };

    const enableToolsetTool = {
      name: 'enable_toolset',
      description: `Enable an optional toolset so its tools appear in the next list_tools call. "core" (look around, edit scenes/scripts, run the game, read errors) is always visible; everything else is opt-in to keep the active tool surface small. Call list_toolsets first if you are unsure which one holds the tool you need. Available toolsets: ${OPTIONAL_TOOLSET_NAMES.join(', ')}.`,
      inputSchema: {
        type: 'object' as const,
        properties: { name: { type: 'string', description: `Toolset name. One of: ${OPTIONAL_TOOLSET_NAMES.join(', ')}.` } },
        required: ['name'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    };

    const disableToolsetTool = {
      name: 'disable_toolset',
      description: 'Disable a previously-enabled toolset so its tools stop appearing in list_tools. Does not affect already-known tool names — see enable_toolset.',
      inputSchema: {
        type: 'object' as const,
        properties: { name: { type: 'string', description: `Toolset name. One of: ${OPTIONAL_TOOLSET_NAMES.join(', ')}.` } },
        required: ['name'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    };

    const visibleTools = Object.entries(TOOLSETS)
      .filter(([toolsetName]) => activeToolsets.has(toolsetName))
      .flatMap(([, tools]) => tools);

    return {
      tools: [
        connectionStatusTool,
        diagnoseConnectionTool,
        getGuideTool,
        listToolsetsTool,
        enableToolsetTool,
        disableToolsetTool,
        ...visibleTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {})
        }))
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleTool(name, (args || {}) as Record<string, unknown>);
    if ((name === 'enable_toolset' || name === 'disable_toolset') && !result.isError) {
      // Let the client know it should re-fetch list_tools. Not all clients
      // act on this notification, so enable/disable results also carry an
      // explicit hint to call list_tools again as a fallback.
      server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {});
    }
    return result as { content: Array<{ type: string; text: string }>; isError?: boolean; [key: string]: unknown };
  });

  return server;
}

// ---------------------------------------------------------------------------
// Kill process on port (only used as last resort)
// ---------------------------------------------------------------------------

async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    const platform = process.platform;
    let pid: string | undefined;

    if (platform === 'win32') {
      const output = execSync(
        `netstat -ano | findstr :${port} | findstr LISTENING`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = output.trim().split('\n')[0]?.match(/\s+(\d+)\s*$/);
      pid = match?.[1];
    } else {
      // -sTCP:LISTEN is critical: plain `lsof -ti :PORT` also returns PIDs of
      // *clients* with an ESTABLISHED socket to that port. Godot is a client
      // of our WebSocket on 6505, so without this filter a "kill the process
      // on 6505" call can SIGTERM the Godot editor and crash it.
      const output = execSync(
        `lsof -ti :${port} -sTCP:LISTEN`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      pid = output.trim().split('\n')[0];
    }

    if (pid) {
      const pidNum = parseInt(pid, 10);
      if (pidNum === process.pid) return false;
      console.error(`[${SERVER_NAME}] Killing existing process on port ${port} (PID ${pid})...`);
      process.kill(pidNum, 'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1500));
      return true;
    }
  } catch {
    // No process on port, or kill failed — proceed
  }
  return false;
}

// ---------------------------------------------------------------------------
// PRIMARY MODE
// ---------------------------------------------------------------------------

async function startPrimary(): Promise<void> {
  console.error(`[${SERVER_NAME}] Starting in PRIMARY mode v${SERVER_VERSION}...`);

  godotBridge = new GodotBridge(WEBSOCKET_PORT, TOOL_TIMEOUT, EXPECTED_PROJECT, EXPECTED_SECRET);
  setGodotBridge(godotBridge);

  godotBridge.onConnectionChange((connected) => {
    if (connected) {
      console.error(`[${SERVER_NAME}] Godot connected`);
      cancelIdleShutdown();
      notifyClientStatus(); // send current client count immediately on connect
    } else {
      console.error(`[${SERVER_NAME}] Godot disconnected`);
      maybeStartIdleShutdown();
    }
  });

  // --- Start WebSocket bridge ---
  if (!noForce) {
    await killProcessOnPort(WEBSOCKET_PORT);
  }

  try {
    await godotBridge.start();
    console.error(`[${SERVER_NAME}] WebSocket server listening on port ${WEBSOCKET_PORT}`);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') {
      // Race condition: another instance may have just started.
      // Retry probe with delays — the winner needs time to start its HTTP server.
      console.error(`[${SERVER_NAME}] Port ${WEBSOCKET_PORT} in use, re-probing for primary...`);
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        const retry = await probeExistingServer(HTTP_PORT);
        if (retry.alive) {
          console.error(`[${SERVER_NAME}] Primary appeared during startup, switching to proxy mode`);
          godotBridge.stop();
          godotBridge = null;
          return startProxy();
        }
      }

      // Genuinely stuck — kill and retry once
      console.error(`[${SERVER_NAME}] No healthy primary found, killing zombie on port ${WEBSOCKET_PORT}...`);
      await killProcessOnPort(WEBSOCKET_PORT);
      try {
        await godotBridge.start();
        console.error(`[${SERVER_NAME}] WebSocket server listening on port ${WEBSOCKET_PORT} (after retry)`);
      } catch {
        console.error(`[${SERVER_NAME}] ❌ Port ${WEBSOCKET_PORT} still unavailable after retry.`);
        console.error(`[${SERVER_NAME}] To fix:  lsof -ti :${WEBSOCKET_PORT} | xargs kill`);
        console.error(`[${SERVER_NAME}] Continuing without Godot bridge — tools will error.`);
      }
    } else {
      console.error(`[${SERVER_NAME}] Failed to start WebSocket server:`, error);
    }
  }

  // --- Track AI client count and push status to Godot ---
  let directClientConnected = true; // stdin is open when we start = 1 direct client

  function notifyClientStatus(): void {
    const total = (directClientConnected ? 1 : 0) + httpServer.getProxyClientCount();
    godotBridge?.sendClientStatus(total);
  }

  // --- Start HTTP server for proxies ---
  const httpServer = new PrimaryHttpServer(HTTP_PORT, SERVER_VERSION, executeToolCall, allTools.length + 6);
  httpServer.setClientCountChangeCallback(() => notifyClientStatus());

  try {
    await httpServer.start();
    console.error(`[${SERVER_NAME}] HTTP bridge listening on port ${HTTP_PORT}`);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') {
      await killProcessOnPort(HTTP_PORT);
      try {
        await httpServer.start();
        console.error(`[${SERVER_NAME}] HTTP bridge listening on port ${HTTP_PORT} (after retry)`);
      } catch {
        console.error(`[${SERVER_NAME}] ❌ Port ${HTTP_PORT} unavailable. Proxies won't be able to connect.`);
      }
    } else {
      console.error(`[${SERVER_NAME}] Failed to start HTTP bridge:`, error);
    }
  }

  // --- Verify servers started ---
  if (!godotBridge.isListening()) {
    console.error(`[${SERVER_NAME}] ❌ Fatal: WebSocket server failed to start. Godot cannot connect.`);
    httpServer.stop();
    process.exit(1);
  }

  if (!httpServer.isListening()) {
    console.error(`[${SERVER_NAME}] ⚠️  HTTP server failed to start. Proxy clients will not work.`);
  }

  console.error(`[${SERVER_NAME}] Available tools: ${allTools.length + 6}`);
  console.error(`[${SERVER_NAME}] Waiting for Godot editor connection...`);

  // --- Connect stdio MCP transport ---
  const server = createMcpServer(executeToolCall);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] MCP server connected and ready`);

  // --- Shutdown logic ---
  // In primary mode, stdin close does NOT kill the server.
  // The server stays alive for proxy clients and Godot.
  // Only an idle timeout (no Godot + no HTTP activity) triggers shutdown.
  let stdinClosed = false;

  process.stdin.on('close', () => {
    stdinClosed = true;
    directClientConnected = false;
    console.error(`[${SERVER_NAME}] Direct MCP client disconnected (stdin closed)`);
    notifyClientStatus();
    maybeStartIdleShutdown();
  });

  let idleTimer: NodeJS.Timeout | null = null;

  function maybeStartIdleShutdown(): void {
    if (idleTimer) return; // already scheduled
    if (godotBridge?.isConnected()) return;
    if (!stdinClosed) return;

    const msSinceHttpActivity = Date.now() - httpServer.getLastActivityTime();
    if (msSinceHttpActivity < IDLE_TIMEOUT) {
      // HTTP was recently active — schedule re-check for when the idle window expires
      const recheckIn = IDLE_TIMEOUT - msSinceHttpActivity + 500;
      idleTimer = setTimeout(() => {
        idleTimer = null;
        maybeStartIdleShutdown();
      }, recheckIn);
      return;
    }

    console.error(`[${SERVER_NAME}] No active connections, shutting down in ${IDLE_TIMEOUT / 1000}s...`);
    idleTimer = setTimeout(() => {
      // Re-check before actually exiting
      if (godotBridge?.isConnected()) {
        idleTimer = null;
        maybeStartIdleShutdown();
        return;
      }
      const stillHttpIdle = (Date.now() - httpServer.getLastActivityTime()) > IDLE_TIMEOUT;
      if (!stillHttpIdle) {
        idleTimer = null;
        maybeStartIdleShutdown();
        return;
      }
      shutdown();
    }, IDLE_TIMEOUT);
  }

  function cancelIdleShutdown(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
      console.error(`[${SERVER_NAME}] Idle shutdown cancelled — connection active`);
    }
  }

  let isShuttingDown = false;
  function shutdown(): void {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error(`[${SERVER_NAME}] Shutting down...`);
    if (idleTimer) clearTimeout(idleTimer);
    stopVisualizationServer();
    httpServer.stop();
    godotBridge?.stop();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ---------------------------------------------------------------------------
// PROXY MODE
// ---------------------------------------------------------------------------

async function startProxy(): Promise<void> {
  console.error(`[${SERVER_NAME}] Starting in PROXY mode v${SERVER_VERSION} (primary on port ${HTTP_PORT})...`);

  const handleTool: ToolHandler = async (name, args) => {
    try {
      return await proxyToolCall(HTTP_PORT, name, args, TOOL_TIMEOUT);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Failed to reach primary server: ${msg}`,
            hint: 'The primary godot-mcp-server may have shut down. Restart your AI client to spawn a new one.'
          })
        }],
        isError: true
      };
    }
  };

  const server = createMcpServer(handleTool);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] Proxy MCP server connected and ready`);

  await registerProxyClient(HTTP_PORT);

  // In proxy mode, stdin close means our client is gone. Exit cleanly.
  let isShuttingDown = false;
  async function shutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error(`[${SERVER_NAME}] Proxy shutting down...`);
    await unregisterProxyClient(HTTP_PORT);
    process.exit(0);
  }

  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Step 1: Probe for an existing primary server
  const probe = await probeExistingServer(HTTP_PORT);

  if (probe.alive) {
    const localToolCount = allTools.length + 6; // get_godot_status, diagnose_connection, get_guide, list_toolsets, enable_toolset, disable_toolset
    const primaryStale = probe.version !== SERVER_VERSION
      || (probe.toolCount != null && probe.toolCount !== localToolCount);
    if (primaryStale) {
      console.error(`[${SERVER_NAME}] Replacing outdated primary (v${probe.version}, ${probe.toolCount ?? '?'} tools) with v${SERVER_VERSION} (${localToolCount} tools)...`);
      await killProcessOnPort(HTTP_PORT);
      await killProcessOnPort(WEBSOCKET_PORT);
      await new Promise(resolve => setTimeout(resolve, 500));
      return startPrimary();
    }
    console.error(`[${SERVER_NAME}] Found existing primary server (v${probe.version})`);
    return startProxy();
  }

  // Step 2: No primary found — become primary
  return startPrimary();
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, error);
  process.exit(1);
});
