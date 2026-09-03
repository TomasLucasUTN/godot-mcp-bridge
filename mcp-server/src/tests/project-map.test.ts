/**
 * map_project's answer used to be the single most expensive thing this server
 * could put in a context window: 151,159 characters on a real project, because
 * every script carries the body of every function it declares. These check
 * that the index keeps what a model needs to navigate and drops what it does
 * not, and that the escape hatch still works.
 */

import { describe, it, expect } from 'vitest';
import { indexScripts, projectMapAnswer, type ProjectMap } from '../project-map.js';

const MAP: ProjectMap = {
  total_scripts: 2,
  total_connections: 3,
  nodes: [
    {
      path: 'res://src/player.gd',
      class_name: 'Player',
      extends: 'CharacterBody2D',
      line_count: 220,
      functions: [
        { name: '_ready', body: 'x'.repeat(4000) },
        { name: '_physics_process', body: 'y'.repeat(4000) },
      ],
      signals: [{ name: 'died' }],
      connections: [{ to: 'hud' }, { to: 'audio' }],
    },
    {
      path: 'res://src/hud.gd',
      class_name: '',
      extends: 'CanvasLayer',
      line_count: 40,
      functions: [],
      signals: [],
      connections: [],
    },
  ],
};

describe('indexScripts', () => {
  it('keeps one line per script with what you navigate by', () => {
    expect(indexScripts(MAP)).toEqual([
      { path: 'res://src/player.gd', class_name: 'Player', extends: 'CharacterBody2D', lines: 220, functions: 2, signals: 1, connections: 2 },
      { path: 'res://src/hud.gd', class_name: null, extends: 'CanvasLayer', lines: 40, functions: 0, signals: 0, connections: 0 },
    ]);
  });

  // The 8,000 characters of function bodies in the fixture are the whole
  // problem in miniature.
  it('drops the function bodies that made the payload huge', () => {
    const json = JSON.stringify(indexScripts(MAP));
    expect(json).not.toContain('xxxx');
    expect(json.length).toBeLessThan(400);
  });

  it('survives a map with no nodes at all', () => {
    expect(indexScripts({})).toEqual([]);
    expect(indexScripts({ nodes: [] })).toEqual([]);
  });
});

describe('projectMapAnswer', () => {
  it('answers with the link and the index, not the map', () => {
    const answer = projectMapAnswer(MAP, 'http://127.0.0.1:6510/x', false);
    expect(answer.visualization_url).toBe('http://127.0.0.1:6510/x');
    expect(answer.total_scripts).toBe(2);
    expect(answer.project_map).toBeUndefined();
    expect(JSON.stringify(answer).length).toBeLessThan(1200);
  });

  it('still returns the whole thing when asked', () => {
    const answer = projectMapAnswer(MAP, 'http://x', true);
    expect(answer.project_map).toBe(MAP);
    // And then says nothing about having trimmed anything.
    expect(answer.note).toBeUndefined();
  });

  it('falls back to counting the nodes when the crawl reports no total', () => {
    const answer = projectMapAnswer({ nodes: MAP.nodes }, 'http://x', false);
    expect(answer.total_scripts).toBe(2);
    expect(answer.total_connections).toBe(0);
  });
});
