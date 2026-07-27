/**
 * Physics setup tools for Godot MCP Server
 * Tools for adding raycasts and collision shapes to physics nodes
 */

import type { ToolDefinition } from '../types.js';

export const physicsTools: ToolDefinition[] = [
  {
    name: 'add_raycast',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a RayCast2D or RayCast3D as a child of a node, with an optional target_position.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file (res://path/to/scene.tscn)' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        node_name: { type: 'string', description: 'Name for the new node (default: "RayCast2D"/"RayCast3D")' },
        dimension: { type: 'string', enum: ['2D', '3D'], description: 'Default: "2D".' },
        target_position: {
          type: 'object',
          description: 'Ray target relative to the raycast origin: {x,y} for 2D or {x,y,z} for 3D'
        },
        enabled: { type: 'boolean', description: 'Whether the raycast is enabled (default: true)' }
      },
      required: ['scene_path', 'parent_path']
    }
  },
  {
    name: 'setup_collision',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a CollisionShape2D/3D child with a basic shape to a physics node (CharacterBody2D/3D, RigidBody2D/3D, StaticBody2D/3D, Area2D/3D).',
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'object', description: "Where the shape sits relative to the body origin, e.g. {x:0,y:-23}. Default for a 2D body: the shape sits ON the origin (origin = the feet), so position places the character on the ground. Pass {x:0,y:0} to centre it on the origin instead." },
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the physics body/area node' },
        shape_type: { type: 'string', enum: ['rectangle', 'circle', 'box', 'sphere'], description: '"rectangle" or "circle" for 2D nodes; "box" or "sphere" for 3D nodes.' },
        size: {
          description: 'Shape size: {x,y} for rectangle, a number (radius) for circle/sphere, {x,y,z} for box'
        },
        node_name: { type: 'string', description: 'Name for the new CollisionShape node (default: "CollisionShape")' }
      },
      required: ['scene_path', 'node_path', 'shape_type']
    }
  },
  {
    name: 'set_physics_layers',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set collision_layer and/or collision_mask on a physics body/area node. Each can be given as a raw bitmask int, an array of 1-based layer indices (1..32), or an array of layer NAMES defined in Project Settings (e.g. ["player","world"]). Names are resolved against the node\'s 2D/3D physics dimension; an unknown name returns an error listing the defined names. e.g. [1,3] or ["player","enemy"].',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the physics body/area node' },
        collision_layer: { description: 'Raw bitmask int, or array of 1-based layer indices (1..32) / layer names' },
        collision_mask: { description: 'Raw bitmask int, or array of 1-based layer indices (1..32) / layer names' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'get_collision_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read collision_layer/collision_mask (as raw int and decoded 1-based layer indices) plus any CollisionShape2D/3D children on a physics body/area node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the physics body/area node' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'set_collision_preset',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Define or update a named, reusable collision_layer/collision_mask combo (e.g. "Player", "Enemy", "Hazard"), persisted per-project. Apply it to nodes later with apply_collision_preset instead of re-toggling bits each time.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Preset name, e.g. "Player"' },
        collision_layer: { description: 'Raw bitmask int, or array of 1-based layer indices (1..32)' },
        collision_mask: { description: 'Raw bitmask int, or array of 1-based layer indices (1..32)' }
      },
      required: ['name']
    }
  },
  {
    name: 'get_collision_presets',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List all collision presets defined in this project via set_collision_preset.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'apply_collision_preset',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Apply a previously-defined collision preset (set_collision_preset) to a physics body/area node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the physics body/area node' },
        name: { type: 'string', description: 'Preset name to apply' }
      },
      required: ['scene_path', 'node_path', 'name']
    }
  }
];
