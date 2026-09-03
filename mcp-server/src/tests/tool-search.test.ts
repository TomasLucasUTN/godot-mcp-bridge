/**
 * find_tools is the way back from a small default tool surface: 229 tools
 * exist, 38 are loaded, and an agent that cannot see the other 191 needs a way
 * to ask for one by what it does. A search that ranks the wrong tool first is
 * worse than none, so the ranking is what these check.
 */

import { describe, it, expect } from 'vitest';
import { searchTools } from '../tool-search.js';
import { allTools } from '../tools/index.js';

describe('searchTools', () => {
  it('puts the tool whose name says it first', () => {
    const [top] = searchTools(allTools, 'autotile tilemap');
    expect(top.name).toBe('tilemap_autotile');
  });

  it('finds a tool by what it does, not by its name', () => {
    const names = searchTools(allTools, 'screenshot', { limit: 10 }).map(h => h.name);
    expect(names).toContain('take_screenshot');
  });

  // Ranked, not filtered: a real question ("see collision shapes") always has
  // a word the right tool never uses, and an AND rule answered those with
  // nothing at all. Covering more of the question is what wins instead.
  it('ranks the tool that covers more of the question higher', () => {
    const names = searchTools(allTools, 'validate script', { limit: 20 }).map(h => h.name);
    // Both the one-file and the many-file validator are right answers; what
    // matters is that they beat a tool sharing only one word.
    expect(names[0]).toMatch(/^validate_scripts?$/);
    expect(names.slice(0, 2).sort()).toEqual(['validate_script', 'validate_scripts']);
  });

  it('still answers a question worded as a sentence', () => {
    for (const query of ['see collision shapes', 'record input and replay it', 'why is my sprite floating']) {
      expect(searchTools(allTools, query, { limit: 5 }).length).toBeGreaterThan(0);
    }
  });

  it('an exact tool name outranks everything', () => {
    const [top] = searchTools(allTools, 'run_scene');
    expect(top.name).toBe('run_scene');
  });

  it('reports which of the matches are not currently loaded', () => {
    const enabled = new Set(['take_screenshot']);
    const hits = searchTools(allTools, 'screenshot', { limit: 10, enabledNames: enabled });
    expect(hits.find(h => h.name === 'take_screenshot')?.enabled).toBe(true);
    expect(hits.some(h => !h.enabled)).toBe(true);
  });

  it('returns schemas only when asked, since that is the token cost being avoided', () => {
    expect(searchTools(allTools, 'run_scene')[0].inputSchema).toBeUndefined();
    expect(searchTools(allTools, 'run_scene', { includeSchema: true })[0].inputSchema).toBeDefined();
  });

  it('summarises rather than pasting a whole description', () => {
    for (const hit of searchTools(allTools, 'tilemap', { limit: 20 })) {
      expect(hit.summary.length).toBeLessThanOrEqual(161);
    }
  });

  // Words this domain repeats everywhere ("scene", "node", "godot") cannot
  // separate one tool from another, so a query made only of them matches
  // nothing rather than returning an arbitrary eight.
  it('answers nothing for a query that is only noise words', () => {
    expect(searchTools(allTools, 'how do I do the scene node in godot')).toEqual([]);
  });

  it('caps the result count', () => {
    expect(searchTools(allTools, 'physics', { limit: 3 }).length).toBeLessThanOrEqual(3);
  });
});
