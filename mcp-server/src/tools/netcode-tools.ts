/**
 * Multiplayer scaffolding tools for Godot MCP Server
 *
 * These BUILD netcode. The runtime side (spawn_headless_peers,
 * call_rpc_runtime, get_multiplayer_status) TESTS it.
 */

import type { ToolDefinition } from '../types.js';

export const netcodeTools: ToolDefinition[] = [
  {
    name: 'mp_add_spawner',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a MultiplayerSpawner, which replicates NODE CREATION from the authority to every peer. Without one, a node the server instantiates at runtime simply never appears on the clients. Point spawn_path at the container new instances go under, and list the scenes it is allowed to spawn.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file being edited' },
        parent_path: { type: 'string', description: 'Where to add the spawner (. for root)' },
        node_name: { type: 'string', description: 'Name for the node (default: "MultiplayerSpawner")' },
        spawn_path: { type: 'string', description: 'NodePath, RELATIVE TO THE SPAWNER, of the node that spawned instances get added under — e.g. "../Players".' },
        spawnable_scenes: {
          type: 'array',
          items: { type: 'string' },
          description: 'res:// paths of scenes this spawner may replicate. Each is verified to exist before anything is written.'
        },
        spawn_limit: { type: 'number', description: 'Max concurrent spawned instances. Omit or 0 for unlimited.' }
      },
      required: ['scene_path', 'spawn_path']
    }
  },
  {
    name: 'mp_add_synchronizer',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add a MultiplayerSynchronizer, which replicates PROPERTY VALUES over time (position, health, …). The replicated set lives in a SceneReplicationConfig sub-resource — this builds that for you. Property paths use the editor\'s Replication-dock form ".:position"; a bare "position" is normalised to it rather than silently replicating nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file being edited' },
        parent_path: { type: 'string', description: 'Where to add the synchronizer (. for root)' },
        node_name: { type: 'string', description: 'Name for the node (default: "MultiplayerSynchronizer")' },
        root_path: { type: 'string', description: 'NodePath the property paths are relative to (default: ".." — the synchronizer\'s parent).' },
        properties: {
          type: 'array',
          description: 'Properties to replicate. Each entry is either a string (".:position") or an object {path, spawn?, sync?} — "spawn" sends the value once at spawn time, "sync" keeps sending it. Both default to true.'
        },
        replication_interval: { type: 'number', description: 'Seconds between syncs. Omit for every frame (0).' }
      },
      required: ['scene_path', 'properties']
    }
  },
  {
    name: 'mp_wire_rpc',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Append a correctly-annotated @rpc method to a script. Getting the annotation wrong is the classic Godot 4 multiplayer bug: the remote call silently does nothing, with no error, because the mode did not match how it was invoked. Refuses if the script already defines that method.',
    inputSchema: {
      type: 'object',
      properties: {
        script_path: { type: 'string', description: 'res:// path of the .gd file to append to' },
        method: { type: 'string', description: 'Method name for the RPC' },
        mode: { type: 'string', enum: ['authority', 'any_peer'], description: '"authority" (default): only the node\'s authority may call it. "any_peer": clients may call it too — needed for client→server messages.' },
        transfer_mode: { type: 'string', enum: ['reliable', 'unreliable', 'unreliable_ordered'], description: 'Default "reliable". Use "unreliable" for high-frequency state where dropping is fine.' },
        call_local: { type: 'boolean', description: 'Also run on the caller (default false).' },
        params: {
          type: 'array',
          description: 'Parameters, each a string ("damage") or {name, type} ({"name":"damage","type":"int"}).'
        }
      },
      required: ['script_path', 'method']
    }
  },
  {
    name: 'mp_scaffold_lobby',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Generate the host/join plumbing every Godot multiplayer project needs: an ENetMultiplayerPeer wired as server or client, peer tracking, and signals for joined/left/connection-failed. Refuses to overwrite an existing file. Register the result as an autoload (setup_autoload) so any scene can reach it.',
    inputSchema: {
      type: 'object',
      properties: {
        script_path: { type: 'string', description: 'Where to write the lobby script, e.g. res://net/lobby.gd. Parent folders are created.' },
        port: { type: 'number', description: 'Port to host on / connect to (default: 7777).' },
        max_clients: { type: 'number', description: 'Max simultaneous clients (default: 8).' },
        default_address: { type: 'string', description: 'Default address for join() (default: "127.0.0.1").' }
      },
      required: ['script_path']
    }
  }
];
