/**
 * Theme resource tools for Godot MCP Server
 * Tools for creating and editing standalone Theme (.tres) resources
 */

import type { ToolDefinition } from '../types.js';

export const themeTools: ToolDefinition[] = [
  {
    name: 'create_theme',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Create a new empty Theme resource (.tres) on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_path: { type: 'string', description: 'Path to save the theme resource (res://path/to/theme.tres)' }
      },
      required: ['theme_path']
    }
  },
  {
    name: 'set_theme_color',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set a color override on a control type in a Theme resource (e.g. "font_color" on "Label").',
    inputSchema: {
      type: 'object',
      properties: {
        theme_path: { type: 'string', description: 'Path to the theme resource' },
        control_type: { type: 'string', description: 'Control type name (e.g. "Label", "Button")' },
        color_name: { type: 'string', description: 'Color property name (e.g. "font_color")' },
        color: { type: 'object', description: 'Color as {r,g,b,a}' }
      },
      required: ['theme_path', 'control_type', 'color_name', 'color']
    }
  },
  {
    name: 'set_theme_constant',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set an integer constant override on a control type in a Theme resource (e.g. "separation").',
    inputSchema: {
      type: 'object',
      properties: {
        theme_path: { type: 'string', description: 'Path to the theme resource' },
        control_type: { type: 'string', description: 'Control type name' },
        constant_name: { type: 'string', description: 'Constant property name (e.g. "separation")' },
        value: { type: 'number', description: 'Integer value' }
      },
      required: ['theme_path', 'control_type', 'constant_name', 'value']
    }
  },
  {
    name: 'set_theme_font_size',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Set a font size override on a control type in a Theme resource.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_path: { type: 'string', description: 'Path to the theme resource' },
        control_type: { type: 'string', description: 'Control type name' },
        font_size_name: { type: 'string', description: 'Font size property name (default: "font_size")' },
        value: { type: 'number', description: 'Font size value' }
      },
      required: ['theme_path', 'control_type', 'value']
    }
  },
  {
    name: 'set_theme_stylebox',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Build a StyleBoxFlat from a friendly style dict and set it as a stylebox override on a control type in a Theme resource.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_path: { type: 'string', description: 'Path to the theme resource' },
        control_type: { type: 'string', description: 'Control type name' },
        stylebox_name: { type: 'string', description: 'Stylebox property name (e.g. "panel", "normal")' },
        style: {
          type: 'object',
          description: 'Style properties: bg_color {r,g,b,a}, border_width (int, applied to all sides), border_color {r,g,b,a}, corner_radius (int, applied to all corners), content_margin (number, applied to all sides)'
        }
      },
      required: ['theme_path', 'control_type', 'stylebox_name', 'style']
    }
  },
  {
    name: 'get_theme_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read all control types and their colors, constants, font sizes, and styleboxes from a Theme resource.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_path: { type: 'string', description: 'Path to the theme resource' }
      },
      required: ['theme_path']
    }
  }
];
