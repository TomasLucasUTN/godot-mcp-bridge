/**
 * AnimationTree tools for Godot MCP Server
 * Tools for creating and editing AnimationTree state machines
 */

import type { ToolDefinition } from '../types.js';

export const animationTreeTools: ToolDefinition[] = [
  {
    name: 'create_animation_tree',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add an AnimationTree node as a child of a node, with tree_root set to an AnimationNodeStateMachine and active set to true.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        anim_player_path: { type: 'string', description: 'NodePath to the AnimationPlayer, relative to the new AnimationTree node (e.g. "../AnimationPlayer")' },
        node_name: { type: 'string', description: 'Name for the new node (default: "AnimationTree")' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'parent_path', 'anim_player_path']
    }
  },
  {
    name: 'get_animation_tree_structure',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read the states and transitions of an AnimationTree whose tree_root is an AnimationNodeStateMachine.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationTree node' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'add_state_machine_state',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add an AnimationNodeAnimation state to an AnimationTree state machine.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationTree node' },
        state_name: { type: 'string', description: 'Name of the new state' },
        animation_name: { type: 'string', description: 'Name of the animation this state plays' },
        position: { description: 'Vector2 editor position for the state node, e.g. {"x":0,"y":0} (default: {0,0})' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'state_name', 'animation_name']
    }
  },
  {
    name: 'remove_state_machine_state',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Remove a state from an AnimationTree state machine.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationTree node' },
        state_name: { type: 'string', description: 'Name of the state to remove' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'state_name']
    }
  },
  {
    name: 'add_state_machine_transition',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a transition between two states in an AnimationTree state machine.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationTree node' },
        from: { type: 'string', description: 'Name of the source state' },
        to: { type: 'string', description: 'Name of the target state' },
        switch_mode: { type: 'string', enum: ['immediate', 'sync', 'at_end'], description: 'Default: "immediate".' },
        advance_mode: { type: 'string', enum: ['disabled', 'enabled', 'auto'], description: 'Default: "auto" if advance_condition is given, otherwise "enabled".' },
        advance_condition: { type: 'string', description: 'Name of a boolean condition variable to auto-advance on' },
        xfade_time: { type: 'number', description: 'Crossfade duration in seconds' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'from', 'to']
    }
  },
  {
    name: 'remove_state_machine_transition',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Remove a transition between two states in an AnimationTree state machine.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationTree node' },
        from: { type: 'string', description: 'Name of the source state' },
        to: { type: 'string', description: 'Name of the target state' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'from', 'to']
    }
  }
];
