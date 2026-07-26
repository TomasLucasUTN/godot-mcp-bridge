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
 * read; this buffers until each body is complete. A header block we can't parse
 * is skipped rather than left to wedge the stream forever.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (msg: FramedMessage) => void) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body) as FramedMessage);
      } catch {
        // A frame we can't parse is dropped; the stream stays in sync because
        // Content-Length already told us exactly how far to skip.
      }
    }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
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
  private onCloseCb: () => void = () => {};

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

  onClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      // These protocols are many small request/response frames; Nagle's
      // algorithm would add latency to every one.
      socket.setNoDelay(true);
      socket.once('connect', () => {
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      });
      socket.once('error', (err) => {
        this.connecting = null;
        reject(new Error(`${this.unavailableHint} (${err.message})`));
      });
      socket.on('data', (chunk) => this.decoder.push(chunk));
      socket.on('close', () => {
        this.socket = null;
        this.decoder.reset();
        this.onCloseCb();
      });
    });
    return this.connecting;
  }

  async send(msg: FramedMessage): Promise<void> {
    const socket = await this.connect();
    socket.write(encodeFrame(msg));
  }

  close(): void {
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }
}
