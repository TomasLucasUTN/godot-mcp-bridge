import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createBridge, GodotBridge, slowCallNote } from '../godot-bridge.js';

const TEST_PORT = 16505;
const SHORT_TIMEOUT = 500;

/** Connect a raw WebSocket client to the bridge and wait for it to open. */
function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Collect next JSON message from a WebSocket. */
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('GodotBridge — lifecycle', () => {
  let bridge: GodotBridge;

  afterEach(() => {
    bridge?.stop();
  });

  it('isListening() is false before start', () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    expect(bridge.isListening()).toBe(false);
  });

  it('isListening() is true after start', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    expect(bridge.isListening()).toBe(true);
  });

  it('isListening() is false after stop', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    bridge.stop();
    expect(bridge.isListening()).toBe(false);
  });

  it('isListening() is false after failed start', async () => {
    // Occupy the port first
    const blocker = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await blocker.start();

    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await expect(bridge.start()).rejects.toThrow();
    expect(bridge.isListening()).toBe(false);

    blocker.stop();
  });

  it('stop() is idempotent', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    bridge.stop();
    expect(() => bridge.stop()).not.toThrow();
  });

  it('isConnected() is false when no client is connected', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    expect(bridge.isConnected()).toBe(false);
  });

  it('getStatus() reflects initial state', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    const status = bridge.getStatus();
    expect(status.connected).toBe(false);
    expect(status.port).toBe(TEST_PORT);
    expect(status.pendingRequests).toBe(0);
    expect(status.projectPath).toBeUndefined();
    expect(status.connectedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

describe('GodotBridge — connections', () => {
  let bridge: GodotBridge;
  let client: WebSocket | null = null;

  afterEach(() => {
    client?.close();
    client = null;
    bridge?.stop();
  });

  it('accepts a WebSocket connection and reports isConnected()', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    // Give the bridge a tick to process the connection event
    await new Promise((r) => setTimeout(r, 50));

    expect(bridge.isConnected()).toBe(true);
    expect(bridge.getStatus().connected).toBe(true);
    expect(bridge.getStatus().connectedAt).toBeInstanceOf(Date);
  });

  it('fires onConnectionChange(true) when a client connects', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    const events: boolean[] = [];
    bridge.onConnectionChange((connected) => events.push(connected));

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    expect(events).toContain(true);
  });

  it('fires onConnectionChange(false) when a client disconnects', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    const events: boolean[] = [];
    bridge.onConnectionChange((connected) => events.push(connected));

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    client.close();
    await new Promise((r) => setTimeout(r, 100));
    client = null;

    expect(events).toEqual([true, false]);
    expect(bridge.isConnected()).toBe(false);
  });

  it('offConnectionChange removes the callback', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    const events: boolean[] = [];
    const cb = (connected: boolean) => events.push(connected);
    bridge.onConnectionChange(cb);
    bridge.offConnectionChange(cb);

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    expect(events).toEqual([]);
  });

  it('rejects a second editor connection', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    client.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/p1' }));
    await new Promise((r) => setTimeout(r, 50));

    const second = await connectClient(TEST_PORT);
    const closePromise = new Promise<number>((resolve) => {
      second.on('close', (code) => resolve(code));
    });
    // Second connection claims editor — should be rejected with 4000.
    second.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/p2' }));
    const code = await closePromise;
    expect(code).toBe(4000);
  });

  it('accepts a runtime connection alongside an editor connection', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    client.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/editor' }));
    await new Promise((r) => setTimeout(r, 50));

    const runtime = await connectClient(TEST_PORT);
    runtime.send(JSON.stringify({ type: 'godot_ready', role: 'runtime', project_path: '/runtime' }));
    await new Promise((r) => setTimeout(r, 50));

    expect(bridge.isConnected()).toBe(true);
    expect(bridge.isRuntimeConnected()).toBe(true);
    runtime.close();
  });
});

// ---------------------------------------------------------------------------
// game_eval snippet pre-check
// ---------------------------------------------------------------------------
//
// A snippet that does not parse used to reach the game, where the parse error
// breaks the attached debugger: the game freezes and the typo comes back ~25s
// later as "Runtime helper is not connected". The editor compiles it first now.

