/**
 * GPU particle tools for Godot MCP Server
 * Tools for creating and configuring GPUParticles2D/3D nodes
 */

import type { ToolDefinition } from '../types.js';

export const particleTools: ToolDefinition[] = [
  {
    name: 'create_particles',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a GPUParticles2D or GPUParticles3D node as a child of a node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file (res://path/to/scene.tscn)' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        dimension: { type: 'string', enum: ['2D', '3D'], description: 'Node dimension.' },
        node_name: { type: 'string', description: 'Name for the new node (default: "GPUParticles2D"/"GPUParticles3D")' },
        amount: { type: 'number', description: 'Number of particles (default: 8)' },
        lifetime: { type: 'number', description: 'Particle lifetime in seconds (default: 1.0)' },
        one_shot: { type: 'boolean', description: 'Emit once instead of looping (default: false)' }
      },
      required: ['scene_path', 'parent_path', 'dimension']
    }
  },
  {
    name: 'set_particle_material',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Create or update a ParticleProcessMaterial on a GPUParticles2D/3D node\'s process_material, setting only the given properties. "direction" is always a Vector3 in ParticleProcessMaterial (even for 2D particles).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the GPUParticles2D/3D node' },
        direction: { type: 'object', description: 'Emission direction {x,y,z} (or {x,y} for 2D, z defaults to 0)' },
        spread: { type: 'number', description: 'Spread angle in degrees' },
        initial_velocity_min: { type: 'number', description: 'Minimum initial velocity' },
        initial_velocity_max: { type: 'number', description: 'Maximum initial velocity' },
        gravity: { type: 'object', description: 'Gravity vector {x,y,z}' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'set_particle_color_gradient',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Build a Gradient from color stops, wrap it in a GradientTexture1D, and assign it to the color_ramp of a GPUParticles2D/3D node\'s ParticleProcessMaterial (creating the material if absent).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the GPUParticles2D/3D node' },
        stops: {
          type: 'array',
          description: 'Gradient stops',
          items: { type: 'object', description: '{offset: float 0..1, color: {r,g,b,a}}' }
        }
      },
      required: ['scene_path', 'node_path', 'stops']
    }
  },
  {
    name: 'apply_particle_preset',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Apply a hardcoded, reasonable particle configuration (process material + node properties) for a common effect.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the GPUParticles2D/3D node' },
        preset: { type: 'string', enum: ['fire', 'smoke', 'rain', 'snow', 'sparks'], description: 'Particle preset.' }
      },
      required: ['scene_path', 'node_path', 'preset']
    }
  },
  {
    name: 'get_particle_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read amount, lifetime, one_shot, emitting, and (if present) ParticleProcessMaterial properties from a GPUParticles2D/3D node.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the GPUParticles2D/3D node' }
      },
      required: ['scene_path', 'node_path']
    }
  }
];
