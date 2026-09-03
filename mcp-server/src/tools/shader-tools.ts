/**
 * Shader tools for Godot MCP Server
 * Tools for creating/editing Shader resources and assigning ShaderMaterials
 */

import type { ToolDefinition } from '../types.js';

export const shaderTools: ToolDefinition[] = [
  {
    name: 'create_shader',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a new Shader resource file. If "code" is omitted, generates a minimal valid template for the given shader_type.',
    inputSchema: {
      type: 'object',
      properties: {
        shader_path: { type: 'string', description: 'Path to save the shader resource (.gdshader)' },
        shader_type: { type: 'string', enum: ['canvas_item', 'spatial', 'particles', 'sky', 'fog'], description: 'Default: "canvas_item".' },
        code: { type: 'string', description: 'Full GDShader source code, including the shader_type line. If omitted, a minimal template is generated.' }
      },
      required: ['shader_path']
    }
  },
  {
    name: 'read_shader',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read a Shader resource: returns its source code and mode (Shader.MODE_* int).',
    inputSchema: {
      type: 'object',
      properties: {
        shader_path: { type: 'string', description: 'Path to the shader resource' }
      },
      required: ['shader_path']
    }
  },
  {
    name: 'edit_shader',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Apply a small surgical code edit to a Shader resource by replacing a unique code snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        shader_path: { type: 'string', description: 'Path to the shader resource' },
        old_code_snippet: { type: 'string', description: 'Exact snippet to find and replace (must be unique in the shader code)' },
        new_code_snippet: { type: 'string', description: 'Replacement snippet' }
      },
      required: ['shader_path', 'old_code_snippet', 'new_code_snippet']
    }
  },
  {
    name: 'assign_shader_material',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a ShaderMaterial from a Shader resource and assign it to a node. CanvasItems get "material"; MeshInstance3D uses set_surface_override_material when surface_index is given, otherwise "material_override"; other GeometryInstance3D nodes get "material_override".',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the node (. for root)' },
        shader_path: { type: 'string', description: 'Path to the Shader resource to assign' },
        surface_index: { type: 'number', description: 'For MeshInstance3D, the surface index to override (omit for material_override)' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'shader_path']
    }
  },
  {
    name: 'set_shader_param',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set a shader uniform parameter on a node\'s ShaderMaterial.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the node (. for root)' },
        param_name: { type: 'string', description: 'Name of the shader uniform' },
        value: { description: 'Value to set. Primitives pass through directly; typed values (Vector2/Vector3/Color/etc.) use {type, ...} dicts.' },
        surface_index: { type: 'number', description: 'For MeshInstance3D, the surface index whose override material to target' },
        dry_run: { type: 'boolean', description: 'Preview the change without writing it: the tool does its work on a copy loaded from disk, reports what it would produce, and never touches the file or the open scene. Default false.' }
      },
      required: ['scene_path', 'node_path', 'param_name', 'value']
    }
  },
  {
    name: 'get_shader_params',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List all shader uniform parameters on a node\'s ShaderMaterial, with their current (or default) values.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the node (. for root)' },
        surface_index: { type: 'number', description: 'For MeshInstance3D, the surface index whose override material to inspect' }
      },
      required: ['scene_path', 'node_path']
    }
  }
];