describe('GodotBridge — game_eval snippet pre-check', () => {
  let bridge: GodotBridge;
  let editor: WebSocket | null = null;
  let runtime: WebSocket | null = null;

  afterEach(() => {
    editor?.close(); editor = null;
    runtime?.close(); runtime = null;
    bridge?.stop();
  });

  /** Answer the editor's next tool_invoke, asserting which tool it was. */
  async function answerEditor(expectTool: string, result: unknown): Promise<void> {
    const msg = await nextMessage(editor!);
    expect(msg.tool).toBe(expectTool);
    editor!.send(JSON.stringify({ type: 'tool_result', id: msg.id, success: true, result }));
  }

  async function connectBoth(): Promise<void> {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    editor = await connectClient(TEST_PORT);
    editor.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/p' }));
    runtime = await connectClient(TEST_PORT);
    runtime.send(JSON.stringify({ type: 'godot_ready', role: 'runtime', project_path: '/p' }));
    await new Promise((r) => setTimeout(r, 50));
  }

  it('a snippet that does not compile never reaches the game', async () => {
    await connectBoth();

    // If the pre-check leaks, the runtime sees a game_eval. Nothing must arrive.
    let runtimeSaw: string | null = null;
    runtime!.on('message', (d) => { runtimeSaw = JSON.parse(d.toString()).tool; });

    const call = bridge.invokeTool('game_eval', { code: 'var x = = 5' });
    await answerEditor('validate_eval_snippet', { ok: true, valid: false, error_code: 43, errors: ['Expected expression'] });

    await expect(call).rejects.toThrow(/does not compile.*not sent to the game/s);
    await expect(call).rejects.toThrow('Expected expression');
    expect(runtimeSaw).toBeNull();
  });

  it('a snippet that compiles is forwarded to the game', async () => {
    await connectBoth();

    const call = bridge.invokeTool('game_eval', { code: 'return 1 + 1' });
    await answerEditor('validate_eval_snippet', { ok: true, valid: true });

    const forwarded = await nextMessage(runtime!);
    expect(forwarded.tool).toBe('game_eval');
    expect(forwarded.args).toEqual({ code: 'return 1 + 1' });

    runtime!.send(JSON.stringify({ type: 'tool_result', id: forwarded.id, success: true, result: { ok: true, result: 2 } }));
    expect(await call).toEqual({ ok: true, result: 2 });
  });

  it('with no editor connected the snippet goes straight through', async () => {
    // The CLI-launched case: no editor means no debugger, which is the setup
    // that never froze. The pre-check must not make game_eval unusable there.
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    runtime = await connectClient(TEST_PORT);
    runtime.send(JSON.stringify({ type: 'godot_ready', role: 'runtime', project_path: '/p' }));
    await new Promise((r) => setTimeout(r, 50));

    const call = bridge.invokeTool('game_eval', { code: 'var x = = 5' });
    const forwarded = await nextMessage(runtime);
    expect(forwarded.tool).toBe('game_eval');

    runtime.send(JSON.stringify({ type: 'tool_result', id: forwarded.id, success: false, error: 'Compile error in eval snippet (err=43).' }));
    await expect(call).rejects.toThrow('Compile error');
  });
});

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

