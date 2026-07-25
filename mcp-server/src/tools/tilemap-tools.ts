/**
 * TileMap operation tools for Godot MCP Server
 * Tools for reading and editing TileMapLayer cells (Godot 4.3+)
 */

import type { ToolDefinition } from '../types.js';

const coordsSchema = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'Cell column' },
    y: { type: 'number', description: 'Cell row' }
  },
  description: 'Cell coordinates as {x, y}'
} as const;

export const tilemapTools: ToolDefinition[] = [
  {
    name: 'tilemap_set_cell',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set a single cell on a TileMapLayer node. Requires the tile source_id from the assigned TileSet (use tilemap_get_info to discover sources).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file (res://path/to/scene.tscn)' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' },
        coords: coordsSchema,
        source_id: { type: 'number', description: 'Tile source ID in the TileSet' },
        atlas_coords: coordsSchema,
        alternative_tile: { type: 'number', description: 'Alternative tile ID (default: 0)' }
      },
      required: ['scene_path', 'node_path', 'coords', 'source_id']
    }
  },
  {
    name: 'tilemap_fill_rect',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Fill a rectangular region of cells on a TileMapLayer node with the same tile.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' },
        from_coords: coordsSchema,
        to_coords: coordsSchema,
        source_id: { type: 'number', description: 'Tile source ID in the TileSet' },
        atlas_coords: coordsSchema,
        alternative_tile: { type: 'number', description: 'Alternative tile ID (default: 0)' }
      },
      required: ['scene_path', 'node_path', 'from_coords', 'to_coords', 'source_id']
    }
  },
  {
    name: 'tilemap_get_cell',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read the tile at a single cell of a TileMapLayer node. source_id of -1 means the cell is empty.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' },
        coords: coordsSchema
      },
      required: ['scene_path', 'node_path', 'coords']
    }
  },
  {
    name: 'tilemap_clear',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Clear all cells on a TileMapLayer node, or only cells within a rectangular region if from_coords/to_coords are both given.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' },
        from_coords: coordsSchema,
        to_coords: coordsSchema
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'tilemap_get_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Get TileSet info for a TileMapLayer node: tile_size and available sources (source_id, type, tiles_count).',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'tilemap_get_used_cells',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List all non-empty cells on a TileMapLayer node with their source_id, atlas_coords, and alternative_tile.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' }
      },
      required: ['scene_path', 'node_path']
    }
  },
  {
    name: 'tilemap_set_terrain_cells',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: "Paint cells on a TileMapLayer using the TileSet's built-in terrain autotiling (wraps set_cells_terrain_connect/set_cells_terrain_path). The terrain_set and terrain indices must already exist on the assigned TileSet — this tool does not create terrain sets, only paints with ones configured by hand in the TileSet editor. Note: Godot's terrain matching algorithm can repaint neighboring cells' tile variants (not their terrain assignment) to keep edges connected — this is expected engine behavior, not a bug in this tool.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' },
        cells: {
          type: 'array',
          items: coordsSchema,
          description: 'Cell coordinates to paint with the terrain'
        },
        terrain_set: { type: 'number', description: 'Terrain set index (must already exist on the TileSet)' },
        terrain: { type: 'number', description: 'Terrain index within the terrain set (must already exist)' },
        mode: {
          type: 'string',
          enum: ['connect', 'path'],
          description: "'connect' (default) picks tiles so terrain connects to matching neighbors in any order; 'path' treats the given cells as an ordered path"
        },
        ignore_empty_terrains: { type: 'boolean', description: 'Whether empty cells count as a distinct terrain for matching purposes (default: true)' }
      },
      required: ['scene_path', 'node_path', 'cells', 'terrain_set', 'terrain']
    }
  },
  {
    name: 'tilemap_autotile',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: "Autotile a region deterministically: for each cell, compute a neighbour bitmask and set the atlas tile you mapped for that shape, via set_cell. Unlike tilemap_set_terrain_cells (Godot's native terrain solver — non-deterministic, ~20x slower, can cascade), this is order-independent and predictable. You supply mask_to_atlas so it works with any atlas layout. Bit order — neighbours=\"4\": N=1,E=2,S=4,W=8 (mask 0-15); neighbours=\"8\": N=1,NE=2,E=4,SE=8,S=16,SW=32,W=64,NW=128. A neighbour is 'filled' if it's in cells or (include_existing) already has a tile.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file' },
        node_path: { type: 'string', description: 'Path to the TileMapLayer node' },
        source_id: { type: 'number', description: 'TileSet atlas source id to paint from (default 0)' },
        cells: { type: 'array', items: coordsSchema, description: 'Cell coordinates to autotile' },
        mask_to_atlas: {
          type: 'object',
          description: 'Map from neighbour bitmask (as a string key) to the atlas coordinate for that tile shape, e.g. {"0": {"x":0,"y":0}, "15": {"x":1,"y":1}}. Cells whose mask has no entry are left unchanged and reported in unmapped_sample.'
        },
        neighbours: { type: 'string', enum: ['4', '8'], description: '"4" = edges only (default), "8" = edges + corners' },
        include_existing: { type: 'boolean', description: 'Count tiles already on the layer as filled neighbours so the region connects to them (default true)' }
      },
      required: ['scene_path', 'node_path', 'cells', 'mask_to_atlas']
    }
  }
];
