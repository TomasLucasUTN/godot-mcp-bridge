/**
 * HTTP client for proxy mode.
 * Communicates with the primary server to forward tool calls and probe health.
 */

import http from 'node:http';

export interface ProbeResult {
  alive: boolean;
  version?: string;
  toolCount?: number;
}

export interface ProxyToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const REQUEST_TIMEOUT = 5000; // 5s for health probes

/**
 * Probe an existing primary server on the given port.
 * Returns { alive: true } if a healthy godot-mcp-bridge responds.
 */
export async function probeExistingServer(port: number): Promise<ProbeResult> {
  try {
    const body = await httpGet(`http://127.0.0.1:${port}/health`, REQUEST_TIMEOUT);
    const data = JSON.parse(body);
    if (data.server === 'godot-mcp-bridge') {
      return { alive: true, version: data.version, toolCount: data.tool_count };
    }
    return { alive: false };
  } catch {
    return { alive: false };
  }
}

/**
 * Identity of this proxy process, stable for its lifetime. The primary keys its
 * client set on this, so repeated registrations are the same client saying it is
 * still alive rather than a new one arriving.
 */
export const PROXY_CLIENT_ID = `proxy-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * How often to re-announce. Comfortably under the primary's 90s TTL, so a
 * missed beat or two does not drop us off the list.
 */
const HEARTBEAT_INTERVAL = 30_000;

let heartbeat: NodeJS.Timeout | null = null;

/**
 * Register this proxy client with the primary and keep re-announcing.
 *
 * The heartbeat is what makes the primary's count self-correcting: the
 * unregister below only runs on a graceful shutdown, so anything harder —
 * SIGKILL, a crash, a host going to sleep — is caught by the entry simply
 * going stale.
 */
export async function registerProxyClient(port: number): Promise<void> {
  await announce(port);

  if (!heartbeat) {
    heartbeat = setInterval(() => { void announce(port); }, HEARTBEAT_INTERVAL);
    // Do not hold the event loop open on our account.
    heartbeat.unref();
  }
}

async function announce(port: number): Promise<void> {
  try {
    await httpPost(
      `http://127.0.0.1:${port}/client/register`,
      JSON.stringify({ client_id: PROXY_CLIENT_ID }),
      REQUEST_TIMEOUT
    );
  } catch {
    // Non-fatal — primary may be gone, or predate this endpoint.
  }
}

/**
 * Unregister this proxy client from the primary and stop the heartbeat.
 */
export async function unregisterProxyClient(port: number): Promise<void> {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  try {
    await httpPost(
      `http://127.0.0.1:${port}/client/unregister`,
      JSON.stringify({ client_id: PROXY_CLIENT_ID }),
      REQUEST_TIMEOUT
    );
  } catch {
    // Non-fatal
  }
}

/**
 * Forward a tool call to the primary server.
 * Timeout is generous because Godot tool execution can be slow.
 */
export async function proxyToolCall(
  port: number,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<ProxyToolResult> {
  const body = JSON.stringify({ name, args });

  const response = await httpPost(
    `http://127.0.0.1:${port}/tool`,
    body,
    timeoutMs + 5000 // extra buffer over the tool timeout
  );

  return JSON.parse(response) as ProxyToolResult;
}

function httpGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

function httpPost(url: string, body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.end(body);
  });
}
