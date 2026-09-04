import { describe, it, expect, vi } from 'vitest';
import { DapClient } from '../dap-client.js';

/**
 * Godot's debug adapter rejects `attach` with "not_running" almost immediately
 * when there is no game to attach to. start() created that request and only
 * attached a .catch to it after three awaits, so the rejection landed with no
 * handler — an unhandled rejection, which ends the Node process. One
 * debug_attach with nothing running took down the whole MCP server: the bridge,
 * every session's connection and the visualizer.
 */
function clientWithStubbedRequests(refuse: (mode: string) => boolean) {
  const client = new DapClient();
  // TS-private only; stubbing it keeps the test off the socket.
  (client as unknown as { request: unknown }).request = vi.fn(
    async (command: string) => {
      if (refuse(command)) throw new Error('not_running');
      return {};
    },
  );
  return client;
}

/**
 * start() waits for the adapter's `initialized` event before configuring. With
 * no real adapter that wait would burn its full timeout in every test, so the
 * event is delivered by hand.
 */
async function start(client: DapClient, mode: 'launch' | 'attach') {
  const started = client.start(mode, {});
  client.emit('initialized');
  await started;
  // An unhandled rejection is reported asynchronously; give it a turn.
  await new Promise((r) => setTimeout(r, 20));
}

describe('DAP start refusal', () => {
  it('does not leave the adapter rejection unhandled', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const client = clientWithStubbedRequests((c) => c === 'attach');
      await start(client, 'attach');
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('reports why the adapter refused', async () => {
    const client = clientWithStubbedRequests((c) => c === 'attach');
    await start(client, 'attach');
    expect(client.takeStartError()).toMatch(/not_running/);
  });

  it('clears the reason once read', async () => {
    const client = clientWithStubbedRequests((c) => c === 'attach');
    await start(client, 'attach');
    client.takeStartError();
    expect(client.takeStartError()).toBeNull();
  });

  it('does not claim a running session after a refusal', async () => {
    const client = clientWithStubbedRequests((c) => c === 'attach');
    await start(client, 'attach');
    expect(client.state).not.toBe('running');
  });

  it('still reaches running when the adapter accepts', async () => {
    const client = clientWithStubbedRequests(() => false);
    await start(client, 'launch');
    expect(client.state).toBe('running');
    expect(client.takeStartError()).toBeNull();
  });
});
