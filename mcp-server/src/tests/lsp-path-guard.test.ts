import { describe, it, expect } from 'vitest';
import { resolveProjectPath, isInsideProject } from '../lsp-session.js';

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
