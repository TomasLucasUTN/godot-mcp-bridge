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
        },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
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
        node_name: { type: 'string', description: 'Name for the new node (default: "DirectionalLight3D"/"OmniLight3D")' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
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
        emission_energy: { type: 'number', description: 'Emission energy multiplier; setting this enables emission' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
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
        ssao_enabled: { type: 'boolean', description: 'Enable SSAO' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
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
        far: { type: 'number', description: 'Far clip distance' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'parent_path']
    }
  },
  {
    name: 'get_skeleton_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "List a skeleton's bones. Works on Skeleton2D and Skeleton3D, and the answer differs because the engine's model does: a Skeleton3D owns bones as internal INDICES (reported with index, parent, rest, pose), while a Skeleton2D owns Bone2D NODES (reported with a node_path the other scene tools can act on). Check `kind` in the response before assuming either shape.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene containing the skeleton (res://...).' },
        node_path: { type: 'string', description: 'Path to the Skeleton2D or Skeleton3D node.' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'add_bone',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Add a bone to a skeleton. For a Skeleton3D this adds an internal bone (parent_bone is another bone's NAME). For a Skeleton2D it creates a Bone2D node — parent_bone may be a node path or a Bone2D name, and nesting is what forms the chain. Note Godot exposes no way to REMOVE a 3D bone, so a mistake there means rebuilding the skeleton.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene containing the skeleton (res://...).' },
        node_path: { type: 'string', description: 'Path to the Skeleton2D or Skeleton3D node.' },
        bone_name: { type: 'string', description: 'Name for the new bone.' },
        parent_bone: { type: 'string', description: '3D: the parent bone NAME. 2D: a node path or Bone2D name; omit to attach directly under the skeleton.' },
        rest: { description: '3D: a Transform3D. 2D: a Transform2D, or a {x,y} position for the common case.' },
        length: { type: 'number', description: '2D only: bone length in pixels. Setting it disables autocalculation.' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'bone_name']
    }
  },
  {
    name: 'set_bone_pose',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Pose a bone by name. 3D sets the bone's pose position/rotation/scale on the Skeleton3D (rotation takes a Vector3 of euler radians or a Quaternion). 2D moves the Bone2D node itself, which is the same thing expressed as a node transform (rotation is a single float). Pass at least one component.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene containing the skeleton (res://...).' },
        node_path: { type: 'string', description: 'Path to the Skeleton2D or Skeleton3D node.' },
        bone_name: { type: 'string', description: 'Bone to pose.' },
        position: { description: '3D: {x,y,z}. 2D: {x,y}.' },
        rotation: { description: '3D: {x,y,z} euler radians or a quaternion. 2D: a number (radians).' },
        scale: { description: '3D: {x,y,z}. 2D: {x,y}.' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'bone_name']
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
        cell_size: { type: 'object', description: 'Cell size {x,y,z}' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'parent_path']
    }
  }
];
