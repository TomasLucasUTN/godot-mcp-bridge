/**
 * HTTP server for primary mode.
 * Allows proxy instances to forward tool calls and check health.
 *
 * Endpoints:
 *   GET  /health             → { server, version, godot_connected }
 *   POST /tool               → { name, args } → MCP-formatted result
 *   POST /client/register    → { client_id } — register/heartbeat a proxy client
 *   POST /client/unregister  → { client_id } — drop a proxy client
 */

import http from 'node:http';

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

const ANONYMOUS_CLIENT_ID = 'anonymous';

export interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<ToolCallResult>;

export class PrimaryHttpServer {
  /**
   * How long a client may go unheard-from before it is presumed gone. Proxies
   * re-register on a shorter interval, so this only expires something that has
   * genuinely stopped running.
   */
  static readonly CLIENT_TTL_MS = 90_000;

  private server: http.Server | null = null;
  private port: number;
  private serverVersion: string;
  private executeToolCall: ToolExecutor;
  private lastActivityTime = Date.now();
  /**
   * Connected proxy clients, by id, with the time each was last heard from.
   *
   * This used to be a bare counter: +1 on register, -1 on unregister. A proxy
   * only unregisters from its own shutdown handler (stdin close, SIGINT,
   * SIGTERM), so anything harder — SIGKILL, a client that force-terminates its
   * MCP servers, a crash, a sleeping machine — skipped it and the primary never
   * found out. The number could only climb, and the editor toolbar ended up
   * advertising "Agents (4)" with one client open.
   *
   * A set with a last-seen stamp cannot leak: an entry nothing has refreshed
   * within CLIENT_TTL_MS is gone, whether or not its process said goodbye.
   */
  private proxyClients = new Map<string, number>();
  private onClientCountChange: ((count: number) => void) | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  private toolCount: number;

  constructor(port: number, version: string, executor: ToolExecutor, toolCount: number) {
    this.port = port;
    this.serverVersion = version;
    this.executeToolCall = executor;
    this.toolCount = toolCount;
  }

  getLastActivityTime(): number {
    return this.lastActivityTime;
  }

  /** Live clients, stale entries dropped first. */
  getProxyClientCount(): number {
    this.reapStaleClients();
    return this.proxyClients.size;
  }

  /**
   * Forget clients nothing has heard from in a while.
   *
   * Called on every register/unregister and on every read of the count, plus
   * from the sweep timer — the last client to die has nobody left to trigger a
   * lazy reap, and the editor's toolbar would otherwise keep advertising it.
   */
  private reapStaleClients(): void {
    const cutoff = Date.now() - PrimaryHttpServer.CLIENT_TTL_MS;
    for (const [id, seen] of this.proxyClients) {
      if (seen < cutoff) this.proxyClients.delete(id);
    }
  }

  /** Record a client as alive right now. Returns the live count. */
  private touchClient(id: string): number {
    this.proxyClients.set(id, Date.now());
    this.reapStaleClients();
    return this.proxyClients.size;
  }

  setClientCountChangeCallback(cb: (count: number) => void): void {
    this.onClientCountChange = cb;
  }

  /** Drop expired clients and report if that changed the count. */
  private sweep(): void {
    const before = this.proxyClients.size;
    this.reapStaleClients();
    if (this.proxyClients.size !== before) {
      this.onClientCountChange?.(this.proxyClients.size);
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        reject(err);
      });

      this.sweepTimer = setInterval(() => this.sweep(), PrimaryHttpServer.CLIENT_TTL_MS / 3);
      this.sweepTimer.unref();

      this.server.listen(this.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  isListening(): boolean {
    return this.server?.listening ?? false;
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Content-Type', 'application/json');

    try {
      if (req.method === 'GET' && req.url === '/health') {
        this.lastActivityTime = Date.now();
        res.writeHead(200);
        res.end(JSON.stringify({
          server: 'godot-mcp-bridge',
          version: this.serverVersion,
          tool_count: this.toolCount,
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/tool') {
        this.lastActivityTime = Date.now();
        const body = await readBody(req);
        const { name, args } = JSON.parse(body);

        if (typeof name !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing or invalid "name" field' }));
          return;
        }

        const result = await this.executeToolCall(name, args || {});
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'POST' && req.url === '/client/register') {
        // Doubles as the heartbeat: a proxy re-posts here periodically, which
        // refreshes its entry. The id keeps that idempotent — re-registering
        // means "still here", not "here is another one".
        const id = clientIdFrom(await readBody(req));
        const count = this.touchClient(id);
        this.onClientCountChange?.(count);
        res.writeHead(200);
        res.end(JSON.stringify({
          proxy_clients: count,
          client_id: id,
          ttl_ms: PrimaryHttpServer.CLIENT_TTL_MS,
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/client/unregister') {
        this.proxyClients.delete(clientIdFrom(await readBody(req)));
        const count = this.getProxyClientCount();
        this.onClientCountChange?.(count);
        res.writeHead(200);
        res.end(JSON.stringify({ proxy_clients: count }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = err instanceof Error && (err as { statusCode?: number }).statusCode || 500;
      console.error(`[primary-http] Request error: ${message}`);
      if (!res.headersSent) {
        res.writeHead(statusCode);
        res.end(JSON.stringify({ error: message }));
      }
    }
  }
}

/**
 * Pull the client id out of a register/unregister body.
 *
 * A proxy from an older build posts an empty body. Those collapse onto one
 * shared id: they never heartbeat either, so their entry expires on the TTL —
 * an old client can be undercounted, but no version of it can inflate the tally.
 */
function clientIdFrom(body: string): string {
  if (!body) return ANONYMOUS_CLIENT_ID;
  try {
    const id = (JSON.parse(body) as { client_id?: unknown }).client_id;
    return typeof id === 'string' && id ? id : ANONYMOUS_CLIENT_ID;
  } catch {
    return ANONYMOUS_CLIENT_ID;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        if (!rejected) {
          rejected = true;
          const err = new Error(`Request body too large (max ${MAX_BODY_SIZE} bytes)`) as Error & { statusCode: number };
          err.statusCode = 413;
          reject(err);
        }
        // Stop buffering further chunks, but don't destroy() the socket —
        // that kills the connection before a proper 413 response can be
        // written. The request stream is left to drain/close naturally
        // once the handler responds and ends res.
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
