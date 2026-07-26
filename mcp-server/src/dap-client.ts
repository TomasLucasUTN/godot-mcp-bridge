/**
 * DapClient — a minimal Debug Adapter Protocol client for Godot's built-in
 * debug adapter.
 *
 * Godot ships a DAP server in the editor (Editor Settings → Network → Debug
 * Adapter, default port 6006) alongside its GDScript language server on 6005.
 * Both are on by default — the editor prints "Debug adapter server started on
 * port 6006" at startup. Talking to it directly is what lets an agent set a
 * real breakpoint and read actual frame variables instead of inferring state
 * from print() output.
 *
 * This connection does NOT go through the WebSocket bridge in godot-bridge.ts:
 * the adapter is a separate TCP listener owned by the editor, so debugger tools
 * are handled inside the Node server rather than dispatched to the addon.
 *
 * Wire format is the same `Content-Length: <n>\r\n\r\n<json>` framing LSP uses,
 * carrying DAP's seq/type/command envelopes.
 */

import { EventEmitter } from 'node:events';
import { FramedConnection, type FramedMessage } from './framing.js';

export const DEFAULT_DAP_PORT = 6006;

export type DapState = 'disconnected' | 'initialized' | 'running' | 'stopped' | 'terminated';

interface PendingRequest {
  command: string;
  resolve: (body: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class DapError extends Error {
  constructor(public readonly command: string, message: string) {
    super(message);
    this.name = 'DapError';
  }
}

export class DapClient extends EventEmitter {
  private conn: FramedConnection;
  private seq = 1;
  private pending = new Map<number, PendingRequest>();
  /** Breakpoints per source path, kept so they can be re-applied on restart. */
  private breakpoints = new Map<string, { lines: number[]; conditions?: (string | null)[] }>();
  private configured = false;
  private lastStart: { mode: 'launch' | 'attach'; args: Record<string, unknown> } | null = null;

  capabilities: Record<string, unknown> | null = null;
  state: DapState = 'disconnected';
  stoppedThreadId: number | null = null;
  stoppedReason: string | null = null;

  constructor(
    host: string = '127.0.0.1',
    port: number = DEFAULT_DAP_PORT,
    private readonly timeoutMs: number = 20000,
  ) {
    super();
    this.conn = new FramedConnection(
      host,
      port,
      `Godot's debug adapter is not reachable at ${host}:${port}. ` +
      `Open the project in the Godot editor and check Editor Settings → Network → Debug Adapter is enabled.`,
    );
    this.conn.onMessage((msg) => this.handleMessage(msg));
    this.conn.onClose(() => {
      this.configured = false;
      this.state = 'terminated';
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new DapError(p.command, 'Debug adapter connection closed'));
      }
      this.pending.clear();
      this.emit('closed');
    });
  }

  isConnected(): boolean {
    return this.conn.isConnected();
  }

  private handleMessage(msg: FramedMessage): void {
    const type = msg['type'];
    if (type === 'response') {
      const p = this.pending.get(msg['request_seq'] as number);
      if (!p) return;
      this.pending.delete(msg['request_seq'] as number);
      clearTimeout(p.timer);
      if (msg['success']) {
        p.resolve((msg['body'] ?? {}) as Record<string, unknown>);
      } else {
        p.reject(new DapError(String(msg['command'] ?? p.command), String(msg['message'] ?? 'request failed')));
      }
      return;
    }
    if (type === 'event') {
      this.handleEvent(String(msg['event']), (msg['body'] ?? {}) as Record<string, unknown>);
      return;
    }
    if (type === 'request') {
      // Reverse request from the adapter (e.g. runInTerminal). We don't service
      // these, but an unanswered one can stall the adapter, so ack it.
      void this.send({
        seq: this.seq++,
        type: 'response',
        request_seq: msg['seq'],
        success: true,
        command: msg['command'],
      });
    }
  }

  private handleEvent(event: string, body: Record<string, unknown>): void {
    switch (event) {
      case 'initialized':
        this.emit('initialized');
        break;
      case 'stopped':
        this.state = 'stopped';
        this.stoppedThreadId = (body['threadId'] as number) ?? this.stoppedThreadId ?? 1;
        this.stoppedReason = (body['reason'] as string) ?? null;
        this.emit('stopped', body);
        break;
      case 'continued':
        this.state = 'running';
        break;
      case 'terminated':
      case 'exited':
        this.state = 'terminated';
        this.emit('terminated', body);
        break;
      case 'output':
        this.emit('output', body);
        break;
      default:
        break;
    }
  }

  private send(msg: FramedMessage): Promise<void> {
    return this.conn.send(msg);
  }

