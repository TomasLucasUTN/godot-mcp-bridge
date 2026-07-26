/**
 * Debugger tools for Godot MCP Server
 *
 * These drive Godot's built-in Debug Adapter (DAP) over TCP — a separate
 * listener the editor already runs (default port 6006), NOT the addon's
 * WebSocket bridge. They are handled inside the Node server and work even when
 * a tool call would otherwise say "Godot editor is not connected", because the
 * adapter is reachable as long as the editor is open.
 *
 * The point of these over get_errors / print debugging: stop at the failure and
 * read the actual values in the paused frame, instead of inferring them from
 * log output and re-running.
 */

import type { ToolDefinition } from '../types.js';

export const debugTools: ToolDefinition[] = [
  {
    name: 'debug_launch',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Start a debug session: launch the project (or a specific scene) under Godot\'s debug adapter so breakpoints hit. Set breakpoints FIRST with debug_set_breakpoints — they are buffered and applied during the launch handshake. Returns the session state; if a breakpoint is hit immediately, state is "stopped".',
    inputSchema: {
      type: 'object',
      properties: {
        scene: { type: 'string', description: 'Optional res:// scene to launch. Omit to run the project\'s main scene.' },
        stop_on_entry: { type: 'boolean', description: 'Break on the first line executed (default: false).' },
        wait_ms: { type: 'number', description: 'How long to wait for the program to hit a breakpoint or exit before returning (default: 8000).' }
      }
    }
  },
  {
    name: 'debug_attach',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Attach the debugger to a game instance that is already running (e.g. started earlier with run_scene). Use debug_launch instead when you want the debugger attached from the first frame.',
    inputSchema: {
      type: 'object',
      properties: {
        wait_ms: { type: 'number', description: 'How long to wait for the session to settle before returning (default: 8000).' }
      }
    }
  },
  {
    name: 'debug_set_breakpoints',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Set the breakpoints for ONE script file. This REPLACES every breakpoint previously set in that file (DAP semantics) — pass the complete list you want active, and an empty "lines" array to clear the file. Works before a session exists: breakpoints are buffered and applied when debug_launch runs.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script to break in — a res:// path or an absolute path.' },
        lines: {
          type: 'array',
          items: { type: 'number' },
          description: '1-based line numbers. Empty array clears this file\'s breakpoints.'
        },
        conditions: {
          type: 'array',
          description: 'Optional per-line GDScript condition expressions, positionally aligned to "lines" — use null for lines that should always break (e.g. ["hp < 0", null]). A line with a condition only breaks when that expression evaluates true.'
        }
      },
      required: ['path', 'lines']
    }
  },
  {
    name: 'debug_continue',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Resume a paused program and wait for it to settle again (next breakpoint hit, or exit). If it just keeps running, returns state "running" after wait_ms rather than blocking.',
    inputSchema: {
      type: 'object',
      properties: {
        wait_ms: { type: 'number', description: 'Max time to wait for the next stop before returning (default: 8000).' }
      }
    }
  },
  {
    name: 'debug_step',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Step the paused program one statement and wait for it to stop again. "over" runs a call without descending into it, "in" enters it, "out" runs until the current function returns.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['over', 'in', 'out'], description: 'Default: "over".' },
        wait_ms: { type: 'number', description: 'Max time to wait for the step to land (default: 8000).' }
      }
    }
  },
  {
    name: 'debug_stack_trace',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read the call stack of the paused program: each frame\'s function name, source file, and line. Frame ids from here are what debug_scopes and debug_evaluate take. Only meaningful while stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        levels: { type: 'number', description: 'Max frames to return (default: 20).' }
      }
    }
  },
  {
    name: 'debug_scopes',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List the variable scopes (Locals, Members, Globals) for one stack frame. Each scope carries a variables_reference to pass to debug_variables.',
    inputSchema: {
      type: 'object',
      properties: {
        frame_id: { type: 'number', description: 'Frame id from debug_stack_trace. Defaults to the top frame.' }
      }
    }
  },
  {
    name: 'debug_variables',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read the variables in a scope (or expand a structured value) by its variables_reference, from debug_scopes or a previous debug_variables entry. A returned entry with variables_reference > 0 is itself expandable — call again with that reference to drill in.',
    inputSchema: {
      type: 'object',
      properties: {
        variables_reference: { type: 'number', description: 'Reference from debug_scopes or a nested variable.' }
      },
      required: ['variables_reference']
    }
  },
  {
    name: 'debug_evaluate',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Evaluate a GDScript expression in the context of a paused frame — the debugger equivalent of an immediate window. Reads real values from the live frame. NOTE: an expression that calls a method can mutate game state, so it is not guaranteed side-effect free.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Expression to evaluate, e.g. "player.hp" or "get_tree().get_node_count()".' },
        frame_id: { type: 'number', description: 'Frame id from debug_stack_trace. Defaults to the top frame.' },
        context: { type: 'string', enum: ['watch', 'repl', 'hover'], description: 'Evaluation context hint for the adapter (default: "watch").' }
      },
      required: ['expression']
    }
  },
  {
    name: 'debug_status',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Report the debug session: whether the adapter is connected, the state (running/stopped/terminated), why it stopped, and which breakpoints are registered. Call this first when a debugger tool behaves unexpectedly.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'debug_disconnect',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'End the debug session and drop the adapter connection. Buffered breakpoints are cleared. The running game is left alone unless terminate is true.',
    inputSchema: {
      type: 'object',
      properties: {
        terminate: { type: 'boolean', description: 'Also ask the debuggee to quit (default: false).' }
      }
    }
  }
];
