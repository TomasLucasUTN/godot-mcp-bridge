import { describe, it, expect } from 'vitest';
import { needsConfirmation, initialToolsets, unknownArgumentError } from '../index.js';

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

/**
 * Enabling a toolset mid-session only works if the client re-fetches
 * list_tools. Several clients cache it for the session, and then the agent is
 * stuck: `enable_toolset` tells it to "call list_tools again", which is a client
 * action an agent cannot perform. Measured on a real session — after
 * enable_toolset('runtime') the runtime tools stayed unreachable for good.
 *
 * GODOT_MCP_TOOLSETS sidesteps the refresh: the tools are in the first list.
 */
describe('GODOT_MCP_TOOLSETS', () => {
  it('is core-only when unset, so the default surface stays small', () => {
    expect([...initialToolsets('')]).toEqual(['core']);
    expect([...initialToolsets('   ')]).toEqual(['core']);
  });

  it('adds the toolsets asked for, and always keeps core', () => {
    const s = initialToolsets('runtime,analysis');
    expect(s.has('core')).toBe(true);
    expect(s.has('runtime')).toBe(true);
    expect(s.has('analysis')).toBe(true);
    expect(s.has('debug')).toBe(false);
  });

  it('tolerates whitespace and a trailing comma, which hand-edited config has', () => {
    const s = initialToolsets(' runtime , debug , ');
    expect(s.has('runtime')).toBe(true);
    expect(s.has('debug')).toBe(true);
  });

  it('"all" turns everything on for someone who wants the old behaviour', () => {
    const s = initialToolsets('all');
    expect(s.size).toBeGreaterThan(10);
    expect(s.has('core')).toBe(true);
  });

  it('ignores an unknown name instead of refusing to start', () => {
    // A typo must not stop the server booting — but it must not silently become
    // "no tools" either, which is why the caller logs it.
    const s = initialToolsets('runtime,nonsense');
    expect(s.has('runtime')).toBe(true);
    expect(s.has('nonsense')).toBe(false);
    expect(s.has('core')).toBe(true);
  });
});

/**
 * An argument the schema does not declare used to be dropped, and the call ran
 * with a default. Three real mistakes in one session each surfaced somewhere
 * unrelated because of it — `create_animation({player_path})` complained that
 * the root node was the wrong type, `compare_screenshots({image_a, image_b})`
 * complained about a path guard.
 */
describe('unknown argument rejection', () => {
  const tool = (properties: Record<string, unknown>) =>
    ({ name: 't', description: '', inputSchema: { type: 'object', properties } }) as never;
  const lookup = (properties: Record<string, unknown>) => () => tool(properties);

  it('lets a call with only declared arguments through', () => {
    expect(unknownArgumentError('t', { a: 1 }, lookup({ a: {}, b: {} }))).toBeNull();
  });

  it('refuses an undeclared argument instead of dropping it', () => {
    const r = unknownArgumentError('t', { nope: 1 }, lookup({ a: {} }));
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('nope');
  });

  it('suggests the key the caller probably meant', () => {
    // The real case: compare_screenshots takes baseline/current, not image_a.
    const r = unknownArgumentError('t', { baselin: 'x' }, lookup({ baseline: {}, current: {} }));
    expect(JSON.parse(r!.content[0].text as string).did_you_mean).toEqual({ baselin: 'baseline' });
  });

  it('does not invent a suggestion for something unrelated', () => {
    const r = unknownArgumentError('t', { completely_different: 1 }, lookup({ a: {} }));
    expect(JSON.parse(r!.content[0].text as string).did_you_mean).toBeUndefined();
  });

  it('lists what the tool does accept, so the fix needs no second call', () => {
    const r = unknownArgumentError('t', { x: 1 }, lookup({ baseline: {}, current: {} }));
    expect(JSON.parse(r!.content[0].text as string).accepted_arguments).toEqual(['baseline', 'current']);
  });

  it('always allows confirm, which the gate needs and few schemas declare', () => {
    // Nine tools are gated by GODOT_MCP_REQUIRE_CONFIRM but only delete_file
    // declares `confirm`. Rejecting it would make the gate impossible to satisfy.
    expect(unknownArgumentError('t', { confirm: true }, lookup({ a: {} }))).toBeNull();
  });

  it('stays out of the way when a tool declares no properties', () => {
    expect(unknownArgumentError('t', { anything: 1 }, lookup({}))).toBeNull();
    expect(unknownArgumentError('t', { anything: 1 }, () => undefined)).toBeNull();
  });
});
