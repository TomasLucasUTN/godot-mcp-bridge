/**
 * Debug session handling — the server-side half of the debug_* tools.
 *
 * These tools do not go through the WebSocket bridge to the addon. Godot's
 * debug adapter is its own TCP listener owned by the editor, so the Node server
 * speaks DAP to it directly (see dap-client.ts) and answers the tool call
 * itself. That is also why they work when godotBridge.isConnected() is false:
 * the addon and the adapter are independent.
 *
 * One session at a time, matching the single-editor assumption the rest of the
 * server already makes.
 */

import { DapClient, DEFAULT_DAP_PORT, type DapState } from './dap-client.js';

export const DEBUG_TOOL_NAMES = new Set([
  'debug_launch', 'debug_attach', 'debug_set_breakpoints', 'debug_continue',
  'debug_step', 'debug_stack_trace', 'debug_scopes', 'debug_variables',
  'debug_evaluate', 'debug_status', 'debug_disconnect',
]);

export function isDebugTool(name: string): boolean {
  return DEBUG_TOOL_NAMES.has(name);
}

const DAP_PORT = Number(process.env.GODOT_MCP_DAP_PORT) || DEFAULT_DAP_PORT;
const DEFAULT_WAIT_MS = 8000;

let client: DapClient | null = null;
/** Mirrors what we've registered, so debug_status can report it without the adapter. */
const registeredBreakpoints = new Map<string, number[]>();

function getClient(): DapClient {
  if (!client) {
    client = new DapClient('127.0.0.1', DAP_PORT);
    client.on('error', (err: Error) => {
      console.error(`[godot-mcp-bridge] debug adapter error: ${err.message}`);
    });
  }
  return client;
}

/** DAP wants a filesystem path; agents naturally pass res:// ones. */
function toAdapterPath(path: string, projectPath: string | null): string {
  if (!path.startsWith('res://')) return path;
  if (!projectPath) return path;
  const base = projectPath.replace(/[/\\]+$/, '');
  return `${base}/${path.slice('res://'.length)}`;
}

function stateSummary(c: DapClient): { state: DapState; stopped_reason: string | null; thread_id: number | null } {
  return { state: c.state, stopped_reason: c.stoppedReason, thread_id: c.stoppedThreadId };
}

/**
 * Resolve a frame id, defaulting to the top frame when the caller omits one —
 * "evaluate this where it stopped" is the overwhelmingly common intent, and
 * making every call require a debug_stack_trace round-trip first would double
 * the tool calls for no benefit.
 */
async function resolveFrameId(c: DapClient, frameId: unknown): Promise<number | undefined> {
  if (typeof frameId === 'number') return frameId;
  if (c.state !== 'stopped') return undefined;
  try {
    const body = await c.request('stackTrace', { threadId: c.threadId(), startFrame: 0, levels: 1 });
    const frames = (body['stackFrames'] as Array<Record<string, unknown>>) ?? [];
    return frames.length > 0 ? (frames[0]['id'] as number) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch a variables scope, retrying briefly on the adapter's "unknown" error.
 *
 * Godot fills a frame's variable list asynchronously: `scopes` returns
 * references immediately, but the values arrive from the debuggee a moment
 * later, and a `variables` request that lands first is rejected with a bare
 * "unknown". Measured against Godot 4.7 the second attempt ~500ms later
 * succeeds, so retry rather than surfacing a confusing error for what is just
 * a race.
 */
/**
 * Every name the stopped frame holds, across its scopes — or null when the
 * adapter will not say. Used to tell an unknown identifier apart from a null
 * one, which Godot's adapter reports identically.
 */
async function frameVariableNames(c: DapClient, frameId: number | undefined): Promise<Set<string> | null> {
  try {
    const scopes = await c.request('scopes', { frameId });
    const list = (scopes['scopes'] as Array<Record<string, unknown>>) ?? [];
    const names = new Set<string>();
    for (const scope of list) {
      const ref = Number(scope['variablesReference']);
      if (!Number.isFinite(ref) || ref <= 0) continue;
      // Globals can be enormous and is not where a local typo would live.
      if (String(scope['name']).toLowerCase() === 'globals') continue;
      const body = await requestVariables(c, ref);
      for (const v of ((body['variables'] as Array<Record<string, unknown>>) ?? [])) {
        names.add(String(v['name']));
      }
    }
    return names;
  } catch {
    return null;
  }
}

async function requestVariables(c: DapClient, ref: number): Promise<Record<string, unknown>> {
  const delaysMs = [0, 250, 500, 750];
  let lastError: unknown;
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      return await c.request('variables', { variablesReference: ref });
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      // Only the population race is worth retrying; a genuinely bad reference
      // fails the same way every time and should surface immediately.
      if (!/unknown/i.test(message)) throw err;
    }
  }
  throw lastError;
}

