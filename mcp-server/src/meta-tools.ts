/**
 * The tools this server answers itself: connection status, the guides, tool
 * search, and the toolset controls.
 *
 * They are not Godot tools and are not in TOOLSETS, but they ride in every
 * tools/list — so anything measuring what a request costs has to count them.
 * They live here rather than inline in the ListTools handler because index.ts
 * starts a server the moment it is imported, which put them out of reach of
 * scripts/measure-tools.mjs: the published number was 8,764 for a surface that
 * actually costs 10,090.
 */
import { allTools, TOOLSETS, TOOLSET_DESCRIPTIONS } from './tools/index.js';
import { GUIDES } from './resources.js';
import type { ToolDefinition } from './types.js';

const OPTIONAL_TOOLSET_NAMES = Object.keys(TOOLSETS).filter((name) => name !== 'core');

/**
 * The tools this server answers itself: connection status, the guides, tool
 * search, and the toolset controls. They are not in TOOLSETS — they are not
 * Godot tools — but they ride in every tools/list, so anything measuring what
 * a request costs has to count them. Keeping them here rather than inline in
 * the handler is what lets scripts/measure-tools.mjs see them.
 */
export function metaTools(): ToolDefinition[] {
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
    description: 'Read a short markdown guide from the server — the same content as the MCP resources, exposed as a tool for clients that do not support them. Call with no args to list them, or with a slug for the full markdown. Worth reading when a workflow is non-obvious: testing a running game, choosing between the scene-editing tools, "Runtime helper not connected".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: {
          type: 'string',
          enum: GUIDES.map((g) => g.slug),
          description: 'Guide to read. Omit to list them.',
        },
      },
      required: [] as string[],
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  };

  const findToolsTool = {
    name: 'find_tools',
    description: `Find a tool by what you want to do, across all ${allTools.length} — including the ones whose toolset is off. Ask "autotile a tilemap" or "record input" and get the matching names, a one-line summary each, and the toolset to enable. Use this when you know what you want to DO but not what it is called; list_toolsets is for browsing.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'What you are trying to do, in your own words (e.g. "bake a navmesh", "read the player position while the game runs").' },
        limit: { type: 'number', description: 'How many matches to return (1-40, default 8).' },
        include_schema: { type: 'boolean', description: "Also return each match's full inputSchema. Default false — the names and summaries are usually enough to pick one." },
      },
      required: ['query'] as string[],
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  };

  const listToolsetsTool = {
    name: 'list_toolsets',
    description: 'List every toolset with what it is for, how many tools it holds, and whether it is enabled. Only "core" is on by default; if the tool you need is not in list_tools, find its toolset here and enable that one.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        include_tools: {
          type: 'boolean',
          description: 'Also list every tool name in each toolset. Off by default: that is ~2,000 tokens, and find_tools answers "what is this called" for a quarter of it.',
        },
      },
      required: [] as string[],
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  };

  const enableToolsetTool = {
    name: 'enable_toolset',
    description: 'Enable an optional toolset so its tools appear in the next list_tools call. "core" (look around, edit scenes/scripts, run the game, read errors) is always on; the rest are opt-in to keep the surface small. Use find_tools or list_toolsets to find which one holds the tool you want.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', enum: ['all', ...OPTIONAL_TOOLSET_NAMES], description: 'Toolset to enable, or "all".' },
      },
      required: ['name'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  };

  const disableToolsetTool = {
    name: 'disable_toolset',
    description: 'Disable a toolset so its tools stop appearing in list_tools. Does not affect tool names already known to the client.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', enum: ['all', ...OPTIONAL_TOOLSET_NAMES], description: 'Toolset to disable, or "all".' },
      },
      required: ['name'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  };

  return [
    connectionStatusTool,
    diagnoseConnectionTool,
    getGuideTool,
    findToolsTool,
    listToolsetsTool,
    enableToolsetTool,
    disableToolsetTool,
  ] as ToolDefinition[];
}
