/**
 * `Content-Length` message framing, shared by the DAP and LSP clients.
 *
 * Godot serves BOTH its Debug Adapter (port 6006, DAP envelopes) and its
 * GDScript language server (port 6005, JSON-RPC 2.0) over raw TCP using the
 * same header format:
 *
 *   Content-Length: <n>\r\n\r\n<n bytes of UTF-8 JSON>
 *
 * so the transport is written once here rather than twice.
 */

import net from 'node:net';

export type FramedMessage = Record<string, unknown>;

/** Serialize a JSON message as a Content-Length frame. */
export function encodeFrame(msg: FramedMessage): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
    body,
  ]);
}

/**
 * Incremental frame decoder. TCP hands us arbitrary chunk boundaries, so one
 * frame can arrive split across reads and several frames can land in a single
 * read. Invalid or oversized frames fail explicitly so the connection can close
 * and pending protocol requests fail instead of hanging until their timeouts.
 */
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_HEADER_BYTES = 8192;

export class FrameDecoder {
  private header: number[] = [];
  private body: Buffer | null = null;
  private received = 0;
  private readonly utf8 = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly onMessage: (msg: FramedMessage) => void) {}

  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.body === null) {
        this.header.push(chunk[offset++]);
        if (this.header.length > MAX_HEADER_BYTES) throw new Error('Frame header exceeds 8192 bytes');
        const end = this.header.length;
        if (end < 4 || this.header[end - 4] !== 13 || this.header[end - 3] !== 10 ||
            this.header[end - 2] !== 13 || this.header[end - 1] !== 10) continue;
        const lines = Buffer.from(this.header).toString('ascii').split('\r\n');
        const lengths = lines.filter(line => /^content-length:/i.test(line));
        const match = lengths.length === 1 ? /^Content-Length:[ \t]*(\d+)[ \t]*$/i.exec(lengths[0]) : null;
        if (!match) throw new Error('Invalid or duplicate Content-Length header');
        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_FRAME_BYTES) {
          throw new Error('Frame Content-Length must be between 1 and 33554432 bytes');
        }
        this.header = [];
        // Allocate once; fragmented TCP reads must not recopy the entire prefix.
        this.body = Buffer.allocUnsafe(length);
        this.received = 0;
      }
      const count = Math.min(chunk.length - offset, this.body.length - this.received);
      chunk.copy(this.body, this.received, offset, offset + count);
      offset += count;
      this.received += count;
      if (this.received !== this.body.length) continue;
      const body = this.body;
      this.body = null;
      this.received = 0;
      let message: unknown;
      try { message = JSON.parse(this.utf8.decode(body)); }
      catch { throw new Error('Invalid UTF-8 or JSON in protocol frame'); }
      if (message === null || typeof message !== 'object' || Array.isArray(message)) {
        throw new Error('Protocol frame must contain a JSON object');
      }
      this.onMessage(message as FramedMessage);
    }
  }

  reset(): void {
    this.header = [];
    this.body = null;
    this.received = 0;
  }
}

/**
 * Lazily-connected TCP transport with the framing above. Both protocol clients
 * connect on first send and reconnect after a drop.
 */
export class FramedConnection {
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private decoder: FrameDecoder;
  private onMessageCb: (msg: FramedMessage) => void = () => {};
  private onCloseCb: (error?: Error) => void = () => {};

  constructor(
    private readonly host: string,
    private readonly port: number,
    /** Shown when the port isn't listening, to point at the right editor setting. */
    private readonly unavailableHint: string,
  ) {
    this.decoder = new FrameDecoder((m) => this.onMessageCb(m));
  }

  onMessage(cb: (msg: FramedMessage) => void): void {
    this.onMessageCb = cb;
  }

  onClose(cb: (error?: Error) => void): void {
    this.onCloseCb = cb;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === 'open';
  }

  connect(): Promise<net.Socket> {
    if (this.connecting) return this.connecting;
    if (this.isConnected()) return Promise.resolve(this.socket!);

    this.connecting = new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      let connected = false;
      let settled = false;
      const finish = (error?: Error): void => {
        if (!settled) {
          settled = true;
          reject(error ?? new Error('Connection closed before becoming ready'));
        }
        if (this.socket !== socket) return;
        this.socket = null;
        this.connecting = null;
        this.decoder.reset();
        this.onCloseCb(error);
      };
      socket.setNoDelay(true);
      socket.once('connect', () => {
        if (this.socket !== socket || socket.destroyed) {
          finish(new Error('Connection closed before becoming ready'));
          return;
        }
        connected = true;
        settled = true;
        this.connecting = null;
        resolve(socket);
      });
      socket.on('error', error => {
        finish(connected ? error : new Error(`${this.unavailableHint} (${error.message})`));
      });
      socket.on('data', chunk => {
        if (this.socket !== socket) return;
        try { this.decoder.push(chunk); }
        catch (error) { socket.destroy(error instanceof Error ? error : new Error(String(error))); }
      });
      socket.on('close', () => finish());
    });
    return this.connecting;
  }

  async send(msg: FramedMessage): Promise<void> {
    const frame = encodeFrame(msg);
    const socket = await this.connect();
    if (this.socket !== socket || socket.destroyed) throw new Error('Connection closed before send');
    await new Promise<void>((resolve, reject) => {
      socket.write(frame, error => error ? reject(error) : resolve());
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    this.decoder.reset();
    if (socket) {
      socket.destroy();
      this.onCloseCb(new Error('Connection closed by client'));
    }
  }
}
