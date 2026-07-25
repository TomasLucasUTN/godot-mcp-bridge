/**
 * 3D scene setup tools for Godot MCP Server
 * Tools for mesh instances, lighting, materials, environment, cameras, and gridmaps
 */

import type { ToolDefinition } from '../types.js';

export const scene3dTools: ToolDefinition[] = [
  {
    name: 'add_mesh_instance',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a MeshInstance3D with a matching PrimitiveMesh (BoxMesh, SphereMesh, CylinderMesh, PlaneMesh, CapsuleMesh, or TorusMesh) as a child of a node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file (res://path/to/scene.tscn)' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        mesh_type: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'plane', 'capsule', 'torus'], description: 'Primitive mesh shape.' },
        node_name: { type: 'string', description: 'Name for the new node (default: "MeshInstance3D")' },
        size: {
          description: 'Mesh size, shape depends on mesh_type: box {x,y,z}; sphere a number (radius); cylinder/capsule {x: radius, y: height} or a number (radius); plane {x,y}; torus {x: inner_radius, y: outer_radius} or a number (outer_radius). Omit for Godot defaults.'
        }
      },
      required: ['scene_path', 'parent_path', 'mesh_type']
    }
  },
  {
    name: 'setup_lighting',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a light node with a hardcoded, reasonable preset configuration: "sun" (DirectionalLight3D), "indoor" or "dramatic" (OmniLight3D).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        preset: { type: 'string', enum: ['sun', 'indoor', 'dramatic'], description: 'Lighting preset.' },
        node_name: { type: 'string', description: 'Name for the new node (default: "DirectionalLight3D"/"OmniLight3D")' }
      },
      required: ['scene_path', 'parent_path', 'preset']
    }
  },
  {
    name: 'set_material_3d',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Create or update a StandardMaterial3D on a node\'s material_override, setting only the given properties. Fails if the node has no material_override property.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the node (e.g. MeshInstance3D, CSGShape3D)' },
        albedo_color: { type: 'object', description: 'Base color {r,g,b,a}' },
        metallic: { type: 'number', description: 'Metallic factor (0..1)' },
        roughness: { type: 'number', description: 'Roughness factor (0..1)' },
        emission_color: { type: 'object', description: 'Emission color {r,g,b,a}; setting this enables emission' },
        emission_energy: { type: 'number', description: 'Emission energy multiplier; setting this enables emission' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'setup_environment',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Find or create a WorldEnvironment child of the scene root and configure its Environment resource (sky colors via ProceduralSkyMaterial, fog, glow, SSAO), setting only the given properties.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        sky_top_color: { type: 'object', description: 'Sky top color {r,g,b,a}' },
        sky_horizon_color: { type: 'object', description: 'Sky horizon color {r,g,b,a}' },
        fog_enabled: { type: 'boolean', description: 'Enable fog' },
        glow_enabled: { type: 'boolean', description: 'Enable glow' },
        ssao_enabled: { type: 'boolean', description: 'Enable SSAO' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'setup_camera_3d',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a Camera3D as a child of a node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        node_name: { type: 'string', description: 'Name for the new node (default: "Camera3D")' },
        projection: { type: 'string', enum: ['perspective', 'orthogonal'], description: 'Default: "perspective".' },
        fov: { type: 'number', description: 'Field of view in degrees' },
        near: { type: 'number', description: 'Near clip distance' },
        far: { type: 'number', description: 'Far clip distance' }
      },
      required: ['scene_path', 'parent_path']
    }
  },
  {
    name: 'add_gridmap',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a GridMap node as a child of a node, optionally assigning a MeshLibrary and cell size.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        node_name: { type: 'string', description: 'Name for the new node (default: "GridMap")' },
        mesh_library_path: { type: 'string', description: 'res:// path to a MeshLibrary resource to assign' },
        cell_size: { type: 'object', description: 'Cell size {x,y,z}' }
      },
      required: ['scene_path', 'parent_path']
    }
  }
];
