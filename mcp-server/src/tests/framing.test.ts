import { afterEach, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import { encodeFrame, FrameDecoder, FramedConnection, MAX_FRAME_BYTES } from '../framing.js';

describe('protocol framing', () => {
  afterEach(() => vi.restoreAllMocks());
  it('handles bytewise UTF-8 fragments and several frames in one read', () => {
    const messages: unknown[] = [];
    const decoder = new FrameDecoder(message => messages.push(message));
    const first = { id: 1, text: 'á 😀 日本語' };
    for (const byte of encodeFrame(first)) decoder.push(Buffer.from([byte]));
    decoder.push(Buffer.concat([encodeFrame({ id: 2 }), encodeFrame({ id: 3 })]));
    expect(messages).toEqual([first, { id: 2 }, { id: 3 }]);
  });
  it.each(['-1', '1.5', '12junk', 'Infinity', String(MAX_FRAME_BYTES + 1)])('rejects invalid Content-Length %s', length => {
    const decoder = new FrameDecoder(() => {});
    expect(() => decoder.push(Buffer.from(`Content-Length: ${length}\r\n\r\n`))).toThrow(/Content-Length/);
  });
  it('bounds incomplete headers and rejects duplicate lengths', () => {
    const decoder = new FrameDecoder(() => {});
    expect(() => decoder.push(Buffer.from('x'.repeat(8193)))).toThrow(/header/);
    decoder.reset();
    expect(() => decoder.push(Buffer.from('Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}'))).toThrow(/duplicate/);
  });
  it('rejects invalid JSON/UTF-8 and non-object bodies rather than losing a response', () => {
    for (const body of [Buffer.from('null'), Buffer.from('[]'), Buffer.from('{'), Buffer.from([0xff])]) {
      const decoder = new FrameDecoder(() => {});
      expect(() => decoder.push(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))).toThrow();
    }
  });
  it('does not hide an exception in the consumer', () => {
    const decoder = new FrameDecoder(() => { throw new Error('consumer failed'); });
    expect(() => decoder.push(encodeFrame({ id: 1 }))).toThrow('consumer failed');
  });
  it('keeps fragment-copy work linear in the wire size', () => {
    const message = { text: 'x'.repeat(65536) };
    const wire = encodeFrame(message);
    let copied = 0;
    const concat = Buffer.concat;
    const copy = Buffer.prototype.copy;
    vi.spyOn(Buffer, 'concat').mockImplementation((parts, length) => {
      copied += parts.reduce((sum, part) => sum + part.length, 0);
      return concat(parts, length);
    });
    vi.spyOn(Buffer.prototype, 'copy').mockImplementation(function (target, targetStart, sourceStart, sourceEnd) {
      copied += (sourceEnd ?? this.length) - (sourceStart ?? 0);
      return copy.call(this, target, targetStart, sourceStart, sourceEnd);
    });
    const delivered: unknown[] = [];
    const decoder = new FrameDecoder(value => delivered.push(value));
    for (let start = 0; start < wire.length; start += 256) decoder.push(wire.subarray(start, start + 256));
    expect(delivered).toEqual([message]);
    expect(copied).toBeLessThan(wire.length * 2);
  });
});

describe('framed connection lifecycle', () => {
  const peers = new Set<net.Socket>();
  let server: net.Server;
  let connection: FramedConnection;
  afterEach(async () => {
    connection?.close();
    for (const peer of peers) peer.destroy();
    peers.clear();
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  async function listen(): Promise<number> {
    server = net.createServer(socket => { peers.add(socket); socket.on('close', () => peers.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as net.AddressInfo).port;
  }
  it('cancels a connection still being established', async () => {
    connection = new FramedConnection('127.0.0.1', await listen(), 'unavailable');
    const attempt = connection.connect();
    connection.close();
    await expect(attempt).rejects.toThrow(/closed/);
    expect(connection.isConnected()).toBe(false);
  });
  it('can reconnect immediately without an old close event resetting the new socket', async () => {
    connection = new FramedConnection('127.0.0.1', await listen(), 'unavailable');
    await connection.connect();
    connection.close();
    await connection.connect();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(connection.isConnected()).toBe(true);
    await expect(connection.send({ id: 1 })).resolves.toBeUndefined();
  });
  it('closes malformed streams and surfaces their actual error', async () => {
    connection = new FramedConnection('127.0.0.1', await listen(), 'unavailable');
    const closed = new Promise<Error | undefined>(resolve => connection.onClose(resolve));
    await connection.connect();
    for (const peer of peers) peer.write('Content-Length: -1\r\n\r\n');
    expect((await closed)?.message).toMatch(/Content-Length/);
    expect(connection.isConnected()).toBe(false);
  });
});
