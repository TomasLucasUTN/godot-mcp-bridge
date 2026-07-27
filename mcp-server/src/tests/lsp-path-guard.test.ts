import { describe, it, expect } from 'vitest';
import { resolveProjectPath, isInsideProject, summarizeLspCapabilities } from '../lsp-session.js';

/**
 * The gd_* tools read and write files directly from the Node process, outside
 * the addon's GDScript PathGuard. Without an equivalent guard here, `path` is
 * an arbitrary-file read/write primitive — and the README's "every path is
 * guarded against traversal" claim would be false.
 */
const PROJECT = process.platform === 'win32' ? 'C:\\projects\\game' : '/projects/game';

describe('LSP path guard', () => {
  it('accepts a res:// path inside the project', () => {
    const p = resolveProjectPath('res://scenes/player.gd', PROJECT);
    expect(p).toContain('player.gd');
    expect(isInsideProject(p, PROJECT)).toBe(true);
  });

  it('accepts a bare project-relative path', () => {
    const p = resolveProjectPath('scenes/player.gd', PROJECT);
    expect(isInsideProject(p, PROJECT)).toBe(true);
  });

  it('rejects traversal that escapes via res://', () => {
    // A naive "starts with res://" check would let this through.
    expect(() => resolveProjectPath('res://../../secrets.txt', PROJECT)).toThrow(/escapes/i);
  });

  it('rejects bare traversal', () => {
    expect(() => resolveProjectPath('../../../etc/passwd', PROJECT)).toThrow(/escapes/i);
  });

  it('rejects an absolute path outside the project', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd';
    expect(() => resolveProjectPath(outside, PROJECT)).toThrow(/escapes/i);
  });

  it('rejects traversal that only escapes after normalization', () => {
    // Resolves back out of the project despite starting inside it.
    expect(() => resolveProjectPath('res://scenes/../../../outside.gd', PROJECT)).toThrow(/escapes/i);
  });

  it('refuses to work with no known project path', () => {
    expect(() => resolveProjectPath('res://a.gd', null)).toThrow();
    expect(isInsideProject('/anything', null)).toBe(false);
  });

  it('isInsideProject rejects sibling directories with a shared prefix', () => {
    // "/projects/game-backup" must not count as inside "/projects/game".
    const sibling = process.platform === 'win32' ? 'C:\\projects\\game-backup\\x.gd' : '/projects/game-backup/x.gd';
    expect(isInsideProject(sibling, PROJECT)).toBe(false);
  });
});

/**
 * Godot's GDScript language server implements far less than a typical one, which
 * is why only six LSP features are wrapped here. That was verified against
 * `godot_lsp.h` in 4.7 — but it is a fact about one Godot version, and the old
 * gd_lsp_status hardcoded it into an English sentence that would quietly become
 * false the day Godot turned one of those flags on.
 */
describe('summarizeLspCapabilities', () => {
  // What Godot 4.7 actually advertises, per godot_lsp.h.
  const GODOT_47 = {
    definitionProvider: true,
    referencesProvider: true,
    hoverProvider: true,
    documentSymbolProvider: true,
    documentHighlightProvider: true,
    completionProvider: { resolveProvider: true },
    renameProvider: { prepareProvider: true },
    workspaceSymbolProvider: false,
    codeActionProvider: false,
    typeDefinitionProvider: false,
    implementationProvider: false,
    textDocumentSync: 2,
  };

  it('reports every tool as available on Godot 4.7', () => {
    const s = summarizeLspCapabilities(GODOT_47);
    expect(s.tools_unavailable).toEqual([]);
    expect(s.tools_available).toContain('gd_rename');
    expect(s.tools_available).toContain('gd_completion');
  });

  it('does not count a capability advertised as false', () => {
    const s = summarizeLspCapabilities(GODOT_47);
    expect(s.supported_capabilities).not.toContain('workspaceSymbolProvider');
    expect(s.unwrapped_capabilities).not.toContain('codeActionProvider');
  });

  it('flags a capability Godot gains that no tool wraps', () => {
    // The whole point: if a later Godot turns workspace symbols on, say so
    // instead of repeating a hardcoded claim that it does not support them.
    const s = summarizeLspCapabilities({ ...GODOT_47, workspaceSymbolProvider: true });
    expect(s.unwrapped_capabilities).toContain('workspaceSymbolProvider');
    expect(s.note).toContain('no tool here');
  });

  it('ignores non-feature keys so the report is not noise', () => {
    const s = summarizeLspCapabilities(GODOT_47);
    // documentHighlightProvider IS unwrapped and should show; textDocumentSync
    // is a transport detail and should not.
    expect(s.unwrapped_capabilities).toContain('documentHighlightProvider');
    expect(s.unwrapped_capabilities).not.toContain('textDocumentSync');
  });

  it('says so plainly when a tool cannot work on this server', () => {
    const s = summarizeLspCapabilities({ hoverProvider: true });
    expect(s.tools_available).toEqual(['gd_hover']);
    expect(s.tools_unavailable).toContain('gd_definition');
  });

  it('does not claim anything before a handshake', () => {
    expect(summarizeLspCapabilities({}).note).toContain('has not completed a handshake');
  });
});
