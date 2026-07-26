import { describe, it, expect } from 'vitest';
import { needsConfirmation } from '../index.js';

/**
 * The gate protects operations with no undo path inside the editor. Scene edits
 * are deliberately NOT covered: when the scene is open they go through Godot's
 * undo history, so Ctrl+Z already handles them.
 */
describe('confirmation gate', () => {
  it('is off unless explicitly enabled, so existing callers keep working', () => {
    expect(needsConfirmation('edit_script', {}, false)).toBe(false);
    expect(needsConfirmation('update_project_settings', {}, false)).toBe(false);
  });

  it('blocks irreversible tools when enabled and unconfirmed', () => {
    for (const tool of ['edit_script', 'rename_file', 'update_project_settings', 'setup_autoload']) {
      expect(needsConfirmation(tool, {}, true), `${tool} should be gated`).toBe(true);
    }
  });

  it('lets an explicitly confirmed call through', () => {
    expect(needsConfirmation('edit_script', { confirm: true }, true)).toBe(false);
  });

  it('does not gate reversible tools', () => {
    // These mutate a scene, which is undoable when it's open in the editor.
    for (const tool of ['add_node', 'remove_node', 'set_node_properties', 'create_scene']) {
      expect(needsConfirmation(tool, {}, true), `${tool} should not be gated`).toBe(false);
    }
  });

  it('treats a dry run as its own confirmation step', () => {
    expect(needsConfirmation('rename_symbol_project_wide', { dry_run: true }, true)).toBe(false);
    // ...but the real application still needs confirming.
    expect(needsConfirmation('rename_symbol_project_wide', { dry_run: false }, true)).toBe(true);
  });

  it('gates gd_rename only when it actually writes', () => {
    // Preview mode (no apply) is safe.
    expect(needsConfirmation('gd_rename', {}, true)).toBe(false);
    expect(needsConfirmation('gd_rename', { apply: true }, true)).toBe(true);
    expect(needsConfirmation('gd_rename', { apply: true, confirm: true }, true)).toBe(false);
  });

  it('leaves delete_file to its own long-standing confirm gate', () => {
    // Blocking here too would surface two different confirmation errors for one call.
    expect(needsConfirmation('delete_file', {}, true)).toBe(false);
  });
});
