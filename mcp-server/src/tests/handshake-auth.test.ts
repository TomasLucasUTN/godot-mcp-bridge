import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createBridge, GodotBridge, CLOSE_BAD_SECRET, isBrowserOrigin, secretsMatch } from '../godot-bridge.js';

/**
 * Who is allowed to drive the editor.
 *
 * The bridge binds to 127.0.0.1, which keeps remote hosts out but NOT the
 * browser on this machine: a WebSocket handshake is not subject to the
 * same-origin policy, so any page the developer visits while Godot is open
 * could otherwise connect and start issuing tool calls — including writing
 * files into the project and `game_eval`. These cover the two defences:
 *
 *   - Origin rejection, always on, no configuration. Browsers always send the
 *     header; Godot's WebSocketPeer does not.
 *   - An optional shared secret for the case Origin cannot catch — another
 *     native process on the same machine.
 */

// See the port map in primary-http.test.ts before changing this.
const TEST_PORT = 16620;
const SHORT_TIMEOUT = 500;
const SECRET = 'correct-horse-battery-staple';

function connectClient(port: number, options?: { origin?: string }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, options?.origin ? { origin: options.origin } : {});
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

function sendReady(ws: WebSocket, extra: Record<string, unknown> = {}) {
  ws.send(JSON.stringify({ type: 'godot_ready', role: 'editor', project_path: 'C:/games/proj', ...extra }));
}

describe('isBrowserOrigin', () => {
  it('flags a request carrying an Origin header', () => {
    expect(isBrowserOrigin({ origin: 'https://evil.example' })).toBe(true);
  });

  it('ignores an absent or empty Origin', () => {
    expect(isBrowserOrigin({})).toBe(false);
    expect(isBrowserOrigin({ origin: '' })).toBe(false);
  });
});

describe('secretsMatch', () => {
  it('accepts an exact match', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
  });

  it('rejects a different secret of the same length', () => {
    expect(secretsMatch('aaaaaa', 'aaaaab')).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on differing lengths; the wrapper must not.
    expect(() => secretsMatch(SECRET, 'short')).not.toThrow();
    expect(secretsMatch(SECRET, 'short')).toBe(false);
  });

  it('rejects an empty offered secret', () => {
    expect(secretsMatch(SECRET, '')).toBe(false);
  });
});

describe('GodotBridge — browser origin rejection', () => {
  let bridge: GodotBridge;

  afterEach(() => {
    bridge?.stop();
  });

  it('refuses the handshake outright when an Origin header is present', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    // A page at any origin — this is the attack: the developer visits a site
    // while the editor is open and it reaches the bridge.
    await expect(connectClient(TEST_PORT, { origin: 'https://evil.example' })).rejects.toThrow();
    expect(bridge.isConnected()).toBe(false);
  });

  it('still accepts a connection with no Origin (the addon)', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws);

    expect(await waitForClose(ws, 300)).toBe(0);
    expect(bridge.isConnected()).toBe(true);
    ws.close();
  });
});

describe('GodotBridge — shared secret', () => {
  let bridge: GodotBridge;

  afterEach(() => {
    bridge?.stop();
  });

  it('accepts an editor offering the right secret', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, null, SECRET);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, { secret: SECRET });

    expect(await waitForClose(ws, 300)).toBe(0);
    expect(bridge.isConnected()).toBe(true);
    ws.close();
  });

  it('refuses an editor offering the wrong secret', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, null, SECRET);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, { secret: 'wrong' });

    expect(await waitForClose(ws)).toBe(CLOSE_BAD_SECRET);
  });

  it('refuses an editor offering no secret at all', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, null, SECRET);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws);

    expect(await waitForClose(ws)).toBe(CLOSE_BAD_SECRET);
  });

  it('releases the provisional editor slot after refusing', async () => {
    // The bridge seats the first connection as editor before godot_ready
    // arrives. If a rejected socket kept that slot, one bad handshake would
    // lock out the real editor for the rest of the process.
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, null, SECRET);
    await bridge.start();

    const intruder = await connectClient(TEST_PORT);
    sendReady(intruder, { secret: 'wrong' });
    expect(await waitForClose(intruder)).toBe(CLOSE_BAD_SECRET);
    expect(bridge.isConnected()).toBe(false);

    const legit = await connectClient(TEST_PORT);
    sendReady(legit, { secret: SECRET });
    expect(await waitForClose(legit, 300)).toBe(0);
    expect(bridge.isConnected()).toBe(true);
    legit.close();
  });

  it('refuses a runtime helper with the wrong secret too', async () => {
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT, null, SECRET);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    ws.send(JSON.stringify({ type: 'godot_ready', role: 'runtime', project_path: 'C:/games/proj', secret: 'wrong' }));

    expect(await waitForClose(ws)).toBe(CLOSE_BAD_SECRET);
  });

  it('ignores an offered secret when none is configured', async () => {
    // Setting a secret in the editor alone must not lock anyone out: the server
    // decides whether it is checked.
    bridge = createBridge(TEST_PORT, SHORT_TIMEOUT);
    await bridge.start();

    const ws = await connectClient(TEST_PORT);
    sendReady(ws, { secret: 'whatever' });

    expect(await waitForClose(ws, 300)).toBe(0);
    expect(bridge.isConnected()).toBe(true);
    ws.close();
  });
});
