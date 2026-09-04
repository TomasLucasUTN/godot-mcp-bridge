/**
 * Script and file management tools for Godot MCP Server
 * Tools for editing scripts, managing files, and validating code
 */

import type { ToolDefinition } from '../types.js';

export const scriptTools: ToolDefinition[] = [
  {
    name: 'edit_script',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Apply a SMALL, SURGICAL code edit (1-10 lines) to GDScript files. Auto-applies changes. For large changes, call multiple times. ONLY for .gd files - NEVER for .tscn scene files. Use classdb_query to verify unfamiliar Godot class methods. After making changes, consider using run_scene to test and get_errors to check for issues.',
    inputSchema: {
      type: 'object',
      properties: {
        edit: {
          type: 'object',
          description: 'Edit spec: {type: "snippet_replace", file: "res://path.gd", old_snippet: "old code", new_snippet: "new code", context_before: "line above", context_after: "line below"}. Keep old_snippet SMALL (1-10 lines).'
        },
        dry_run: { type: 'boolean', description: 'Preview the edit without writing it: the snippet is located and the new content built, so you learn whether it would match and what it would produce, and the file is left alone. Default false.' }
      },
      required: ['edit']
    }
  },
  {
    name: 'validate_script',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Validate a GDScript file for syntax errors using Godot\'s built-in parser. Call after creating or modifying scripts to ensure they are error-free.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the GDScript file to validate (e.g., res://scripts/player.gd)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'validate_scripts',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Validate many GDScript files at once. Pass \"paths\" (array of res:// .gd paths) to check a specific set, or omit it to sweep the project (addons/ excluded unless include_addons). Returns only the invalid scripts, each with a message you can act on, plus elapsed_ms. PREFER an explicit paths list: validation runs on the editor's main thread at roughly 34ms per script, so a whole-project sweep on a large codebase is slow and can approach the bridge's 20s watchdog.",
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'res:// .gd paths to validate. Omit to sweep the project — but pass the files you changed instead when you know them.'
        },
        include_addons: {
          type: 'boolean',
          description: 'Include res://addons/ in a whole-project sweep. Default false: plugin code is usually most of the files and is not yours to fix.'
        }
      }
    }
  },
  {
    name: 'create_folder',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a directory (with parent directories if needed).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path (res://path/to/folder)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'delete_file',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Permanently delete a file from the project. REQUIRES confirm=true as an explicit safety gate \u2014 omitting confirm returns an error. Creates a .bak backup alongside the original by default (disable with create_backup=false). REFUSES if the file is currently open in the editor (any scene tab or script editor tab); close the tab first, or pass force=true to bypass the check (not recommended \u2014 deleting the active scene out from under the editor can crash Godot). Use ONLY when deletion is explicitly requested; NEVER as a way to "edit" or "reset" a file (use edit_script instead). Does not delete directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to delete (e.g. res://scenes/old.tscn)'
        },
        confirm: {
          type: 'boolean',
          description: 'REQUIRED. Must be explicitly set to true \u2014 safety gate to prevent accidental deletes. Calls without confirm=true fail with an error.'
        },
        create_backup: {
          type: 'boolean',
          description: 'If true (default), saves a .bak copy next to the original before deletion so the file can be recovered. Set false to delete without backup.'
        },
        force: {
          type: 'boolean',
          description: 'If true, bypass the "file is open in editor" guard. Use ONLY if you know the file is not the active scene. The guard exists because deleting the active scene tab from under the editor can crash Godot.'
        },
        dry_run: { type: 'boolean', description: 'Preview without deleting: reports the file it would remove. Default false. Note this is separate from `confirm`, which is the gate — a preview needs no confirmation because it changes nothing.' }
      },
      required: ['path', 'confirm']
    }
  },
  {
    name: 'rename_file',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Rename or move a file, optionally updating references in other files.',
    inputSchema: {
      type: 'object',
      properties: {
        old_path: {
          type: 'string',
          description: 'Current file path'
        },
        new_path: {
          type: 'string',
          description: 'New file path'
        },
        update_references: {
          type: 'boolean',
          description: 'Update references in other files (default: true)'
        },
        dry_run: { type: 'boolean', description: 'Preview without renaming: checks the source exists and the target does not, then reports what it would do. Default false.' }
      },
      required: ['old_path', 'new_path']
    }
  },
  {
    name: 'list_scripts',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List all GDScript files in the project with basic metadata.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'generate_property_forwarder',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Append a Godot 4 property with inline get/set blocks that forwards to a nested target (avoids hand-written getter/setter boilerplate for Law-of-Demeter-style exposure). Appends `var <property_name>[: type_hint]:\\n\\tget:\\n\\t\\treturn <target_expression>.<target_property>\\n\\tset(value):\\n\\t\\t<target_expression>.<target_property> = value` to the end of the script. Errors if the property name is already declared.',
    inputSchema: {
      type: 'object',
      properties: {
        script_path: { type: 'string', description: 'Path to the .gd script to append to' },
        property_name: { type: 'string', description: 'Name of the new forwarding property' },
        target_expression: { type: 'string', description: 'GDScript expression for the target, e.g. "$Target" or "target_node"' },
        target_property: { type: 'string', description: 'Property name on the target to forward to' },
        type_hint: { type: 'string', description: 'Optional GDScript type annotation, e.g. "int"' }
      },
      required: ['script_path', 'property_name', 'target_expression', 'target_property']
    }
  }
];
