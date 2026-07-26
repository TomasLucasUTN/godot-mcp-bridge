/**
 * End-to-end test that drives a REAL Godot process instead of mocking it.
 *
 * Every other test in this directory exercises the Node-side server in
 * isolation (unit tests calling into GodotBridge / tool handlers directly).
 * None of them ever prove that a tool call actually reaches the Godot
 * editor and mutates a project on disk. This test closes that gap for one
 * representative flow: create a scene, add a node to it, and confirm the
 * .tscn file on disk actually contains that node.
 *
 * Approach: editor-plugin headless, not the runtime autoload.
 * -------------------------------------------------------------------------
 * Editor-only tools like `add_node` and `create_scene` are handled by
 * addons/godot_mcp/tool_executor.gd, which only runs inside the EditorPlugin
 * (addons/godot_mcp/plugin.gd). The runtime autoload (mcp_runtime.gd) only
 * exposes a small "runtime" tool surface (query_runtime_node, send_input,
 * take_screenshot, ...) meant for inspecting a *running game*, not editing
 * scenes on disk — so it can't be used to test add_node.
 *
 * The open question was whether an EditorPlugin can run at all under
 * `--headless`. It can: Godot supports `--headless --editor`, which runs
 * the full editor (including plugin _enter_tree/_enable_plugin) without a
 * display server. This was confirmed manually before writing this test —
 * launching the fixture project with `--headless --editor` produces
 * "[Godot MCP] Plugin loading..." / "[MCP] Connected to server" in stdout.
 * So this test uses that mode directly.
 *
 * The addon's WebSocket client (mcp_client.gd) hardcodes ws://127.0.0.1:6505
 * with no override, so the bridge in this test must also listen on the
 * real DEFAULT_PORT rather than a private test port — that's the one way
 * this test can collide with a real godot-mcp-server already running on
 * this machine. If port 6505 is already taken, the test skips instead of
 * failing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GodotBridge, createBridge } from '../godot-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The full GUI exe, NOT the _console.exe sibling (a broken 0.2MB stub that dies with
// CreateProcess error 193). Set GODOT_BIN to your Godot executable to run this
// suite; without it, existsSync('') is false and everything below skips.
const GODOT_BIN = process.env.GODOT_BIN ?? '';
const FIXTURE_PROJECT = join(__dirname, 'fixtures', 'e2e-project');
const SCENE_PATH = 'res://e2e_test_scene.tscn';
const SCENE_FILE = join(FIXTURE_PROJECT, 'e2e_test_scene.tscn');

const CONNECT_TIMEOUT_MS = 30000;
const BRIDGE_PORT = 6505; // hardcoded in addons/godot_mcp/mcp_client.gd — not configurable

const godotAvailable = existsSync(GODOT_BIN);

/**
 * Port 6505 is hardcoded into the addon and can't be overridden, so if a
 * real godot-mcp-server (e.g. the user's own editor session) already owns
 * it, we can't bind our test bridge there. Rather than fail the suite in
 * that case, we detect it up front and skip with a clear reason.
 */
async function isPortFree(port: number): Promise<boolean> {
  const probe = createBridge(port);
  try {
    await probe.start();
    probe.stop();
    return true;
  } catch {
    return false;
  }
}

const portFree = godotAvailable ? await isPortFree(BRIDGE_PORT) : false;
const canRun = godotAvailable && portFree;

describe.skipIf(!canRun)('E2E — real Godot editor process', () => {
  let bridge: GodotBridge;
  let godotProcess: ChildProcess | null = null;

  beforeAll(async () => {
    if (existsSync(SCENE_FILE)) rmSync(SCENE_FILE);

    bridge = createBridge(BRIDGE_PORT);
    await bridge.start();

    godotProcess = spawn(
      GODOT_BIN,
      ['--headless', '--editor', '--path', FIXTURE_PROJECT],
      { stdio: 'ignore' }
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Godot editor did not connect to the bridge within ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      const check = setInterval(() => {
        if (bridge.isConnected()) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 250);
    });

    // CRITICAL: confirm we're talking to the fixture project and not to
    // somebody's real one.
    //
    // The addon hardcodes port 6505, so ANY Godot editor already open on this
    // machine will reconnect to whatever is listening there — including the
    // bridge this test just started. The isPortFree() check above only proves
    // the port was free when the suite loaded; it cannot stop an existing
    // editor from attaching a moment later. Without this guard the mutation
    // tests below run `create_scene`/`add_node`/`remove_node` against that
    // editor's project. That has actually happened, and it wrote a scene file
    // into a real game project.
    const connectedPath = bridge.getStatus().projectPath ?? '';
    const expected = FIXTURE_PROJECT.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const actual = connectedPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (actual !== expected) {
      throw new Error(
        `Refusing to run: the editor on port ${BRIDGE_PORT} has "${connectedPath}" open, not the test fixture ` +
        `("${FIXTURE_PROJECT}"). Close other Godot editors before running the e2e suite — these tests create and ` +
        `delete scenes in whatever project is connected.`
      );
    }
  }, CONNECT_TIMEOUT_MS + 5000);

  afterAll(() => {
    godotProcess?.kill();
    godotProcess = null;
    bridge?.stop();
    if (existsSync(SCENE_FILE)) rmSync(SCENE_FILE);
  });

  it('connects a real Godot editor over the WebSocket bridge', () => {
    expect(bridge.isConnected()).toBe(true);
  });

  it('creates a scene, adds a node, and persists it to disk', async () => {
    const createResult = await bridge.invokeTool('create_scene', {
      scene_path: SCENE_PATH,
      root_node_type: 'Node2D',
      root_node_name: 'Root',
    }) as Record<string, unknown>;
    expect(createResult.scene_path ?? SCENE_PATH).toBeTruthy();
    expect(existsSync(SCENE_FILE)).toBe(true);

    await bridge.invokeTool('add_node', {
      scene_path: SCENE_PATH,
      node_name: 'E2ESprite',
      node_type: 'Sprite2D',
      parent_path: '.',
    });

    const contents = readFileSync(SCENE_FILE, 'utf-8');
    expect(contents).toContain('E2ESprite');
    expect(contents).toContain('Sprite2D');
  }, 15000);

  it('removes the node it added', async () => {
    const result = await bridge.invokeTool('remove_node', {
      scene_path: SCENE_PATH,
      node_path: 'E2ESprite',
    }) as Record<string, unknown>;
    expect(result).toBeTruthy();

    const contents = readFileSync(SCENE_FILE, 'utf-8');
    expect(contents).not.toContain('E2ESprite');
  }, 15000);
});

describe.skipIf(canRun)('E2E — real Godot editor process (skipped)', () => {
  it('skips: Godot binary missing or port 6505 already in use', () => {
    if (!godotAvailable) {
      console.log(`[e2e-godot] Skipped: Godot binary not found at ${GODOT_BIN}`);
    } else if (!portFree) {
      console.log(`[e2e-godot] Skipped: port ${BRIDGE_PORT} is already in use by another process (likely a real godot-mcp-server).`);
    }
    expect(canRun).toBe(false);
  });
});
