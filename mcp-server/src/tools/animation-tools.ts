/**
 * Animation operation tools for Godot MCP Server
 * Tools for reading and editing AnimationPlayer animations
 */

import type { ToolDefinition } from '../types.js';

export const animationTools: ToolDefinition[] = [
  {
    name: 'list_animations',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List animations on an AnimationPlayer node: name, length, loop, track_count.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file (res://path/to/scene.tscn)' },
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'create_animation',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a new empty Animation in the default AnimationLibrary of an AnimationPlayer node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node' },
        animation_name: { type: 'string', description: 'Name for the new animation' },
        length: { type: 'number', description: 'Animation length in seconds (default: 1.0)' },
        loop: { type: 'boolean', description: 'Whether the animation loops (default: false)' }
      },
      required: ['scene_path', 'node_path', 'animation_name']
    }
  },
  {
    name: 'add_animation_track',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a track to an existing animation. For track_type "value", track_node_path is the node whose property is animated and "property" is required; the track path becomes "<track_node_path>:<property>". For "position"/"rotation"/"method", track_node_path is used directly as the track path. NOTE: "position"/"rotation" are the 3D transform track types (require Vector3/Quaternion values) — for 2D nodes (Node2D, Control), use track_type "value" with property "position"/"rotation" instead (accepts Vector2/float).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node' },
        animation_name: { type: 'string', description: 'Animation to add the track to' },
        track_type: { type: 'string', description: 'One of: "value", "position", "rotation", "method"' },
        track_node_path: { type: 'string', description: 'Node path (relative to the AnimationPlayer\'s root node) the track animates' },
        property: { type: 'string', description: 'Property name (required for track_type "value"), e.g. "modulate" or "position:x"' }
      },
      required: ['scene_path', 'node_path', 'animation_name', 'track_type', 'track_node_path']
    }
  },
  {
    name: 'set_animation_keyframe',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Insert a keyframe into an existing track. For a "method" track, value must be {"method": "name", "args": [...]}. For other track types, value is the property value at that time (e.g. {"x":1,"y":2} for a Vector2).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node' },
        animation_name: { type: 'string', description: 'Animation containing the track' },
        track_index: { type: 'number', description: 'Index of the track (from get_animation_info)' },
        time: { type: 'number', description: 'Keyframe time in seconds' },
        value: { description: 'Keyframe value. Shape depends on track type; see description above.' }
      },
      required: ['scene_path', 'node_path', 'animation_name', 'track_index', 'time', 'value']
    }
  },
  {
    name: 'get_animation_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Get full details of an animation: length, loop, and all tracks with their keyframes.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node' },
        animation_name: { type: 'string', description: 'Animation to inspect' }
      },
      required: ['scene_path', 'node_path', 'animation_name']
    }
  },
  {
    name: 'remove_animation',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Remove an animation from the default AnimationLibrary of an AnimationPlayer node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node' },
        animation_name: { type: 'string', description: 'Animation to remove' }
      },
      required: ['scene_path', 'node_path', 'animation_name']
    }
  }
];
