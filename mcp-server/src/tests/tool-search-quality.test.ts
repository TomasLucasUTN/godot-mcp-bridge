/**
 * How good is find_tools, as a number?
 *
 * A search that ranks the wrong tool first is worse than no search: the agent
 * calls it, gets a confusing answer, and blames the tool rather than the
 * lookup. "It feels about right" cannot catch a regression in a scorer, so
 * this is an eval set — real questions phrased the way they get asked, with
 * the tool that actually answers them — and a floor the ranking must clear.
 *
 * The floor is deliberately below the current score. It is a regression net,
 * not a target: tightening it every time the number goes up would make an
 * unrelated tool rename fail the build.
 */

import { describe, it, expect } from 'vitest';
import { searchTools } from '../tool-search.js';
import { allTools } from '../tools/index.js';

/** [what someone would ask, the tool that answers it] */
const EVAL: Array<[string, string]> = [
  ['autotile a tilemap', 'tilemap_autotile'],
  ['take a screenshot of the running game', 'take_screenshot'],
  ['record input and replay it', 'start_input_recording'],
  ['bake a navigation mesh', 'bake_navigation_mesh'],
  ['run a scene', 'run_scene'],
  ['stop the running game', 'stop_scene'],
  ['validate my scripts', 'validate_scripts'],
  ['read a scene file', 'read_scene'],
  ['add a node to a scene', 'add_node'],
  ['rename a node', 'rename_node'],
  ['duplicate a node', 'duplicate_node'],
  ['connect a signal', 'connect_signal'],
  ['attach a script to a node', 'attach_script'],
  ['set the main scene', 'set_main_scene'],
  ['configure the input map', 'configure_input_map'],
  ['find unused resources', 'find_unused_resources'],
  ['detect circular dependencies', 'detect_circular_dependencies'],
  ['compare two screenshots', 'compare_screenshots'],
  ['restart the editor', 'restart_editor'],
  ['export the project', 'export_project'],
  ['set a breakpoint', 'debug_set_breakpoints'],
  ['rename a symbol everywhere', 'rename_symbol_project_wide'],
  ['create a sprite animation', 'create_sprite_animation'],
  ['add an audio player', 'add_audio_player'],
  ['set a shader parameter', 'set_shader_param'],
  ['spawn headless multiplayer peers', 'spawn_headless_peers'],
  ['seed the random number generator', 'seed_rng'],
  ['change the time scale', 'time_scale'],
  ['what is the developer doing in the editor', 'get_editor_activity'],
  ['scaffold a state machine', 'scaffold_state_machine'],
];

function rankOf(query: string, expected: string): number {
  const hits = searchTools(allTools, query, { limit: 10 }).map(h => h.name);
  const at = hits.indexOf(expected);
  return at === -1 ? Infinity : at + 1;   // 1-based; Infinity = not in top 10
}

describe('find_tools ranking quality', () => {
  const ranks = EVAL.map(([q, expected]) => ({ q, expected, rank: rankOf(q, expected) }));
  const top1 = ranks.filter(r => r.rank === 1).length;
  const top3 = ranks.filter(r => r.rank <= 3).length;
  const missed = ranks.filter(r => r.rank === Infinity);

  it('puts the right tool first for most questions', () => {
    const pct = Math.round((top1 / EVAL.length) * 100);
    // Printed so the score is visible in a run rather than only on failure.
    console.log(`find_tools: top-1 ${pct}%, top-3 ${Math.round((top3 / EVAL.length) * 100)}% over ${EVAL.length} questions`);
    const worst = ranks.filter(r => r.rank !== 1).map(r => `${r.q} -> wanted ${r.expected}, rank ${r.rank}`);
    expect(pct, `top-1 ${pct}%. Not first: ${JSON.stringify(worst, null, 1)}`).toBeGreaterThanOrEqual(85);
  });

  it('puts it in the top three nearly always', () => {
    const pct = Math.round((top3 / EVAL.length) * 100);
    expect(pct, `top-3 ${pct}%`).toBeGreaterThanOrEqual(95);
  });

  // Not finding it at all is the failure that matters: a tool ranked third is
  // still a tool the agent can see.
  it('never loses the answer entirely', () => {
    expect(missed.map(m => `${m.q} -> ${m.expected}`)).toEqual([]);
  });
});
