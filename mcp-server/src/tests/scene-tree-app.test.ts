/**
 * The scene-tree MCP App (SEP-1865).
 *
 * Two things can break it silently. The parser is one: the tool answers with
 * indented text, and a panel that mis-parses it looks empty rather than wrong.
 * The other is the binding — a tool pointing at a `ui://` URI no resource
 * serves renders nothing at all, and nothing in the protocol complains.
 */

import { describe, it, expect } from 'vitest';
import {
  MCP_APP_MIME,
  SCENE_TREE_APP_HTML,
  SCENE_TREE_APP_RESOURCE,
  SCENE_TREE_APP_URI,
  parseSceneTreeText,
} from '../apps/scene-tree-app.js';
import { allTools } from '../tools/index.js';

const SAMPLE = [
  'Level (Node2D) [level_bounds.gd]',
  '  Background (ColorRect)',
  '  Player (CharacterBody2D) [player.gd]',
  '    CollisionShape (CollisionShape2D)',
  '    AttackBox (Area2D)  (+1 descendant node(s), depth-limited)',
  '  HUD (CanvasLayer) [hud.gd]',
].join('\n');

describe('parseSceneTreeText', () => {
  it('nests children by indent', () => {
    const [root] = parseSceneTreeText(SAMPLE);
    expect(root.name).toBe('Level');
    expect(root.children.map(c => c.name)).toEqual(['Background', 'Player', 'HUD']);
    expect(root.children[1].children.map(c => c.name)).toEqual(['CollisionShape', 'AttackBox']);
  });

  it('reads type and script apart', () => {
    const player = parseSceneTreeText(SAMPLE)[0].children[1];
    expect(player.type).toBe('CharacterBody2D');
    expect(player.script).toBe('player.gd');
    expect(player.children[0].script).toBeNull();
  });

  // A depth-limited branch is the case the panel most needs to show honestly:
  // it has children the text does not list.
  it('keeps the hidden-descendant count of a depth-limited branch', () => {
    const attackBox = parseSceneTreeText(SAMPLE)[0].children[1].children[1];
    expect(attackBox.hidden).toBe(1);
    expect(attackBox.children).toEqual([]);
  });

  it('survives a node name with spaces or brackets in it', () => {
    const nodes = parseSceneTreeText('My Node 2 (Node2D)\n  Odd [name] (Sprite2D) [s.gd]');
    expect(nodes[0].name).toBe('My Node 2');
    expect(nodes[0].children[0].name).toBe('Odd [name]');
    expect(nodes[0].children[0].script).toBe('s.gd');
  });

  it('returns nothing for empty or unparsable text rather than throwing', () => {
    expect(parseSceneTreeText('')).toEqual([]);
    expect(parseSceneTreeText('not a tree line at all')).toEqual([]);
  });
});

describe('MCP App wiring', () => {
  it('serves the one mimeType the spec allows', () => {
    expect(SCENE_TREE_APP_RESOURCE.mimeType).toBe('text/html;profile=mcp-app');
    expect(MCP_APP_MIME).toBe('text/html;profile=mcp-app');
  });

  // The whole point of injecting the parser instead of copying it.
  it('ships the real parser inside the page', () => {
    expect(SCENE_TREE_APP_HTML).toContain('function parseSceneTreeText');
    expect(SCENE_TREE_APP_HTML).not.toMatch(/:\s*SceneTreeNode/);
  });

  it('does the host handshake the spec defines', () => {
    expect(SCENE_TREE_APP_HTML).toContain('ui/initialize');
    expect(SCENE_TREE_APP_HTML).toContain('ui/notifications/initialized');
    expect(SCENE_TREE_APP_HTML).toContain('ui/notifications/tool-result');
  });

  it('binds a tool to a resource that is actually served', () => {
    const bound = allTools.filter(t => t._meta?.ui?.resourceUri);
    expect(bound.length).toBeGreaterThan(0);
    for (const tool of bound) {
      expect(tool._meta!.ui!.resourceUri).toBe(SCENE_TREE_APP_URI);
    }
    expect(SCENE_TREE_APP_RESOURCE.uri).toBe(SCENE_TREE_APP_URI);
  });

  it('needs no network grant, so the CSP stays empty', () => {
    expect(SCENE_TREE_APP_RESOURCE._meta.ui.csp.connectDomains).toEqual([]);
    expect(SCENE_TREE_APP_HTML).not.toMatch(/src="https?:/);
  });
});
