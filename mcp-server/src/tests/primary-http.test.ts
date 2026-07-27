import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { PrimaryHttpServer, type ToolExecutor } from '../primary-http.js';

// This suite burns a fresh port per test (17 and counting), so it owns a whole
// band rather than a single port. Keep the band clear of the fixed ports the
// other suites bind — vitest runs test files in parallel, and an overlap makes
// unrelated suites fail at random rather than failing here.
//
//   16505        godot-bridge.test.ts
//   16510-16599  this file
//   16600        proxy-client.test.ts
//   16610        project-binding.test.ts
//   16620        handshake-auth.test.ts
let nextPort = 16510;
function getPort() { return nextPort++; }

/** Fire an HTTP request and return { status, body }. */
function request(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        : undefined,
    };
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode!,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('PrimaryHttpServer — lifecycle', () => {
  let server: PrimaryHttpServer;
  const noop: ToolExecutor = async () => ({ content: [{ type: 'text', text: 'ok' }] });

  afterEach(() => {
    server?.stop();
  });

  it('isListening() is false before start', () => {
    server = new PrimaryHttpServer(getPort(), '0.0.1-test', noop, 0);
    expect(server.isListening()).toBe(false);
  });

  it('isListening() is true after start', async () => {
    const port = getPort();
    server = new PrimaryHttpServer(port, '0.0.1-test', noop);
    await server.start();
    expect(server.isListening()).toBe(true);
  });

  it('isListening() is false after stop', async () => {
    server = new PrimaryHttpServer(getPort(), '0.0.1-test', noop, 0);
    await server.start();
    server.stop();
    expect(server.isListening()).toBe(false);
  });

  it('stop() is idempotent', async () => {
    server = new PrimaryHttpServer(getPort(), '0.0.1-test', noop, 0);
    await server.start();
    server.stop();
    expect(() => server.stop()).not.toThrow();
  });

  it('proxyClientCount starts at 0', () => {
    server = new PrimaryHttpServer(getPort(), '0.0.1-test', noop, 0);
    expect(server.getProxyClientCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP endpoints
// ---------------------------------------------------------------------------

describe('PrimaryHttpServer — endpoints', () => {
  let server: PrimaryHttpServer;

  afterEach(() => {
    server?.stop();
  });

  it('GET /health returns server info', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const res = await request(port, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.server).toBe('godot-mcp-bridge');
    expect(res.body.version).toBe('1.2.3');
  });

  it('GET /health updates lastActivityTime', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const before = server.getLastActivityTime();
    await new Promise((r) => setTimeout(r, 20));
    await request(port, 'GET', '/health');
    expect(server.getLastActivityTime()).toBeGreaterThan(before);
  });

  it('POST /tool calls the executor and returns result', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async (name, args) => ({
      content: [{ type: 'text', text: JSON.stringify({ name, args }) }],
    }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const res = await request(port, 'POST', '/tool', JSON.stringify({ name: 'read_file', args: { path: '/a.gd' } }));
    expect(res.status).toBe(200);
    expect(executor).toHaveBeenCalledWith('read_file', { path: '/a.gd' });
  });

  it('POST /tool with missing name returns 400', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const res = await request(port, 'POST', '/tool', JSON.stringify({ args: {} }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('POST /tool with no args defaults to empty object', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async (name, args) => ({
      content: [{ type: 'text', text: JSON.stringify({ name, args }) }],
    }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    await request(port, 'POST', '/tool', JSON.stringify({ name: 'some_tool' }));
    expect(executor).toHaveBeenCalledWith('some_tool', {});
  });

  it('POST /client/register counts distinct client ids', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const res1 = await request(port, 'POST', '/client/register', JSON.stringify({ client_id: 'a' }));
    expect(res1.body.proxy_clients).toBe(1);

    const res2 = await request(port, 'POST', '/client/register', JSON.stringify({ client_id: 'b' }));
    expect(res2.body.proxy_clients).toBe(2);

    expect(server.getProxyClientCount()).toBe(2);
  });

  it('re-registering the same id is a heartbeat, not a new client', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const body = JSON.stringify({ client_id: 'a' });
    await request(port, 'POST', '/client/register', body);
    await request(port, 'POST', '/client/register', body);
    const res = await request(port, 'POST', '/client/register', body);

    expect(res.body.proxy_clients).toBe(1);
    expect(server.getProxyClientCount()).toBe(1);
  });

  it('POST /client/unregister drops only that id', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    await request(port, 'POST', '/client/register', JSON.stringify({ client_id: 'a' }));
    await request(port, 'POST', '/client/register', JSON.stringify({ client_id: 'b' }));

    const res = await request(port, 'POST', '/client/unregister', JSON.stringify({ client_id: 'a' }));
    expect(res.body.proxy_clients).toBe(1);
    expect(server.getProxyClientCount()).toBe(1);
  });

  it('unregistering an unknown id is a no-op', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const res = await request(port, 'POST', '/client/unregister', JSON.stringify({ client_id: 'ghost' }));
    expect(res.body.proxy_clients).toBe(0);
    expect(server.getProxyClientCount()).toBe(0);
  });

  // The bug this whole scheme exists for: a client that dies without
  // unregistering used to be counted forever, so the editor toolbar drifted up
  // to "Agents (4)" with one client open.
  it('a client that stops heartbeating expires', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    await request(port, 'POST', '/client/register', JSON.stringify({ client_id: 'a' }));
    expect(server.getProxyClientCount()).toBe(1);

    const realNow = Date.now;
    try {
      const gone = realNow() + PrimaryHttpServer.CLIENT_TTL_MS + 1;
      Date.now = () => gone;
      expect(server.getProxyClientCount()).toBe(0);
    } finally {
      Date.now = realNow;
    }
  });

  it('client count change callback fires on register/unregister', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    const counts: number[] = [];
    server.setClientCountChangeCallback((c) => counts.push(c));
    await server.start();

    await request(port, 'POST', '/client/register', JSON.stringify({ client_id: 'a' }));
    await request(port, 'POST', '/client/register', JSON.stringify({ client_id: 'b' }));
    await request(port, 'POST', '/client/unregister', JSON.stringify({ client_id: 'b' }));

    expect(counts).toEqual([1, 2, 1]);
  });

  it('unknown route returns 404', async () => {
    const port = getPort();
    const executor: ToolExecutor = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    server = new PrimaryHttpServer(port, '1.2.3', executor, 0);
    await server.start();

    const res = await request(port, 'GET', '/nope');
    expect(res.status).toBe(404);
  });

  it('executor error returns 500', async () => {
    const port = getPort();
    const failing: ToolExecutor = async () => { throw new Error('boom'); };
    server = new PrimaryHttpServer(port, '1.2.3', failing, 0);
    await server.start();

    const res = await request(port, 'POST', '/tool', JSON.stringify({ name: 'fail_tool' }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});