  request<T extends Record<string, unknown> = Record<string, unknown>>(
    command: string,
    args: unknown = {},
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    const seq = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new DapError(command, `DAP '${command}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(seq, {
        command,
        resolve: resolve as (body: Record<string, unknown>) => void,
        reject,
        timer,
      });
      this.send({ seq, type: 'request', command, arguments: args }).catch((err: Error) => {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(err);
      });
    });
  }

  /**
   * Resolve on the next `stopped`/`terminated` event, or when `waitMs` elapses.
   * Callers MUST create this promise BEFORE sending the request that triggers
   * the event — a breakpoint one line away can fire before an await placed
   * afterwards would have subscribed, and the wait would then hang for nothing.
   */
  private settle(waitMs: number): Promise<{ state: DapState; reason: string | null }> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.removeListener('stopped', done);
        this.removeListener('terminated', done);
        resolve({ state: this.state, reason: this.stoppedReason });
      };
      const timer = setTimeout(done, waitMs);
      this.once('stopped', done);
      this.once('terminated', done);
    });
  }

  private waitForEvent(name: string, waitMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.removeListener(name, done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.once(name, done);
    });
  }

  /** Record breakpoints for a file, applying them now if the session is live. */
  async setBreakpoints(path: string, lines: number[], conditions?: (string | null)[]): Promise<Record<string, unknown>> {
    this.breakpoints.set(path, { lines, conditions });
    if (!this.configured) return { buffered: true, path, lines };
    return this.applyBreakpoints(path);
  }

  private applyBreakpoints(path: string): Promise<Record<string, unknown>> {
    const bp = this.breakpoints.get(path);
    if (!bp) return Promise.resolve({});
    return this.request('setBreakpoints', {
      source: { path },
      breakpoints: bp.lines.map((line, i) => {
        const entry: { line: number; condition?: string } = { line };
        const condition = bp.conditions?.[i];
        if (condition) entry.condition = condition;
        return entry;
      }),
    });
  }

  /**
   * Run the DAP handshake: initialize → launch/attach → breakpoints →
   * configurationDone.
   *
   * The `initialized` EVENT (adapter says "ready for breakpoints") is distinct
   * from the `initialize` RESPONSE, and adapters commonly emit it while the
   * launch request is still outstanding — so launch is fired without awaiting,
   * and its failure is surfaced via the 'error' event instead.
   */
  async start(mode: 'launch' | 'attach', args: Record<string, unknown>): Promise<void> {
    this.lastStart = { mode, args };
    const initialized = this.waitForEvent('initialized', Math.min(this.timeoutMs, 5000));

    this.capabilities = await this.request('initialize', {
      clientID: 'godot-mcp-bridge',
      clientName: 'godot-mcp-bridge',
      adapterID: 'godot',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });
    this.state = 'initialized';

    const startRequest = this.request(mode, args);
    await initialized;
    for (const path of this.breakpoints.keys()) {
      await this.applyBreakpoints(path).catch(() => undefined);
    }
    await this.request('configurationDone', {}).catch(() => undefined);
    this.configured = true;
    this.state = 'running';
    startRequest.catch((err) => this.emit('error', err));
  }

  threadId(): number {
    return this.stoppedThreadId ?? 1;
  }

  /**
   * Issue a resume command (continue/next/stepIn/stepOut) and wait for the
   * program to settle again before returning. Without the wait these return
   * instantly with a stale state and no location, which reads as "the step did
   * nothing". If nothing settles within waitMs (e.g. `continue` with no further
   * breakpoint) it resolves with the current state.
   */
  async resume(command: string, args: Record<string, unknown>, waitMs: number): Promise<{ state: DapState; reason: string | null }> {
    const settled = this.settle(waitMs);
    this.state = 'running';
    await this.request(command, args);
    return settled;
  }

  /** Re-run the last launch/attach, merging any overrides over its args. */
  async restart(overrideArgs: Record<string, unknown> = {}, waitMs = 15000): Promise<{ state: DapState; reason: string | null }> {
    if (!this.lastStart) {
      throw new DapError('restart', 'No debug session to restart — call debug_launch or debug_attach first.');
    }
    const args = { ...this.lastStart.args, ...overrideArgs };
    if (this.capabilities?.['supportsRestartRequest'] === true) {
      const settled = this.settle(waitMs);
      this.state = 'running';
      await this.request('restart', { arguments: args });
      this.lastStart = { ...this.lastStart, args };
      return settled;
    }
    await this.request('terminate', {}).catch(() => undefined);
    await this.start(this.lastStart.mode, args);
    return { state: this.state, reason: this.stoppedReason };
  }

  close(): void {
    this.conn.close();
    this.state = 'disconnected';
    this.configured = false;
    this.breakpoints.clear();
    this.lastStart = null;
  }
}
