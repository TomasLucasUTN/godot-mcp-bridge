/**
 * Visualizer tools - project mapping and visualization
 */

import type { ToolDefinition } from '../types.js';

export const visualizerTools: ToolDefinition[] = [
  {
    name: 'map_project',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Crawl the entire Godot project and build an interactive visual map of all scripts showing their structure (variables, functions, signals), connections (extends, preloads, signal connections), and descriptions. Opens an interactive browser-based visualization and returns its URL plus a one-line-per-script index. The full structure goes to the browser rather than into the conversation — inline it is ~37k tokens on a mid-size project — so pass include_map: true only when you actually need it in context.',
    inputSchema: {
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description: 'Root path to start crawling from (default: res://)'
        },
        include_addons: {
          type: 'boolean',
          description: 'Whether to include scripts in the addons/ folder (default: false)'
        },
        include_map: {
          type: 'boolean',
          description: 'Return the full crawled structure inline as well. Default false: measured at 149,978 characters (~37k tokens) on a 24,880-file project, which is the same data the visualisation already shows.'
        }
      },
      required: []
    }
  }
];
