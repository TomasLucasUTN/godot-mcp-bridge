/**
 * Navigation tools for Godot MCP Server
 * Tools for NavigationRegion/Agent setup and nav mesh baking
 */

import type { ToolDefinition } from '../types.js';

export const navigationTools: ToolDefinition[] = [
  {
    name: 'setup_navigation_region',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a NavigationRegion2D or NavigationRegion3D as a child of a node, with an empty NavigationPolygon/NavigationMesh resource assigned so it\'s ready to bake.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        dimension: { type: 'string', enum: ['2D', '3D'], description: 'Default: "2D".' },
        node_name: { type: 'string', description: 'Name for the new node (default: "NavigationRegion2D"/"NavigationRegion3D")' }
      },
      required: ['scene_path', 'parent_path']
    }
  },
  {
    name: 'bake_navigation_mesh',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Bake the navigation mesh/polygon for a NavigationRegion2D/3D from its child geometry (collision shapes/meshes). Runs synchronously.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the NavigationRegion2D/3D node' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'setup_navigation_agent',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a NavigationAgent2D or NavigationAgent3D as a child of a node, for pathfinding and avoidance.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        dimension: { type: 'string', enum: ['2D', '3D'], description: 'Default: "2D".' },
        node_name: { type: 'string', description: 'Name for the new node (default: "NavigationAgent2D"/"NavigationAgent3D")' },
        radius: { type: 'number', description: 'Agent radius' },
        max_speed: { type: 'number', description: 'Agent max speed' }
      },
      required: ['scene_path', 'parent_path']
    }
  },
  {
    name: 'set_navigation_layers',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set navigation_layers on a NavigationRegion2D/3D or NavigationAgent2D/3D node. Can be given as a raw bitmask int or as an array of 1-based layer indices (1..32).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the node' },
        layers: { description: 'Raw bitmask int, or array of 1-based layer indices (1..32)' }
      },
      required: ['scene_path', 'node_path', 'layers']
    }
  },
  {
    name: 'get_navigation_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read navigation config for a NavigationRegion2D/3D (enabled, is_baking, bounds, has_baked_data) or NavigationAgent2D/3D (radius, max_speed, avoidance_enabled), plus navigation_layers on either.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the node' }
      },
      required: ['scene_path', 'node_path']
    }
  }
];
