/**
 * Audio tools for Godot MCP Server
 * Tools for adding audio players and managing audio buses
 */

import type { ToolDefinition } from '../types.js';

export const audioTools: ToolDefinition[] = [
  {
    name: 'add_audio_player',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add an AudioStreamPlayer (or its 2D/3D variant) as a child of a node, optionally assigning an audio stream and bus.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file (res://path/to/scene.tscn)' },
        parent_path: { type: 'string', description: 'Path to the parent node (. for root)' },
        node_name: { type: 'string', description: 'Name for the new node (default: "AudioStreamPlayer")' },
        player_type: { type: 'string', enum: ['', '2D', '3D'], description: '"" for AudioStreamPlayer, "2D" for AudioStreamPlayer2D, "3D" for AudioStreamPlayer3D (default: "").' },
        stream_path: { type: 'string', description: 'Optional res:// path to an audio stream (e.g. .ogg/.wav import) to assign' },
        bus: { type: 'string', description: 'Optional audio bus name to route this player through' },
        autoplay: { type: 'boolean', description: 'Whether the player starts automatically (default: false)' }
      },
      required: ['scene_path', 'parent_path']
    }
  },
  {
    name: 'add_audio_bus',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a new audio bus via AudioServer.add_bus() and persist it to the project\'s default bus layout resource.',
    inputSchema: {
      type: 'object',
      properties: {
        bus_name: { type: 'string', description: 'Name for the new bus' },
        send_to: { type: 'string', description: 'Bus this bus sends its output to (default: "Master")' },
        volume_db: { type: 'number', description: 'Initial volume in dB (default: 0.0)' },
        mute: { type: 'boolean', description: 'Whether the bus starts muted (default: false)' },
        at_position: { type: 'number', description: 'Bus index to insert at (default: append at end)' }
      },
      required: ['bus_name']
    }
  },
  {
    name: 'get_audio_bus_layout',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List all audio buses with their volume, mute, solo, and send target.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
