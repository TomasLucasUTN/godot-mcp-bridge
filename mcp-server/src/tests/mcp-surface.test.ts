/**
 * What a client actually sees when it connects, over the real protocol.
 *
 * Every other test here reaches into a module. This one spawns the built
 * server and speaks MCP to it, because the things it checks only exist at that
 * boundary: a tool's `_meta` has to survive the ListTools handler, an MCP App
 * is only real if `resources/read` serves it under the exact mimeType the spec
 * names, and a tool wired into the registry but not into the handler answers
 * fine in a unit test and 404s in a client.
 *
 * Skipped when dist/ has not been built, the same way the Godot e2e tests skip
 * without a GODOT_BIN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/index.js');
const built = existsSync(DIST);

describe.skipIf(!built)('MCP surface (spawned server)', () => {
  let server: ChildProcessWithoutNullStreams;
  let nextId = 0;
  const waiting = new Map<number, (msg: any) => void>();

  function call(method: string, params: unknown): Promise<any> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
      waiting.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  beforeAll(async () => {
    // Ports of its own: a developer's real server is very likely on the
    // defaults, and this must not fight it for the bridge socket.
    server = spawn('node', [DIST], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GODOT_MCP_PORT: '16599', GODOT_MCP_HTTP_PORT: '16600' },
    });
    let buffer = '';
    server.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let cut: number;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)!(msg); waiting.delete(msg.id); }
        } catch { /* log lines, not protocol */ }
      }
    });
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }, 30000);

  afterAll(() => { server?.kill(); });

  it('offers the small default surface, not all 230', async () => {
    const { result } = await call('tools/list', {});
    // core plus the server's own always-on tools; the number is small on purpose.
    expect(result.tools.length).toBeLessThan(60);
    expect(result.tools.map((t: any) => t.name)).toContain('find_tools');
  });

  it('keeps _meta.ui on the tool that has an app', async () => {
    const { result } = await call('tools/list', {});
    const tool = result.tools.find((t: any) => t.name === 'scene_tree_dump');
    expect(tool._meta.ui.resourceUri).toBe('ui://godot-mcp-bridge/scene-tree');
  });

  it('serves the MCP App under the exact mimeType the spec names', async () => {
    const listed = await call('resources/list', {});
    const app = listed.result.resources.find((r: any) => r.uri === 'ui://godot-mcp-bridge/scene-tree');
    expect(app.mimeType).toBe('text/html;profile=mcp-app');

    const read = await call('resources/read', { uri: 'ui://godot-mcp-bridge/scene-tree' });
    const content = read.result.contents[0];
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    expect(content.text).toContain('parseSceneTreeText');
  });

  it('answers find_tools without an editor connected', async () => {
    const { result } = await call('tools/call', { name: 'find_tools', arguments: { query: 'see collision shapes', limit: 3 } });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.matches.length).toBeGreaterThan(0);
    expect(payload.searched_tools).toBeGreaterThan(200);
    // Each match says which toolset to turn on, which is the point of asking.
    expect(payload.matches[0].toolset).toBeTruthy();
  });
});
