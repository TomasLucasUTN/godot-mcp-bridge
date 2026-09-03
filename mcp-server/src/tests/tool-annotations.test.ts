/**
 * Annotations are the only thing a client can gate on before calling a tool:
 * some hosts auto-approve readOnlyHint and prompt for destructiveHint. A tool
 * whose name promises one thing and whose hints say another is a safety bug,
 * and with 229 tools it is the kind that arrives quietly, one PR at a time.
 *
 * The exception lists are the point. Each one is a tool whose name matches a
 * pattern but whose hint is deliberately different, with the reason — so a new
 * mismatch fails the build instead of joining them by accident.
 */

import { describe, it, expect } from 'vitest';
import { allTools } from '../tools/index.js';

const READS = /^(get|list|read|find|search|query|dump|inspect|analyze|diagnose|describe|classdb|is_|validate|compare|assert|measure|scene_diff|texture_info)/;
const DESTROYS = /^(delete|remove|clear|reset|stop|kill|disconnect|revert|drop)/;

/** Named readers that legitimately write something. */
const WRITES_ANYWAY = new Set([
  // Writes the diff image it is asked for, and only that.
  'compare_screenshots',
]);

/** Named destroyers that legitimately destroy nothing the user can lose. */
const LOSES_NOTHING = new Set([
  'stop_scene',                // ends a play session
  'stop_input_recording',      // returns the recording it was collecting
  'clear_console_log',         // an editor output buffer, not project data
  'disconnect_signal_runtime', // a live connection, gone on the next run anyway
]);

describe('tool annotations', () => {
  it('every tool declares them', () => {
    const missing = allTools.filter(t => !t.annotations).map(t => t.name);
    expect(missing).toEqual([]);
  });

  it('a tool named like a reader is marked read-only', () => {
    const lying = allTools
      .filter(t => READS.test(t.name) && !WRITES_ANYWAY.has(t.name))
      .filter(t => t.annotations!.readOnlyHint !== true)
      .map(t => t.name);
    expect(lying).toEqual([]);
  });

  it('a tool named like it destroys something says so', () => {
    const lying = allTools
      .filter(t => DESTROYS.test(t.name) && !LOSES_NOTHING.has(t.name))
      .filter(t => t.annotations!.destructiveHint !== true)
      .map(t => t.name);
    expect(lying).toEqual([]);
  });

  it('nothing claims to be read-only and destructive at once', () => {
    const both = allTools
      .filter(t => t.annotations!.readOnlyHint === true && t.annotations!.destructiveHint === true)
      .map(t => t.name);
    expect(both).toEqual([]);
  });

  // An exception that stops being needed is an exception that will mislead
  // whoever reads the list next.
  it('keeps no stale exceptions', () => {
    for (const name of [...WRITES_ANYWAY, ...LOSES_NOTHING]) {
      expect(allTools.some(t => t.name === name), `${name} no longer exists`).toBe(true);
    }
  });
});
