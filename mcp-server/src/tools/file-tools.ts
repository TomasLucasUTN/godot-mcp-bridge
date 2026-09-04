/**
 * File operation tools for Godot MCP Server
 * MVP tools: list_dir, read_file, search_project, create_script
 */

import type { ToolDefinition } from '../types.js';

export const fileTools: ToolDefinition[] = [
  {
    name: 'list_dir',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List files and folders under a Godot project path (e.g., res://). Returns arrays of files and folders in the specified directory.',
    inputSchema: {
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description: 'Starting path like res://addons/ai_assistant or res://'
        },
        include_hidden: {
          type: 'boolean',
          description: 'Include dot-entries. Default false. Supported by the handler all along; it was missing from this schema, so the unknown-argument guard rejected anyone who passed it.'
        }
      },
      required: ['root']
    }
  },
  {
    name: 'read_file',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read a text file from the Godot project, optionally a specific line range. Useful for reading GDScript files, scene files, or any text-based content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'res:// path to the file (e.g., res://scripts/player.gd)'
        },
        start_line: {
          type: 'number',
          description: '1-based inclusive start line (optional)'
        },
        max_bytes: {
          type: 'number',
          description: 'Stop after this many bytes. Use it on a large file rather than pulling the whole thing into context. Supported by the handler all along; it was missing from this schema.'
        },
        end_line: {
          type: 'number',
          description: 'Inclusive end line; 0 or missing means to end of file (optional)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'search_project',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Search the Godot project for a substring and return file hits with line numbers. At most max_results matches (default 50), each line cut at 200 chars, because the answer costs context. When it stops early it says `truncated: true` and reports `returned` rather than a total it never finished counting.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive substring to find'
        },
        glob: {
          type: 'string',
          description: 'Optional glob filter like **/*.gd to search only GDScript files'
        },
        max_results: {
          type: 'number',
          description: 'Stop after this many matches (default 50). The handler has always supported it; it was missing from this schema, so the unknown-argument guard rejected anyone who tried.'
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Match case exactly. Default false.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'create_script',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a NEW GDScript file (.gd) that does not exist yet. Use this for creating new scripts, NOT for editing existing files (use edit_script for edits). Use classdb_query to verify unfamiliar Godot class methods. After creating a script, consider using run_scene to test and get_errors to check for issues.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Script file path (res://scripts/player.gd) - must not exist yet'
        },
        content: {
          type: 'string',
          description: 'Full GDScript content to write to the file'
        },
        dry_run: { type: 'boolean', description: 'Preview without creating the file: the path is checked against the sandbox and for an existing file, and nothing is written. Default false.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'csharp_status',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Report whether C# is actually usable in this editor and project — CALL THIS BEFORE writing any C#. The standard Godot build has no C# support at all: a .cs file written there saves fine, attaches to nothing, and fails silently. Tells you which of the two blockers applies (non-.NET build, or no .csproj/.sln yet) so you can switch to GDScript instead of debugging a no-op.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_csharp_script',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Create a Godot C# script (.cs) with the correct partial-class template (using Godot; public partial class X : Base { _Ready/_Process }). Writes the boilerplate so you don't hand-write it. Note: Godot's C# workflow needs a .NET build of Godot and a C# solution (Project > Tools > C# > Create C# solution, done once); this only writes the script. base_type is a Godot class name (Node, Node2D, CharacterBody2D, ...).",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'res:// path for the .cs file (.cs appended if missing)' },
        class_name: { type: 'string', description: 'C# class name. Defaults to the file name if omitted.' },
        base_type: { type: 'string', description: 'Godot base class to extend (default Node)' },
        namespace: { type: 'string', description: 'Optional C# namespace (file-scoped).' }
      },
      required: ['path']
    }
  }
];
