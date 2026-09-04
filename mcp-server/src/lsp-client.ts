/**
 * LspClient — JSON-RPC 2.0 client for Godot's built-in GDScript language server.
 *
 * The editor runs it on port 6005 by default (Editor Settings → Network →
 * Language Server) and prints "GDScript language server started on port 6005"
 * at startup. Like the debug adapter, it is a listener owned by the editor, so
 * these tools are answered inside the Node server rather than dispatched to the
 * addon.
 *
 * Why this matters: the server understands GDScript's actual symbol table.
 * A text search cannot tell a local `speed` from another class's `speed`; the
 * language server can, which is what makes rename and find-references correct
 * rather than approximate.
 *
 * Capabilities are NOT assumed. Godot reports (4.7) support for definition,
 * declaration, references, rename, hover, documentSymbol, completion,
 * signatureHelp and documentHighlight — but NOT workspaceSymbol, codeAction,
 * formatting, foldingRange, implementation or typeDefinition. `supports()`
 * exposes what the connected server actually advertised so tools can refuse
 * cleanly instead of hanging on a request the server will never answer.
 */

import { EventEmitter } from 'node:events';
import { FramedConnection, type FramedMessage } from './framing.js';

export const DEFAULT_LSP_PORT = 6005;

export interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
}

interface Pending {
  method: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class LspError extends Error {
  constructor(public readonly method: string, message: string) {
    super(message);
    this.name = 'LspError';
  }
}

const SEVERITY_NAMES: Record<number, string> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
};

export function severityName(severity: number | undefined): string {
  return severity === undefined ? 'unknown' : (SEVERITY_NAMES[severity] ?? String(severity));
}

export class LspClient extends EventEmitter {
  private conn: FramedConnection;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private initializing: Promise<void> | null = null;
  /** Latest diagnostics per document URI, from publishDiagnostics notifications. */
  private diagnostics = new Map<string, Diagnostic[]>();
  /** Documents we've sent didOpen for, so we only do it once each. */
  /**
   * What we last told the server each document contains. Not a Set: didOpen once
   * and never again left the server on version 1 for the rest of the session, so
   * every later request answered about text that no longer existed on disk — and
   * gd_rename computed its edit ranges from it. Renaming twice in a row turned
   * `keys_counted` into `keys_seented`, silently, in a file that still parsed.
   */
  private openDocuments = new Map<string, { version: number; text: string }>();

  capabilities: Record<string, unknown> = {};

  constructor(
    host = '127.0.0.1',
    port: number = DEFAULT_LSP_PORT,
    private readonly timeoutMs = 15000,
  ) {
    super();
    this.conn = new FramedConnection(
      host,
      port,
      `Godot's GDScript language server is not reachable at ${host}:${port}. ` +
      `Open the project in the Godot editor and check Editor Settings → Network → Language Server is enabled.`,
    );
    this.conn.onMessage((m) => this.handleMessage(m));
    this.conn.onClose(() => {
      this.initialized = false;
      this.initializing = null;
      this.openDocuments.clear();
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new LspError(p.method, 'Language server connection closed'));
      }
      this.pending.clear();
    });
  }

  isConnected(): boolean {
    return this.conn.isConnected();
  }

  /** True when the connected server advertised this capability. */
  supports(capability: string): boolean {
    const value = this.capabilities[capability];
    return value === true || (typeof value === 'object' && value !== null);
  }

  private handleMessage(msg: FramedMessage): void {
    // Response to one of our requests.
    if (msg['id'] !== undefined && (msg['result'] !== undefined || msg['error'] !== undefined)) {
      const p = this.pending.get(msg['id'] as number);
      if (!p) return;
      this.pending.delete(msg['id'] as number);
      clearTimeout(p.timer);
      if (msg['error']) {
        const err = msg['error'] as { message?: string };
        p.reject(new LspError(p.method, err.message ?? 'request failed'));
      } else {
        p.resolve(msg['result']);
      }
      return;
    }

    // Server-initiated notification.
    const method = msg['method'] as string | undefined;
    if (method === 'textDocument/publishDiagnostics') {
      const params = (msg['params'] ?? {}) as { uri?: string; diagnostics?: Diagnostic[] };
      if (params.uri) {
        this.diagnostics.set(params.uri, params.diagnostics ?? []);
        this.emit('diagnostics', params.uri, params.diagnostics ?? []);
      }
    }
  }

  private notify(method: string, params: unknown): Promise<void> {
    return this.conn.send({ jsonrpc: '2.0', method, params });
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LspError(method, `LSP '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.conn.send({ jsonrpc: '2.0', id, method, params }).catch((err: Error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  /** initialize → initialized. Safe to call repeatedly; only the first runs. */
  async ensureInitialized(projectPath: string): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      const result = await this.request<{ capabilities?: Record<string, unknown> }>('initialize', {
        processId: null,
        rootUri: pathToUri(projectPath),
        capabilities: {
          textDocument: {
            synchronization: { didSave: true },
            publishDiagnostics: {},
            hover: { contentFormat: ['plaintext', 'markdown'] },
            completion: { completionItem: { snippetSupport: false } },
          },
        },
      });
      this.capabilities = result?.capabilities ?? {};
      await this.notify('initialized', {});
      this.initialized = true;
    })();

    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  /**
   * Tell the server about a document before querying it. Godot resolves symbols
   * from its own parsed project, but diagnostics are only published for
   * documents the client has opened — so this is what makes gd_diagnostics
   * return anything at all.
   */
  async openDocument(uri: string, text: string): Promise<void> {
    const known = this.openDocuments.get(uri);
    if (known) {
      if (known.text === text) return;
      // Full-content sync: one change covering the whole document. Godot's
      // server accepts it and it cannot drift the way incremental ranges can.
      const version = known.version + 1;
      await this.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      this.openDocuments.set(uri, { version, text });
      // The cached set describes the text we just replaced, and
      // waitForDiagnostics hands back whatever is cached without asking again.
      this.diagnostics.delete(uri);
      return;
    }
    await this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'gdscript', version: 1, text },
    });
    this.openDocuments.set(uri, { version: 1, text });
  }

  getDiagnostics(uri: string): Diagnostic[] | undefined {
    return this.diagnostics.get(uri);
  }

  /**
   * Wait briefly for diagnostics to arrive for a document. They come as an
   * unsolicited notification some time after didOpen, so a caller that reads
   * immediately usually sees nothing.
   */
  waitForDiagnostics(uri: string, waitMs: number): Promise<Diagnostic[]> {
    const existing = this.diagnostics.get(uri);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const done = (publishedUri: string, diags: Diagnostic[]) => {
        if (publishedUri !== uri) return;
        clearTimeout(timer);
        this.removeListener('diagnostics', done);
        resolve(diags);
      };
      const timer = setTimeout(() => {
        this.removeListener('diagnostics', done);
        resolve(this.diagnostics.get(uri) ?? []);
      }, waitMs);
      this.on('diagnostics', done);
    });
  }

  close(): void {
    this.conn.close();
    this.initialized = false;
    this.openDocuments.clear();
    this.diagnostics.clear();
  }
}

/**
 * Absolute filesystem path → `file://` URI, in the percent-encoded form Godot's
 * language server emits and matches against. Windows drive paths need the extra
 * leading slash (`file:///c%3A/...`).
 */
export function pathToUri(absolutePath: string): string {
  let p = absolutePath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  const encoded = p
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `file://${encoded}`;
}

/** `file://` URI → filesystem path. */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  let p = decodeURIComponent(uri.slice('file://'.length));
  // Strip the leading slash Windows drive paths carry: /C:/x → C:/x
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  return p;
}