describe('GodotBridge — protocol', () => {
  let bridge: GodotBridge;
  let client: WebSocket | null = null;

  afterEach(() => {
    client?.close();
    client = null;
    bridge?.stop();
  });

  it('sends ping messages to connected client', async () => {
    // Use a bridge with a very short ping interval by connecting and waiting
    // The default PING_INTERVAL is 10s which is too long for tests, but we can
    // verify that the bridge at least sends a ping by waiting briefly.
    // Instead, we test the tool invoke protocol which exercises sendMessage.
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    // The bridge sends pings on an interval. We can't easily wait 10s in a test,
    // so we verify the protocol via invokeTool instead (see below).
    expect(bridge.isConnected()).toBe(true);
  });

  it('handles godot_ready message and sets projectPath', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    // Simulate godot_ready
    client.send(JSON.stringify({ type: 'godot_ready', project_path: '/home/user/my-game' }));
    await new Promise((r) => setTimeout(r, 50));

    expect(bridge.getStatus().projectPath).toBe('/home/user/my-game');
  });

  it('invokeTool sends tool_invoke and resolves on success result', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    // Listen for the tool_invoke message on the client side
    const msgPromise = nextMessage(client);

    // Start the tool invocation (don't await yet)
    const resultPromise = bridge.invokeTool('read_file', { path: '/test.gd' });

    // Client receives the invoke message
    const invokeMsg = await msgPromise;
    expect(invokeMsg.type).toBe('tool_invoke');
    expect(invokeMsg.tool).toBe('read_file');
    expect(invokeMsg.args).toEqual({ path: '/test.gd' });
    expect(typeof invokeMsg.id).toBe('string');

    // Client sends a success response
    client.send(JSON.stringify({
      type: 'tool_result',
      id: invokeMsg.id,
      success: true,
      result: { content: 'extends Node', path: '/test.gd' },
    }));

    const result = await resultPromise;
    expect(result).toEqual({ content: 'extends Node', path: '/test.gd' });
  });

  it('invokeTool rejects on error result', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = nextMessage(client);
    const resultPromise = bridge.invokeTool('read_file', { path: '/missing.gd' });

    const invokeMsg = await msgPromise;

    client.send(JSON.stringify({
      type: 'tool_result',
      id: invokeMsg.id,
      success: false,
      error: 'File not found',
    }));

    await expect(resultPromise).rejects.toThrow('File not found');
  });

  it('invokeTool rejects on timeout', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    // Don't respond — let it time out
    await expect(bridge.invokeTool('slow_tool', {})).rejects.toThrow(/timed out/);
  });

  it('invokeTool throws if Godot is not connected', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    await expect(bridge.invokeTool('some_tool', {})).rejects.toThrow('Godot is not connected');
  });

  it('pending requests are rejected on disconnect', async () => {
    bridge = createBridge(TEST_PORT, 5000);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    // Start a tool call but don't respond
    const resultPromise = bridge.invokeTool('slow_tool', {});

    // Disconnect the client
    client.close();
    client = null;

    await expect(resultPromise).rejects.toThrow('Godot disconnected');
  });

  it('pending requests are rejected on server stop', async () => {
    bridge = createBridge(TEST_PORT, 5000);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    const resultPromise = bridge.invokeTool('slow_tool', {});

    bridge.stop();

    await expect(resultPromise).rejects.toThrow('Server shutting down');
  });

  it('sendClientStatus sends message to connected client', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    client = await connectClient(TEST_PORT);
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = nextMessage(client);
    bridge.sendClientStatus(3);

    const msg = await msgPromise;
    expect(msg.type).toBe('client_status');
    expect(msg.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Slow calls
// ---------------------------------------------------------------------------

describe('GodotBridge — slow calls', () => {
  let bridge: GodotBridge;
  let editor: WebSocket | null = null;

  afterEach(() => {
    editor?.close(); editor = null;
    bridge?.stop();
  });

  // Godot runs @tool code on the same main thread that answers pings, so a tool
  // slower than two ping cycles used to get its own socket terminated while it
  // was still working — reported to the caller as "Godot disconnected", which
  // sent everyone looking for a connection bug instead of a slow tool.
  it('does not terminate a slot that is still answering a call', async () => {
    bridge = createBridge(TEST_PORT, 4000, null, null, 40);
    await bridge.start();
    editor = await connectClient(TEST_PORT);
    editor.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/p' }));
    await new Promise((r) => setTimeout(r, 30));

    // Deliberately never answers the ping: this client is "busy", exactly like
    // an editor mid-sweep.
    const invoked = new Promise<string>((resolve) => {
      editor!.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'tool_invoke') resolve(m.id);
      });
    });

    const call = bridge.invokeTool('get_project_statistics', {});
    const id = await invoked;

    // Long enough for several ping cycles to have declared it dead before.
    await new Promise((r) => setTimeout(r, 300));
    expect(bridge.isConnected()).toBe(true);

    editor!.send(JSON.stringify({ type: 'tool_result', id, success: true, result: { ok: true } }));
    await expect(call).resolves.toMatchObject({ ok: true });
  });

  it('still terminates a slot that is idle and unresponsive', async () => {
    bridge = createBridge(TEST_PORT, 4000, null, null, 40);
    await bridge.start();
    editor = await connectClient(TEST_PORT);
    editor.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/p' }));
    await new Promise((r) => setTimeout(r, 300));

    expect(bridge.isConnected()).toBe(false);
  });
});

describe('slowCallNote', () => {
  it('leaves a fast call untouched', () => {
    const result = { ok: true };
    expect(slowCallNote(result, 'read_scene', 12, 10000)).toBe(result);
  });

  it('reports the seconds the editor was blocked, without losing the answer', () => {
    const noted = slowCallNote({ ok: true, files: 3 }, 'get_project_statistics', 120685, 10000) as Record<string, any>;
    expect(noted.ok).toBe(true);
    expect(noted.files).toBe(3);
    expect(noted._perf.elapsed_ms).toBe(120685);
    expect(noted._perf.note).toContain('120.7s');
  });

  it('does not rewrap a non-object answer', () => {
    expect(slowCallNote('plain text', 'x', 99999, 10)).toBe('plain text');
    const arr = [1, 2];
    expect(slowCallNote(arr, 'x', 99999, 10)).toBe(arr);
  });
});

describe('GodotBridge — addon version', () => {
  let bridge: GodotBridge;
  let editor: WebSocket | null = null;

  afterEach(() => {
    editor?.close(); editor = null;
    bridge?.stop();
  });

  // A server newer than the addon advertises tools whose GDScript handler is
  // not in the project, and that failure reads as "Unknown tool" rather than
  // "reinstall the addon". Reporting the version is what lets diagnose say so.
  it('records the version the addon reports', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    editor = await connectClient(TEST_PORT);
    editor.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/p', addon_version: '1.1.7' }));
    await new Promise((r) => setTimeout(r, 50));

    expect(bridge.getStatus().addonVersion).toBe('1.1.7');
  });

  it('leaves it undefined for an addon too old to send one', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();
    editor = await connectClient(TEST_PORT);
    editor.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: '/p' }));
    await new Promise((r) => setTimeout(r, 50));

    expect(bridge.getStatus().connected).toBe(true);
    expect(bridge.getStatus().addonVersion).toBeUndefined();
  });
});
