import { describe, it, expect, vi } from 'vitest';
import { LspClient } from '../lsp-client.js';

/**
 * The language server is told about a document once, at didOpen. Keeping that
 * as "already open, nothing to do" left the server on version 1 for the whole
 * session, so every later request answered about text that no longer existed on
 * disk — and gd_rename computes its edit RANGES from that text. Renaming a
 * symbol twice in a row wrote `keys_seented`: the second rename's ranges were
 * measured against the pre-first-rename text and applied to the current file.
 * The result still parsed, so validate_scripts called it fine.
 */
function clientWithCapturedNotifications() {
  const client = new LspClient();
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  // TS-private only; patching it here keeps the test off the network.
  (client as unknown as { notify: unknown }).notify = vi.fn(
    async (method: string, params: Record<string, unknown>) => {
      sent.push({ method, params });
    },
  );
  return { client, sent };
}

describe('LSP document sync', () => {
  it('opens a document once', async () => {
    const { client, sent } = clientWithCapturedNotifications();
    await client.openDocument('file:///a.gd', 'extends Node');
    expect(sent.map((s) => s.method)).toEqual(['textDocument/didOpen']);
  });

  it('says nothing when the text has not changed', async () => {
    const { client, sent } = clientWithCapturedNotifications();
    await client.openDocument('file:///a.gd', 'extends Node');
    await client.openDocument('file:///a.gd', 'extends Node');
    expect(sent).toHaveLength(1);
  });

  it('sends the new text when the file changed under it', async () => {
    const { client, sent } = clientWithCapturedNotifications();
    await client.openDocument('file:///a.gd', 'var keys_seen := 0');
    await client.openDocument('file:///a.gd', 'var keys_counted := 0');

    expect(sent.map((s) => s.method)).toEqual([
      'textDocument/didOpen',
      'textDocument/didChange',
    ]);
    const change = sent[1].params as {
      textDocument: { version: number };
      contentChanges: Array<{ text: string }>;
    };
    expect(change.textDocument.version).toBe(2);
    // Full-content sync: one change, whole document, no range.
    expect(change.contentChanges).toEqual([{ text: 'var keys_counted := 0' }]);
  });

  it('keeps incrementing the version across edits', async () => {
    const { client, sent } = clientWithCapturedNotifications();
    await client.openDocument('file:///a.gd', 'one');
    await client.openDocument('file:///a.gd', 'two');
    await client.openDocument('file:///a.gd', 'three');
    const versions = sent.map(
      (s) => (s.params as { textDocument: { version: number } }).textDocument.version,
    );
    expect(versions).toEqual([1, 2, 3]);
  });

  it('tracks each document separately', async () => {
    const { client, sent } = clientWithCapturedNotifications();
    await client.openDocument('file:///a.gd', 'a');
    await client.openDocument('file:///b.gd', 'b');
    expect(sent.map((s) => s.method)).toEqual([
      'textDocument/didOpen',
      'textDocument/didOpen',
    ]);
  });
});