function requireStopped(c: DapClient, tool: string): string | null {
  if (c.state === 'stopped') return null;
  if (c.state === 'disconnected') {
    return `No debug session. Call debug_launch (or debug_attach) first, after setting breakpoints with debug_set_breakpoints.`;
  }
  return `${tool} needs the program paused at a breakpoint; it is currently "${c.state}". Set a breakpoint and let execution reach it, or use debug_status to check.`;
}

export async function handleDebugTool(
  name: string,
  args: Record<string, unknown>,
  projectPath: string | null,
): Promise<Record<string, unknown>> {
  const c = getClient();
  const waitMs = typeof args.wait_ms === 'number' ? args.wait_ms : DEFAULT_WAIT_MS;

  switch (name) {
    case 'debug_status': {
      return {
        adapter_connected: c.isConnected(),
        adapter_port: DAP_PORT,
        ...stateSummary(c),
        breakpoints: Object.fromEntries(registeredBreakpoints),
        hint: c.isConnected()
          ? undefined
          : 'Not connected yet — the adapter is contacted lazily on debug_launch/debug_attach.',
      };
    }

    case 'debug_set_breakpoints': {
      const path = String(args.path ?? '').trim();
      if (!path) return { ok: false, error: "Missing 'path'" };
      const rawLines = Array.isArray(args.lines) ? args.lines : [];
      const lines = rawLines.map((l) => Number(l)).filter((l) => Number.isFinite(l) && l > 0);
      const conditions = Array.isArray(args.conditions)
        ? (args.conditions as (string | null)[])
        : undefined;

      const adapterPath = toAdapterPath(path, projectPath);
      const result = await c.setBreakpoints(adapterPath, lines, conditions);
      if (lines.length > 0) registeredBreakpoints.set(path, lines);
      else registeredBreakpoints.delete(path);

      return {
        path,
        adapter_path: adapterPath,
        lines,
        applied: !result['buffered'],
        // Before a session exists breakpoints are only recorded; they get sent
        // during the debug_launch handshake. Say so rather than implying they
        // are already armed.
        note: result['buffered']
          ? 'Buffered — will be applied when debug_launch starts the session.'
          : undefined,
        adapter_response: result,
      };
    }

    case 'debug_launch': {
      const launchArgs: Record<string, unknown> = {
        project: projectPath ?? undefined,
        stopOnEntry: args.stop_on_entry === true,
        // Godot's adapter reads this key directly and TOGGLES its
        // skip-breakpoints flag when it disagrees with the current editor
        // state: `if ((bool)args["noDebug"] != dbg->is_skip_breakpoints())
        // dbg->debug_skip_breakpoints();`. Omitting it makes the outcome depend
        // on whatever that flag happened to be, which is how a session could
        // launch with breakpoints skipped and never stop at anything.
        noDebug: false,
      };
      if (typeof args.scene === 'string' && args.scene.trim()) launchArgs.scene = args.scene.trim();

      const settled = c.state === 'stopped' || c.state === 'running';
      if (settled) {
        return {
          ok: false,
          error: `A debug session is already active (state "${c.state}"). Call debug_disconnect first, or debug_continue to resume it.`,
        };
      }
      await c.start('launch', launchArgs);
      // start() returns once configured; give the program a moment to hit an
      // early breakpoint so the caller sees "stopped" instead of "running"
      // followed by a surprise stop on the next call.
      const outcome = await Promise.race([
        new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
        new Promise<'stopped'>((resolve) => c.once('stopped', () => resolve('stopped'))),
      ]);
      return {
        launched: true,
        scene: launchArgs.scene ?? '(main scene)',
        ...stateSummary(c),
        hit_breakpoint: outcome === 'stopped',
      };
    }

    case 'debug_attach': {
      await c.start('attach', { project: projectPath ?? undefined, noDebug: false });
      // The adapter can refuse the attach after start() has already returned —
      // "not_running" when there is no game to attach to. Reporting
      // attached:true there claims a session that does not exist.
      const refused = c.takeStartError();
      if (refused) {
        return {
          ok: false,
          error: `The debug adapter refused the attach: ${refused}`,
          hint: refused.includes('not_running')
            ? 'Nothing is running to attach to. Start the game with run_scene, or use debug_launch, which starts it under the debugger itself.'
            : undefined,
          ...stateSummary(c),
        };
      }
      return { attached: true, ...stateSummary(c) };
    }

    case 'debug_continue': {
      const blocked = requireStopped(c, 'debug_continue');
      if (blocked && c.state !== 'running') return { ok: false, error: blocked };
      const r = await c.resume('continue', { threadId: c.threadId() }, waitMs);
      return { resumed: true, state: r.state, stopped_reason: r.reason };
    }

    case 'debug_step': {
      const blocked = requireStopped(c, 'debug_step');
      if (blocked) return { ok: false, error: blocked };
      const mode = String(args.mode ?? 'over');
      const command = mode === 'in' ? 'stepIn' : mode === 'out' ? 'stepOut' : 'next';
      const r = await c.resume(command, { threadId: c.threadId() }, waitMs);
      return { stepped: mode, state: r.state, stopped_reason: r.reason };
    }

    case 'debug_stack_trace': {
      const blocked = requireStopped(c, 'debug_stack_trace');
      if (blocked) return { ok: false, error: blocked };
      const levels = typeof args.levels === 'number' ? args.levels : 20;
      const body = await c.request('stackTrace', { threadId: c.threadId(), startFrame: 0, levels });
      const frames = ((body['stackFrames'] as Array<Record<string, unknown>>) ?? []).map((f) => ({
        id: f['id'],
        name: f['name'],
        line: f['line'],
        column: f['column'],
        source: (f['source'] as Record<string, unknown> | undefined)?.['path'] ?? null,
      }));
      return { frames, frame_count: frames.length, total_frames: body['totalFrames'] ?? frames.length };
    }

    case 'debug_scopes': {
      const blocked = requireStopped(c, 'debug_scopes');
      if (blocked) return { ok: false, error: blocked };
      const frameId = await resolveFrameId(c, args.frame_id);
      if (frameId === undefined) return { ok: false, error: 'Could not resolve a stack frame to inspect.' };
      const body = await c.request('scopes', { frameId });
      const scopes = ((body['scopes'] as Array<Record<string, unknown>>) ?? []).map((s) => ({
        name: s['name'],
        variables_reference: s['variablesReference'],
        expensive: s['expensive'] ?? false,
      }));
      return { frame_id: frameId, scopes };
    }

    case 'debug_variables': {
      const blocked = requireStopped(c, 'debug_variables');
      if (blocked) return { ok: false, error: blocked };
      const ref = Number(args.variables_reference);
      if (!Number.isFinite(ref) || ref <= 0) {
        return { ok: false, error: "'variables_reference' must be a positive number from debug_scopes or a nested variable." };
      }
      let body: Record<string, unknown>;
      try {
        body = await requestVariables(c, ref);
      } catch (err) {
        // The adapter answers a stale or invented reference with a bare
        // "unknown", which tells the caller nothing about what to do next.
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `The debug adapter rejected variables_reference ${ref} (${detail}). References come from debug_scopes and go stale on every step or continue — call debug_scopes again for current ones.`,
        };
      }
      const variables = ((body['variables'] as Array<Record<string, unknown>>) ?? []).map((v) => ({
        name: v['name'],
        value: v['value'],
        type: v['type'] ?? null,
        // Non-zero means this value has children (an object/array) and can be
        // expanded by calling debug_variables again with this reference.
        variables_reference: v['variablesReference'] ?? 0,
      }));
      return { variables_reference: ref, variables, count: variables.length };
    }

    case 'debug_evaluate': {
      const expression = String(args.expression ?? '').trim();
      if (!expression) return { ok: false, error: "Missing 'expression'" };
      const blocked = requireStopped(c, 'debug_evaluate');
      if (blocked) return { ok: false, error: blocked };
      const frameId = await resolveFrameId(c, args.frame_id);
      const context = typeof args.context === 'string' ? args.context : 'watch';
      const body = await c.request('evaluate', { expression, frameId, context });
      const result = body['result'] ?? null;
      const answer: Record<string, unknown> = {
        expression,
        frame_id: frameId ?? null,
        result,
        type: body['type'] ?? null,
        variables_reference: body['variablesReference'] ?? 0,
      };

      // Godot's adapter answers an identifier that does not exist exactly as it
      // answers one holding null: "<null>", reported as success. A caller then
      // reads a typo as a real variable that happens to be null. When the
      // expression is a bare name we can tell the two apart — ask the frame what
      // it actually holds.
      if (String(result) === '<null>' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(expression)) {
        const names = await frameVariableNames(c, frameId);
        if (names !== null && !names.has(expression)) {
          answer['exists'] = false;
          answer['error'] = `Nothing named '${expression}' is in scope here — the adapter reports an unknown identifier as "<null>", the same as a variable holding null.`;
          answer['in_scope'] = [...names].sort();
        } else if (names !== null) {
          answer['exists'] = true;
        }
      }
      return answer;
    }

    case 'debug_disconnect': {
      const terminate = args.terminate === true;
      if (c.isConnected()) {
        await c.request('disconnect', { terminateDebuggee: terminate }).catch(() => undefined);
      }
      c.close();
      client = null;
      registeredBreakpoints.clear();
      return { disconnected: true, terminated_debuggee: terminate };
    }

    default:
      return { ok: false, error: `Unhandled debug tool: ${name}` };
  }
}
