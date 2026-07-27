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
        track_type: { type: 'string', enum: ['value', 'position', 'rotation', 'method'], description: 'One of: "value", "position", "rotation", "method"' },
        track_node_path: { type: 'string', description: 'Node path (relative to the AnimationPlayer\'s root node) the track animates' },
        property: { type: 'string', description: 'Property name (required for track_type "value"), e.g. "modulate" or "position:x"' }
      },
      required: ['scene_path', 'node_path', 'animation_name', 'track_type', 'track_node_path']
    }
  },
  {
    name: 'create_sprite_animation',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Build a complete sprite-sheet animation on an AnimationPlayer in ONE call: sets the sheet, its layout, and a keyframe per frame. Replaces the create_animation + add_animation_track + N x set_animation_keyframe sequence (~10 calls per animation). Builds the tracks in the order Godot needs — hframes/vframes BEFORE frame — which is the mistake that makes Godot log 'Index p_frame is out of bounds' every frame when done by hand. For an AnimatedSprite2D use create_sprite_frames instead.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene containing the AnimationPlayer (res://...).' },
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node (default ".").' },
        sprite_path: { type: 'string', description: 'Path to the Sprite2D the animation drives, relative to the scene root.' },
        animation_name: { type: 'string', description: 'Name of the animation to create. Fails if it already exists — tracks cannot be reordered, so rebuilding is the only way to change frame order.' },
        texture: { type: 'string', description: 'Sprite sheet to key on the texture track (res://...). Omit to keep whatever texture the sprite already has.' },
        hframes: { type: 'number', description: 'Columns in the sheet (default 1).' },
        vframes: { type: 'number', description: 'Rows in the sheet (default 1).' },
        frames: { description: 'Frame count (uses 0..n-1) or an explicit array of sheet indices, e.g. [4,5,6,7] for a run cycle inside a shared sheet. Defaults to every frame in the sheet.' },
        fps: { type: 'number', description: 'Frames per second (default 10). Sets the animation length.' },
        loop: { type: 'boolean', description: 'Loop the animation (default true).' }
      },
      required: ['scene_path', 'sprite_path', 'animation_name']
    }
  },
  {
    name: 'create_sprite_frames',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Create the SpriteFrames resource an AnimatedSprite2D needs, slicing one or more sprite sheets into frames. This is the route most Godot tutorials use and there was previously no way to build one at all. Each animation names its sheet, grid and fps; frames become AtlasTextures sharing the source image rather than copies. Assign the result to an AnimatedSprite2D's sprite_frames property.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Where to save the resource (res://something.tres).' },
        animations: {
          type: 'array',
          description: 'One entry per animation: {name, texture, hframes?, vframes?, frames?, fps?, loop?}. `frames` is a count or an array of sheet indices; omit for the whole sheet.',
          items: { type: 'object' }
        }
      },
      required: ['path', 'animations']
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
