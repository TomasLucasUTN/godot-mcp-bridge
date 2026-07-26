import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createBridge, GodotBridge, normalizeProjectPath, CLOSE_WRONG_PROJECT } from '../godot-bridge.js';

/**
 * The addon dials a fixed port and has no way to tell which server answered, so
 * whichever Godot editor connects first is trusted with every subsequent tool
 * call. That is how the e2e suite once created a scene inside a real game
 * project: the port freed up and an unrelated editor reconnected to the test's
 * bridge.
 *
 * These cover the guard against it: when the server is told which project it
 * belongs to, an editor with anything else open is refused with a distinct
 * close code instead of being handed the editor slot.
 */

// See the port map in primary-http.test.ts before changing this.
const TEST_PORT = 16610;
const SHORT_TIMEOUT = 500;
const PROJECT = 'C:/games/my-project/';
const OTHER_PROJECT = 'C:/games/someone-elses-project/';

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Resolves with the close code once the server hangs up, or 0 if it never does. */
function waitForClose(ws: WebSocket, ms = 1000): Promise<number> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(0), ms);
    ws.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function sendReady(ws: WebSocket, projectPath: string, role: 'editor' | 'runtime' = 'editor') {
  ws.send(JSON.stringify({ type: 'godot_ready', role, project_path: projectPath }));
}

describe('normalizeProjectPath', () => {
  it('makes Windows and POSIX separators compare equal', () => {
    expect(normalizeProjectPath('C:\\games\\proj')).toBe(normalizeProjectPath('C:/games/proj'));
  });

  it('ignores a trailing separator', () => {
    // Godot's globalize_path("res://") returns a trailing slash; a user setting
    // the env var by hand usually won't.
    expect(normalizeProjectPath('C:/games/proj/')).toBe(normalizeProjectPath('C:/games/proj'));
  });

  it('ignores case', () => {
    expect(normalizeProjectPath('C:/Games/Proj')).toBe(normalizeProjectPath('c:/games/proj'));
  });

  it('does not treat a sibling with a shared prefix as equal', () => {
    expect(normalizeProjectPath('C:/games/proj-backup')).not.toBe(normalizeProjectPath('C:/games/proj'));
  });
});

describe('GodotBridge — project binding', () => {
  let bridge: GodotBridge;

  afterEach(() => {
    bridge?.stop();
  });

  it('accepts an editor whose project matches', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, PROJECT);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, PROJECT);
    const code = await waitForClose(ws, 300);

    expect(code).toBe(0); // never closed
    expect(bridge.isConnected()).toBe(true);
    ws.close();
  });

  it('accepts a match that differs only in separators, case and trailing slash', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, 'c:\\games\\my-project');
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, 'C:/games/my-project/');
    const code = await waitForClose(ws, 300);

    expect(code).toBe(0);
    expect(bridge.isConnected()).toBe(true);
    ws.close();
  });

  it('refuses an editor with a different project open', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, PROJECT);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, OTHER_PROJECT);

    expect(await waitForClose(ws)).toBe(CLOSE_WRONG_PROJECT);
  });

  it('releases the editor slot it provisionally gave the rejected socket', async () => {
    // The bridge seats the first connection as editor before godot_ready
    // arrives. If the rejection didn't hand that slot back, one wrong-project
    // editor would lock out the right one for the rest of the process.
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, PROJECT);
    await bridge.start();

    const intruder = await connectClient(TEST_PORT);
    sendReady(intruder, OTHER_PROJECT);
    expect(await waitForClose(intruder)).toBe(CLOSE_WRONG_PROJECT);
    expect(bridge.isConnected()).toBe(false);

    const legit = await connectClient(TEST_PORT);
    sendReady(legit, PROJECT);
    expect(await waitForClose(legit, 300)).toBe(0);
    expect(bridge.isConnected()).toBe(true);
    legit.close();
  });

  it('refuses a runtime helper from a different project too', async () => {
    // The runtime autoload connects separately; a mismatched game would
    // otherwise be able to answer runtime tool calls.
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, PROJECT);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, OTHER_PROJECT, 'runtime');

    expect(await waitForClose(ws)).toBe(CLOSE_WRONG_PROJECT);
  });

  it('accepts any project when no expectation is configured', async () => {
    // Default behaviour must be unchanged: one project, one server, no config.
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, OTHER_PROJECT);

    expect(await waitForClose(ws, 300)).toBe(0);
    expect(bridge.isConnected()).toBe(true);
    ws.close();
  });
});
