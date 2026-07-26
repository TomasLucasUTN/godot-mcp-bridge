/**
 * Language-server tools for Godot MCP Server
 *
 * These query Godot's built-in GDScript language server (default port 6005) —
 * a separate TCP listener the editor already runs, NOT the addon's WebSocket
 * bridge. Handled inside the Node server, so they work whenever the editor is
 * open.
 *
 * The reason to prefer these over `search_project`: the language server reads
 * GDScript's real symbol table. A text search cannot distinguish a local
 * `speed` from an unrelated class's `speed`; these can.
 *
 * Only capabilities Godot actually advertises are exposed here. It does NOT
 * support workspace symbols, code actions, formatting, folding ranges,
 * implementations or type definitions, so there are no tools for those.
 */

import type { ToolDefinition } from '../types.js';

export const lspTools: ToolDefinition[] = [
  {
    name: 'gd_definition',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Jump to where a symbol is DEFINED, resolved by Godot\'s language server rather than by text search. Give the file and the position of the symbol. Returns the target file and line.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script containing the symbol (res:// path or absolute).' },
        line: { type: 'number', description: '1-based line number of the symbol.' },
        column: { type: 'number', description: '1-based column. Point at the symbol itself, not the line start.' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'gd_references',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Find every reference to the symbol at a position — scope-aware, so it does not match same-named symbols from unrelated scopes the way search_project would. Use this before renaming or deleting something to see what actually depends on it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script containing the symbol (res:// path or absolute).' },
        line: { type: 'number', description: '1-based line number of the symbol.' },
        column: { type: 'number', description: '1-based column of the symbol.' },
        include_declaration: { type: 'boolean', description: 'Include the declaration itself (default: true).' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'gd_rename',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Rename a symbol correctly, using the language server\'s understanding of scope. PREFER THIS over rename_symbol_project_wide, which is a text substitution and will happily rename an unrelated symbol that shares the name. Returns the edits; pass apply=true to write them to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script containing the symbol (res:// path or absolute).' },
        line: { type: 'number', description: '1-based line number of the symbol.' },
        column: { type: 'number', description: '1-based column of the symbol.' },
        new_name: { type: 'string', description: 'The new symbol name.' },
        apply: { type: 'boolean', description: 'Write the edits to disk. Default false — returns a preview of what would change.' }
      },
      required: ['path', 'line', 'column', 'new_name']
    }
  },
  {
    name: 'gd_diagnostics',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Type and syntax problems the language server reports for a script, WITHOUT running the game — errors surface before run_scene rather than after. Complements validate_script (which only checks that the file parses).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script to check (res:// path or absolute).' },
        wait_ms: { type: 'number', description: 'How long to wait for the server to publish diagnostics (default: 3000). They arrive asynchronously after the document is opened.' }
      },
      required: ['path']
    }
  },
  {
    name: 'gd_hover',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'The signature and documentation for the symbol at a position — what the editor shows on mouse-over. Useful to confirm a method\'s real signature before calling it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script containing the symbol (res:// path or absolute).' },
        line: { type: 'number', description: '1-based line number.' },
        column: { type: 'number', description: '1-based column.' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'gd_document_symbols',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Outline of one script: its classes, functions, signals, constants and variables with their line numbers. Cheaper than reading the whole file when you only need its shape.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script to outline (res:// path or absolute).' }
      },
      required: ['path']
    }
  },
  {
    name: 'gd_completion',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Code completions at a position, from the engine\'s own symbol table. Use it to discover what members a node or class actually exposes instead of guessing from training data.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Script (res:// path or absolute).' },
        line: { type: 'number', description: '1-based line number.' },
        column: { type: 'number', description: '1-based column, typically just after a "." .' },
        limit: { type: 'number', description: 'Max items to return (default: 50). Completion lists can be very long.' }
      },
      required: ['path', 'line', 'column']
    }
  },
  {
    name: 'gd_lsp_status',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Report whether the language server is reachable and which capabilities it advertises. Call this first when an LSP tool behaves unexpectedly — Godot supports fewer LSP features than a typical language server.',
    inputSchema: { type: 'object', properties: {} }
  }
];
