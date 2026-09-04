/**
 * Project configuration and debug tools for Godot MCP Server
 * Tools for inspecting project settings, debugging, and editor interaction
 */

import type { ToolDefinition } from '../types.js';

export const projectTools: ToolDefinition[] = [
  {
    name: 'get_project_settings',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Concise project settings summary: main_scene, window size/stretch, physics tick rate, and render basics.',
    inputSchema: {
      type: 'object',
      properties: {
        include_render: {
          type: 'boolean',
          description: 'Include render settings'
        },
        include_physics: {
          type: 'boolean',
          description: 'Include physics settings'
        }
      }
    }
  },
  {
    name: 'get_input_map',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Return the full InputMap: built-in actions (ui_*, spatial_editor/*) plus all project-defined actions from project.godot. Each action maps to an object with "events" (array of key/mouse/gamepad bindings) and optionally "deadzone". Use this before configure_input_map to see current bindings and deadzones.',
    inputSchema: {
      type: 'object',
      properties: {
        include_deadzones: {
          type: 'boolean',
          description: 'Include the per-action "deadzone" field in each action object (default: true). When true, each action is {"deadzone": 0.5, "events": [...]}. When false, each action is {"events": [...]}.'
        }
      }
    }
  },
  {
    name: 'get_collision_layers',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Return named 2D/3D physics collision layers from ProjectSettings.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_node_properties',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Get available properties for a Godot node type. Use this to discover what properties exist on a node type (e.g., anchors_preset for Control, position for Node2D).',
    inputSchema: {
      type: 'object',
      properties: {
        node_type: {
          type: 'string',
          description: 'Node class name (e.g., "Sprite2D", "Control", "Label", "Button")'
        }
      },
      required: ['node_type']
    }
  },
  {
    name: 'get_console_log',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Return the latest lines from the Godot editor output log (as a single "content" string). Pass filter to keep only lines containing a substring — cheaper than pulling the whole log to find one message.',
    inputSchema: {
      type: 'object',
      properties: {
        max_lines: {
          type: 'number',
          description: 'Maximum number of lines to include (default: 50)'
        },
        filter: {
          type: 'string',
          description: 'Case-insensitive substring: only matching log lines are returned.'
        }
      }
    }
  },
  {
    name: 'get_errors',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Get errors and warnings from both the Godot Output panel and the Debugger > Errors tab. Returns file paths, line numbers, severity, stack traces, and which source each error came from. If errors mention a missing method or property, use classdb_query to verify the correct API before fixing.',
    inputSchema: {
      type: 'object',
      properties: {
        max_errors: {
          type: 'number',
          description: 'Maximum number of errors to return (default: 50)'
        },
        include_warnings: {
          type: 'boolean',
          description: 'Include warnings in addition to errors (default: true)'
        }
      }
    }
  },
  {
    name: 'clear_console_log',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Mark the current position in the Godot editor log. Subsequent get_console_log and get_errors calls will only return output after this point.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'open_in_godot',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Open a file in the Godot editor at a specific line (side-effect only).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'res:// path to open'
        },
        line: {
          type: 'number',
          description: '1-based line number'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'spawn_headless_peers',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    description: "Launch N headless Godot instances of a scene as multiplayer CLIENT peers (passed user args --no-mcp --mp-client) to run a real networking test against the server running in the current run_scene game. The scene must follow the server/client role convention (host by default, connect as client when it sees --mp-client — see examples/multiplayer/mp_sample.gd). After spawning, verify with get_multiplayer_status (connected_peers grows) or await_signal_runtime on multiplayer's peer_connected. Always stop_headless_peers when done.",
    inputSchema: {
      type: 'object',
      properties: {
        scene: { type: 'string', description: 'res:// scene the peers run as clients (the same scene the server runs).' },
        count: { type: 'number', description: 'How many client peers to spawn (1..8, default 1).' },
        client_args: { type: 'array', items: { type: 'string' }, description: 'User args appended after --no-mcp (default ["--mp-client"]).' }
      },
      required: ['scene']
    }
  },
  {
    name: 'stop_headless_peers',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Kill every headless peer previously launched by spawn_headless_peers. Returns how many were killed.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_editor_activity',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Poll what the DEVELOPER is doing in the editor — node selection changes, scenes opened/closed, which script they focused, filesystem changes — so you can work alongside the human instead of blind. Each event is tagged source:\"human\" or source:\"agent\" (your own tool calls); pass source:\"human\" to see only the developer's actions. Pass since_id from the previous call's latest_id to get only new events; the buffer keeps the last ~200.",
    inputSchema: {
      type: 'object',
      properties: {
        since_id: { type: 'number', description: "Return only events after this id. Use 0 (default) for everything buffered, then pass the returned latest_id next time." },
        limit: { type: 'number', description: 'Max events to return (default 50, max 200).' },
        source: { type: 'string', enum: ['human', 'agent'], description: 'Filter to just the developer\'s activity ("human") or your own tool-caused activity ("agent"). Omit for both.' }
      }
    }
  },
  {
    name: 'scene_tree_dump',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Dump the scene tree of the scene currently open in the Godot editor (node names, types, and attached scripts). Pass max_depth to keep the output small on large scenes — a depth-limited branch reports its descendant count instead of expanding. Start shallow (max_depth 1-2) for an overview, then drill in.',
    // In a host that supports MCP Apps the same result is also drawn as a
    // collapsible panel the developer can click; everywhere else this key is
    // ignored and the text answer is unchanged.
    _meta: { ui: { resourceUri: 'ui://godot-mcp-bridge/scene-tree' } },
    inputSchema: {
      type: 'object',
      properties: {
        max_depth: { type: 'number', description: 'Max tree depth to expand (root is 0). Omit or -1 for the full tree. Use 1-2 for a cheap overview of a big scene.' }
      }
    }
  },
  {
    name: 'list_settings',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Browse Godot project settings by category. Returns values from the editor\'s in-memory state — this matches project.godot after a normal Godot save, but direct edits to project.godot on disk are not reflected until the editor restarts (rescan_filesystem does not help). Call without a category to see all available categories, with a category to see its settings, or with a filter to search matching setting paths (across all categories, or within one).',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Settings category prefix (e.g., "display", "physics", "rendering", "application", "audio"). Omit to list all available categories.'
        },
        filter: {
          type: 'string',
          description: 'Case-insensitive substring on the setting path. Without a category, searches all categories (e.g. "vsync"); with a category, narrows within it.'
        }
      }
    }
  },
  {
    name: 'update_project_settings',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Update one or more Godot project settings. Pass a dictionary of setting paths to their new values. Use list_settings first to discover available setting paths, current values, and valid options for a category. For input action bindings, prefer configure_input_map — if you do pass input/* keys here, partial updates are merged safely (existing events are preserved). Use this rather than editing project.godot as text: a running editor keeps its own copy in memory and will overwrite a text edit without noticing it.",
    inputSchema: {
      type: 'object',
      properties: {
        settings: {
          type: 'object',
          description: 'Dictionary of setting paths to new values (e.g., {"display/window/size/viewport_width": 1920, "display/window/size/viewport_height": 1080})'
        }
      },
      required: ['settings']
    }
  },
  {
    name: 'set_main_scene',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: "Set the project's main scene (application/run/main_scene) — the scene that runs on F5 or a no-argument run_scene. Validates that the scene exists and is a .tscn before writing project.godot. A focused, safer shortcut for this common edit (update_project_settings can also do it).",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'res:// path to the .tscn to make the main scene' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'sync_localization',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Sync a translation CSV with the project\'s localization settings. Reads the CSV (first column = keys, one column per locale), reports every key missing a translation per locale plus duplicate keys, then registers the .translation files Godot generated under internationalization/locale/translations — the manual step that silently makes a language never load if you forget it. Existing entries are preserved. If a locale has not been imported yet, the result says so and tells you to rescan. Use dry_run to audit without writing.',
    inputSchema: {
      type: 'object',
      properties: {
        csv_path: { type: 'string', description: 'Path to the translation CSV, e.g. res://i18n/strings.csv' },
        dry_run: { type: 'boolean', description: 'Only report (missing keys, what would be registered) without changing project settings. Default false.' }
      },
      required: ['csv_path']
    }
  },
  {
    name: 'configure_input_map',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Add, remove, or replace input actions and their key/button bindings. Use get_input_map to see current actions before modifying.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string', enum: ['add', 'remove', 'set'],
          description: '"add" to create action and/or append events, "remove" to delete the action entirely, "set" to replace all events on an action (creates it if needed)'
        },
        action: {
          type: 'string',
          description: 'Input action name (e.g., "move_left", "jump", "attack")'
        },
        deadzone: {
          type: 'number',
          description: 'Action deadzone (default: 0.5)'
        },
        events: {
          type: 'array',
          description: 'Input events to bind. Each object needs a "type" field: {"type":"key","key":"Space"} for keyboard, {"type":"mouse_button","button_index":1} for mouse (1=left,2=right,3=middle), {"type":"joypad_button","button_index":0} for gamepad, {"type":"joypad_motion","axis":0,"axis_value":1.0} for gamepad axis.',
          items: { type: 'object', description: 'An input event descriptor with a "type" field and type-specific properties' }
        }
      },
      required: ['action', 'operation']
    }
  },
  {
    name: 'run_scene',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Launch a scene in the Godot editor. By default the call BLOCKS until the editor flips to playing state (so the next get_errors / take_screenshot / send_input call sees a real game). The response includes started, runtime_connected, wait_for_started_ms, wait_for_runtime_ms, scene_path, and runtime_root. Use runtime_root (e.g. "/root/Main") as the prefix for query_runtime_node node_path arguments \u2014 it is computed from the actual root node name in the .tscn, NOT from the file name. Set wait_for_runtime=true to additionally wait for the in-game MCPRuntime helper to connect (required before take_screenshot / send_input will work). Recommended testing loop: run_scene({wait_for_runtime:true}) \u2192 query_runtime_node / send_input / take_screenshot \u2192 get_errors \u2192 stop_scene.',
    inputSchema: {
      type: 'object',
      properties: {
        scene: {
          type: 'string',
          description: 'Scene to run: omit for main scene, "current" for the currently open scene, or a res:// path for a specific scene'
        },
        block_until_started: {
          type: 'boolean',
          description: 'Wait until the editor reports playing=true before returning (default: true). Up to startup_timeout_ms.'
        },
        wait_for_runtime: {
          type: 'boolean',
          description: 'Wait until the MCPRuntime in-game helper connects back (required for take_screenshot/send_input). Default: false.'
        },
        startup_timeout_ms: {
          type: 'number',
          description: 'A cap, not an expected wait: MCPRuntime connects in about 1.6-1.7s (measured). Default 20000, generous for a cold-cache import. If wait_for_runtime reports false, poll get_runtime_status — the connection is usually about to land.'
        },
        attach_debugger: {
          type: 'boolean',
          description: "Default true (the editor's Play). Set false to run the game as its own process with no debugger: a game_eval runtime error then answers as a result instead of halting the game, at the cost of debug_* stepping and get_errors' Debugger>Errors source. See guide 'troubleshooting'."
        },
        debug_collisions: {
          type: 'boolean',
          description: 'Turn on SceneTree.debug_collisions_hint for this run, so CollisionShape2D/3D outlines are drawn — take_screenshot / render_scene_preview will then show them. Has to be set before this call, not after: flipping it mid-session is documented as unreliable, so this only takes effect on the run it is passed to. Default: false.'
        }
      }
    }
  },
  {
    name: 'stop_scene',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Stop the currently running scene in the Godot editor. Always stop the scene before editing code to avoid errors repeating every frame.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'is_playing',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Compatibility shim: returns {playing, scene}. For richer info (uptime, runtime helper connectivity, last-launched target) prefer get_runtime_status.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_runtime_status',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Combined editor + runtime status snapshot. Returns playing, playing_scene, last_launched ("current"|"main"|res-path), uptime_ms since the most recent run_scene (counted for a detached game too, which reports playing:false), detached_pid when one is running, and runtime_helper_connected (true once the in-game MCPRuntime autoload is talking to the MCP server).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wait',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Sleep server-side. Useful between input events to let the game process them. Capped at 30000ms / 30s. Pass either ms or seconds (ms wins if both given).',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (1..30000).' },
        seconds: { type: 'number', description: 'Seconds to wait (0.001..30). Convenient when the agent is thinking in seconds.' }
      }
    }
  },
  {
    name: 'take_screenshot',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Capture the current viewport of the running game and save it as a PNG. REQUIRES the game to be running with the MCPRuntime autoload connected (run_scene with wait_for_runtime=true first). Returns resource_path, absolute_path, width, height, and (optionally) base64_png. Default save location is res://addons/godot_mcp/cache/screenshots/.',
    inputSchema: {
      type: 'object',
      properties: {
        save_to: { type: 'string', description: 'Optional res:// or user:// destination path. Defaults to res://addons/godot_mcp/cache/screenshots/screenshot_<ms>.png' },
        return_base64: { type: 'boolean', description: 'Also include the PNG bytes inline as base64 (default: false). Useful when the agent has no filesystem access.' }
      }
    }
  },
  {
    name: 'send_input',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Synthesize an InputEvent and dispatch it to the running game via Input.parse_input_event. REQUIRES the game to be running with the MCPRuntime autoload connected. Use this to drive automated tests: click buttons, press keys, fire input actions. For multi-step interactions, alternate send_input \u2192 wait \u2192 query_runtime_node / take_screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        event: {
          type: 'object',
          description: 'InputEvent descriptor:\n  Key: {type:"key", key:"Space", pressed:true, shift?:bool, ctrl?:bool, alt?:bool} or {type:"key", keycode:32, pressed:true}\n  Mouse button: {type:"mouse_button", button_index:1, pressed:true, position:{x,y}, double_click?:bool} (1=left, 2=right, 3=middle)\n  Mouse motion: {type:"mouse_motion", position:{x,y}, relative?:{x,y}}\n  Action (named input from the InputMap): {type:"action", action:"jump", pressed:true, strength?:1.0}\n  Gamepad button: {type:"joypad_button", device?:0, button_index:0, pressed:true, pressure?:1.0}\n  Gamepad axis: {type:"joypad_motion", device?:0, axis:0, axis_value:1.0} (-1..1)\n  Touch: {type:"screen_touch", index?:0, pressed:true, position:{x,y}}\n  Touch drag: {type:"screen_drag", index?:0, position:{x,y}, relative?:{x,y}, velocity?:{x,y}}'
        }
      },
      required: ['event']
    }
  },
  {
    name: 'query_runtime_node',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Query a live node in the running scene tree. REQUIRES the game to be running with the MCPRuntime autoload connected. Returns class, path, valid, groups, and a map of property values. By default returns position, global_position, rotation, scale, visible, modulate \u2014 pass `properties:["..."]` to override. Set include_children=true to also list direct child nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Absolute path (e.g. /root/Main/Player) or relative to current_scene.' },
        properties: { type: 'array', items: { type: 'string' }, description: 'Property names to read. Default: position, global_position, rotation, scale, visible, modulate.' },
        include_children: { type: 'boolean', description: 'List direct children {name, class}. Default: false.' },
        include_groups: { type: 'boolean', description: 'Include the node\'s group memberships. Default: true.' }
      },
      required: ['node_path']
    }
  },
  {
    name: 'get_runtime_log',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Return entries from the MCPRuntime in-game ring buffer. The buffer holds the last ~500 lines pushed via MCPRuntime.push_runtime_log(level, text) from your scripts plus internal connection events. For full engine stdout (script prints, errors, warnings) use get_console_log \u2014 the editor already captures the running game\'s stdout. Returns entries with ts_ms, level, and text plus started_at_ms (when the helper started) and now_ms.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum entries to return (default: 200, max 500)' },
        since_ms: { type: 'number', description: 'Only return entries with ts_ms >= since_ms. Use 0 (default) for all.' },
        level: { type: 'string', enum: ['error', 'warning', 'info'], description: 'Only return entries of this level (e.g. "error", "warning", "info"). Omit for all.' }
      }
    }
  },
  {
    name: 'connect_signal_runtime',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Connect a signal between two live nodes in the running game (not persisted to the .tscn — resets on next run_scene). REQUIRES the game to be running with MCPRuntime connected. Node paths are absolute ("/root/Main/Player") or relative to the current scene.',
    inputSchema: {
      type: 'object',
      properties: {
        from_node_path: { type: 'string', description: 'Path to the emitting node' },
        signal: { type: 'string', description: 'Signal name on the emitting node' },
        to_node_path: { type: 'string', description: 'Path to the receiving node' },
        method: { type: 'string', description: 'Method name on the receiving node' }
      },
      required: ['from_node_path', 'signal', 'to_node_path', 'method']
    }
  },
  {
    name: 'disconnect_signal_runtime',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Disconnect a runtime-only signal connection made with connect_signal_runtime. REQUIRES the game to be running with MCPRuntime connected. No-op if not connected.',
    inputSchema: {
      type: 'object',
      properties: {
        from_node_path: { type: 'string', description: 'Path to the emitting node' },
        signal: { type: 'string', description: 'Signal name on the emitting node' },
        to_node_path: { type: 'string', description: 'Path to the receiving node' },
        method: { type: 'string', description: 'Method name on the receiving node' }
      },
      required: ['from_node_path', 'signal', 'to_node_path', 'method']
    }
  },
  {
    name: 'tween_property_runtime',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Create a Tween on a live node and animate a property to final_value over duration seconds, via node.create_tween().tween_property(...). REQUIRES the game to be running with MCPRuntime connected. Fire-and-forget — does not block waiting for the tween to finish.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Path to the node to tween' },
        property: { type: 'string', description: 'Property to animate, e.g. "position" or "modulate"' },
        final_value: { description: 'Target value. {x,y} for Vector2, {x,y,z} for Vector3, {r,g,b,a} for Color, or a plain number' },
        duration: { type: 'number', description: 'Tween duration in seconds (default: 1.0)' }
      },
      required: ['node_path', 'property', 'final_value']
    }
  },
  {
    name: 'play_animation_runtime',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Call AnimationPlayer.play(animation_name) on a live AnimationPlayer node in the running game. REQUIRES the game to be running with MCPRuntime connected.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Path to the AnimationPlayer node' },
        animation_name: { type: 'string', description: 'Animation to play' }
      },
      required: ['node_path', 'animation_name']
    }
  },
  {
    name: 'dump_control_tree',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List Control nodes in the running game with their global screen rects, so an agent can inspect a UI layout without a screenshot. REQUIRES the game to be running with MCPRuntime connected. Walks the tree recursively starting at root_path (default: current scene) and returns name, class, path, rect ({x,y,width,height} in global/screen coordinates), visible, focus_mode, and mouse_filter for each Control found.',
    inputSchema: {
      type: 'object',
      properties: {
        root_path: { type: 'string', description: 'Node to start the walk from. Absolute path or relative to current_scene. Default: current scene root.' },
        only_visible: { type: 'boolean', description: 'Only include Controls that are visible in tree (default: true). Set false to also see hidden ones.' }
      }
    }
  },
  {
    name: 'click_control_runtime',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Click a Control by node_path OR by its visible text, instead of by screen coordinates — resolves the Control\'s global rect center and dispatches a mouse button press+release there via Input.parse_input_event. REQUIRES the game to be running with MCPRuntime connected. Passing `text` clicks the button the way a human tester would ("click Start"), without you having to find its path first; if the text matches several visible controls the call fails and lists them rather than guessing.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Path to the Control to click. Absolute path or relative to current_scene.' },
        text: { type: 'string', description: 'Alternative to node_path: click the visible Control whose text/tooltip/placeholder contains this (case-insensitive). Must match exactly one control.' },
        exact: { type: 'boolean', description: 'With `text`, require an exact match instead of a substring. Default false. Use it to disambiguate.' },
        button_index: { type: 'number', description: 'Mouse button index (default: 1 = left; 2 = right, 3 = middle).' }
      }
    }
  },
  {
    name: 'assert_screen_text',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Assert that some text is (or is not) on screen in the running game. Searches the live Control tree — text, tooltip and placeholder properties — so it works headless and needs no OCR or screenshot comparison. Returns passed/found plus where it matched. This is the assertion that ends most UI flows: click through, then check the label the player should now see. REQUIRES the game to be running with MCPRuntime connected. A Control that paints its own text (custom _draw) cannot be found this way.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to look for (case-insensitive substring by default).' },
        should_exist: { type: 'boolean', description: 'Set false to assert the text is ABSENT. Default true.' },
        exact: { type: 'boolean', description: 'Require an exact match instead of a substring. Default false.' },
        visible_only: { type: 'boolean', description: 'Only count controls actually visible in the tree. Default true.' }
      },
      required: ['text']
    }
  },
  {
    name: 'get_focused_control',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Return the Control currently holding keyboard/gamepad focus in the running game\'s viewport (via Viewport.gui_get_focus_owner()). REQUIRES the game to be running with MCPRuntime connected. Returns focused:false if nothing is focused.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'monitor_properties',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Record a time-series of one or more properties on a live node, one sample per frame for N frames, in the running game. Verifies motion/physics/interpolation (e.g. "did velocity ramp then settle?") WITHOUT screenshots. REQUIRES the game running with MCPRuntime connected. Property paths accept get_indexed() sub-paths like "position:x". Optional `setup_code` runs once before the first sample, in the same call — use it to trigger the event being measured with zero round-trip gap (readOnlyHint is false because of this). Returns {samples:[{frame, t_msec, values:{prop:value}}], setup_result?}.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Path to the node to monitor (absolute /root/... or relative to current_scene)' },
        properties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Property paths to sample each frame, e.g. ["position", "velocity:y", "modulate:a"]. Sub-paths use get_indexed() colon syntax.'
        },
        frames: { type: 'number', description: 'Number of frames to sample (1..1200, default 60). At 60fps, 60 frames ≈ 1 second.' },
        setup_code: { type: 'string', description: 'Optional game_eval-style snippet (function body, same `tree`/`node` scope as `node_path`) run once, synchronously, before the first sample — in the same call that starts sampling. Use this to trigger the event being measured (e.g. "node.jump()") so no round trip is lost between triggering it and starting to watch: without it, a sub-second event (a 0.7s jump arc, a 0.1s input buffer) can be entirely over before a separate monitor_properties call lands.' }
      },
      required: ['node_path', 'properties']
    }
  },
  {
    name: 'batch_runtime',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Run several RUNTIME tools inside the running game in ONE round trip. Driving a game is inherently several calls — press, look, press, look — and each one is a WebSocket round trip while the game keeps running underneath; batch_execute covers the editor side and could never reach these. Synchronous runtime tools only: step_frames, wait, await_condition, await_signal_runtime, monitor_properties and replay_input_sequence answer later through their own job queues and are refused by name, with a pointer to the tool that already does that shape (monitor_properties takes setup_code; replay_input_sequence IS batched input). Runs in order, returns one result per operation positionally. REQUIRES the game running with MCPRuntime connected.",
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Ordered list of {tool, args}, max 50. e.g. [{"tool":"send_input","args":{...}}, {"tool":"query_runtime_node","args":{"node_path":"/root/Main/Player"}}]',
          items: { type: 'object', description: '{ tool: string, args: object }' }
        },
        stop_on_error: { type: 'boolean', description: 'Stop at the first operation that fails. Default false (run them all).' },
        settle_frames: { type: 'number', description: 'Let this many physics frames pass after the operations before answering. This is what makes "press, let the game move, look" one call: `wait` and `step_frames` answer later and so cannot be operations inside a batch. Default 0 (answer immediately).' }
      },
      required: ['operations']
    }
  },
  {
    name: 'game_eval',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Run a GDScript snippet inside the RUNNING game (like a REPL) and return the result. The snippet is a function body that receives `tree` (the SceneTree) and `node` (the node at node_path, or null); use `return X` to get a value back. Powerful for driving/inspecting live state (e.g. `return tree.get_nodes_in_group(\"enemies\").size()` or `node.velocity = Vector2(100,0)`). REQUIRES the game running with MCPRuntime. A runtime error inside the snippet cannot be caught and will time out the call — the compile step is guarded, execution is on you. Where its output lands, measured: print() goes to the game's own stdout, while push_error and push_warning travel the debugger channel and come back through get_errors - NOT through get_console_log, which is the EDITOR's Output panel.",
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'GDScript snippet (a function body). Use `return X` to return a value.' },
        node_path: { type: 'string', description: 'Optional node to expose as `node` in the snippet (absolute /root/... or relative to current_scene).' }
      },
      required: ['code']
    }
  },
  {
    name: 'replay_input_sequence',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Play a scripted sequence of input events into the RUNNING game at specific frames — deterministic, frame-based playback for reproducible playtests. Each item is {at_frame, event} where event has the same shape as send_input (e.g. {type:\"key\", keycode:4194321, pressed:true} or {type:\"mouse_button\", button_index:1, pressed:true, position:{x,y}}). Combine with monitor_properties / serialize_runtime_tree to assert the outcome. REQUIRES the game running with MCPRuntime. Returns once playback + settle_frames complete.",
    inputSchema: {
      type: 'object',
      properties: {
        sequence: {
          type: 'array',
          description: 'Ordered input events, each {at_frame: number, event: <send_input event object>}. at_frame is relative to replay start.',
          items: { type: 'object', description: '{ at_frame: number, event: { type, ... } }' }
        },
        settle_frames: { type: 'number', description: 'Extra frames to run after the last event before returning (default 10, 0..1200).' }
      },
      required: ['sequence']
    }
  },
  {
    name: 'start_input_recording',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Start capturing input events in the RUNNING game into a replay_input_sequence payload. Play (or drive) the game, then stop_input_recording returns the {sequence} you can feed straight to replay_input_sequence to reproduce the session deterministically. Mouse motion is skipped by default (it floods) — set include_mouse_motion to keep it. REQUIRES the game running with MCPRuntime.",
    inputSchema: {
      type: 'object',
      properties: {
        include_mouse_motion: { type: 'boolean', description: 'Record mouse-motion events too (default false — they flood the recording).' }
      }
    }
  },
  {
    name: 'stop_input_recording',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Stop an input recording started by start_input_recording and return { count, sequence }. The sequence is ready to pass to replay_input_sequence. REQUIRES the game running with MCPRuntime.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_multiplayer_status',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Report the running game's high-level multiplayer state: this peer's unique_id, whether it's the server, connected peer ids, and the transport connection status. Works even offline (reports single-player). REQUIRES the game running with MCPRuntime. The read half of a networking test loop.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'call_rpc_runtime',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Call an @rpc method on a node via rpc()/rpc_id() in the running game. peer_id 0 (default) broadcasts to all peers; a specific id targets one. Returns the RPC dispatch error code. Actual delivery depends on the multiplayer setup (offline it runs locally if you're the authority). REQUIRES the game running with MCPRuntime.",
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Node that owns the @rpc method (absolute /root/... or relative to current_scene).' },
        method: { type: 'string', description: '@rpc method name to call.' },
        args: { type: 'array', description: 'Positional arguments (parsed like other runtime values).', items: {} },
        peer_id: { type: 'number', description: 'Target peer id; 0 (default) broadcasts to everyone.' }
      },
      required: ['node_path', 'method']
    }
  },
  {
    name: 'call_method_runtime',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Call a method on a node in the RUNNING game and return its result — the general way to trigger game logic or query live state (e.g. call \"take_damage\" with args [10], or \"get_health\"). REQUIRES the game running with MCPRuntime. Args are parsed like other runtime values ({x,y}→Vector2, etc.).",
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Node to call on (absolute /root/... or relative to current_scene).' },
        method: { type: 'string', description: 'Method name to invoke.' },
        args: { type: 'array', description: 'Positional arguments (parsed: {x,y}→Vector2, {r,g,b}→Color, etc.).', items: {} }
      },
      required: ['node_path', 'method']
    }
  },
  {
    name: 'set_runtime_property',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Set a property on a live node in the RUNNING game and read it back. Supports get_indexed() sub-paths like \"position:x\" or \"modulate:a\". Use it to drive game state for a test (e.g. teleport the player, set a flag). REQUIRES the game running with MCPRuntime. query_runtime_node is the read counterpart.",
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Node to set on (absolute /root/... or relative to current_scene).' },
        property: { type: 'string', description: 'Property path, e.g. "position" or a sub-path "position:x".' },
        value: { description: 'New value (parsed: {x,y}→Vector2, {r,g,b}→Color, etc.).' }
      },
      required: ['node_path', 'property', 'value']
    }
  },
  {
    name: 'await_signal_runtime',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Wait for a signal to fire on a live node in the RUNNING game, or until timeout_ms elapses. Returns {signal_fired, timed_out} — lets an agent assert event-driven behaviour (\"did the player emit 'died' within 2s?\") instead of polling. REQUIRES the game running with MCPRuntime.",
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Node that owns the signal (absolute /root/... or relative to current_scene).' },
        signal: { type: 'string', description: 'Signal name to wait for.' },
        timeout_ms: { type: 'number', description: 'Give up after this many ms (1..60000, default 3000).' }
      },
      required: ['node_path', 'signal']
    }
  },
  {
    name: 'step_frames',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Advance the RUNNING game an exact number of frames, then return. Use this instead of `wait` whenever the result is asserted on: `wait` counts wall-clock milliseconds, so how much simulation happens depends on the machine's frame rate and the same test drifts between runs and machines. Defaults to physics frames, which are what move bodies and tick at a fixed rate. Returns {frames, mode, elapsed_ms}. REQUIRES the game running with MCPRuntime.",
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['physics', 'process'], description: '"physics" (default, fixed rate — use this for game state) or "process" (render frames).' },
        frames: { type: 'number', description: 'How many frames to advance (1..3600, default 1).' },
      }
    }
  },
  {
    name: 'await_condition',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Wait until an expression becomes true in the RUNNING game, or until timeout_ms elapses. Use when what you are waiting for is a STATE rather than a signal (\"until the player is on the floor\", \"until no enemies are left\") — await_signal_runtime needs a signal to exist, and a fixed `wait` guesses. It is an EXPRESSION, not a function body: write `node.is_on_floor()`, not `return node.is_on_floor()`. `tree` and `node` are in scope, and it is evaluated once per physics frame. Empty arrays and dictionaries count as false. Returns {met, value, frames_waited, elapsed_ms} — met:false on timeout is a normal result, not an error, and `value` shows what it last evaluated to. REQUIRES the game running with MCPRuntime.",
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'string', description: 'Expression to evaluate, e.g. "node.is_on_floor()" or "tree.get_nodes_in_group(\\"enemies\\").is_empty()". No `return`.' },
        node_path: { type: 'string', description: 'Optional node bound to `node` in the expression (absolute /root/... or relative to current_scene).' },
        timeout_ms: { type: 'number', description: 'Give up after this many ms (1..60000, default 5000).' }
      },
      required: ['condition']
    }
  },
  {
    name: 'seed_rng',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Seed the RUNNING game's global random number generator so a run involving chance can be replayed. Call it before driving the game to make a flaky-looking test reproducible. Seeds the global functions only (randi, randf, randi_range, ...) — a RandomNumberGenerator the game created itself keeps its own state, and the result says so. REQUIRES the game running with MCPRuntime.",
    inputSchema: {
      type: 'object',
      properties: {
        seed: { type: 'number', description: 'Integer seed. Reuse the same value to replay a run.' }
      },
      required: ['seed']
    }
  },
  {
    name: 'time_scale',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Speed up or slow down the RUNNING game (Engine.time_scale). Useful to fast-forward a long animation or timer instead of waiting for it, or to slow one down to inspect it. 0 freezes simulation without pausing the tree, so step_frames still advances. Clamped to 0..10 — above that physics tunnels through colliders instead of fast-forwarding. Remember to set it back to 1. REQUIRES the game running with MCPRuntime.",
    inputSchema: {
      type: 'object',
      properties: {
        scale: { type: 'number', description: '1.0 = normal, 0.5 = half speed, 2.0 = double, 0 = frozen. Clamped to 0..10.' }
      },
      required: ['scale']
    }
  },
  {
    name: 'serialize_runtime_tree',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Snapshot the RUNNING scene tree to JSON: name and class per node, recursively, optionally with a chosen set of properties on each node. Full-state introspection without screenshots — good for asserting or diffing game state. REQUIRES the game running with MCPRuntime.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: { type: 'string', description: 'Root to snapshot from (absolute /root/... or relative to current_scene). Default: current_scene.' },
        max_depth: { type: 'number', description: 'How deep to recurse (1..20, default 5). Deeper nodes report a children_truncated count.' },
        properties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional property names to include on each node, e.g. ["position", "visible"].'
        }
      }
    }
  },
  {
    name: 'classdb_query',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Query Godot\'s ClassDB for class information: properties, methods, signals, and inheritance. Use this to verify that a class, method, or property actually exists in the running Godot engine before writing code. Prevents using wrong method names, outdated Godot 3 API, or incorrect signatures.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: {
          type: 'string',
          description: 'Godot class name to query (e.g., "CharacterBody2D", "Sprite2D", "Control")'
        },
        query: {
          type: 'string', enum: ['all', 'properties', 'methods', 'signals'],
          description: 'What to return: "all" (default), "properties", "methods", or "signals"'
        },
        include_virtual: {
          type: 'boolean',
          description: 'Include well-known virtual methods like _ready, _process, _input (default: true). Set to false to see only public non-virtual methods.'
        },
        filter: {
          type: 'string',
          description: 'Case-insensitive substring: only members whose name contains it are returned. Use when checking for a specific method/property (e.g. "velocity") on a big class — cuts the output massively.'
        }
      },
      required: ['class_name']
    }
  },
  {
    name: 'rescan_filesystem',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Trigger a full filesystem rescan in the Godot editor. Use after creating, deleting, or modifying files externally (e.g. from the terminal or another tool). The scan is asynchronous and returns immediately. NOT enough for a new autoload or a new class_name — those need restart_editor.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'render_scene_preview',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Render a 2D scene to a PNG WITHOUT running the game — the cheap way to actually look at a scene. take_screenshot needs a live game (launch, runtime connection, remembering to stop it); this renders offscreen in the editor, auto-framing the scene's content, and leaves no editor state changed. Use it to check layout, sprite placement, and whether a level looks like you think it does. 2D only.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene to render (res://path/to/scene.tscn)' },
        save_to: { type: 'string', description: 'Where to write the PNG. Defaults to res://addons/godot_mcp/cache/previews/<scene>.png' },
        width: { type: 'number', description: 'Output width in pixels. Default 1152.' },
        height: { type: 'number', description: 'Output height in pixels. Default 648.' },
        transparent: { type: 'boolean', description: 'Transparent background instead of the scene\'s own. Default false.' },
        show_collision: { type: 'boolean', description: 'Draw CollisionShape2D/CollisionPolygon2D outlines (same visual as Godot\'s Debug > Visible Collision Shapes), so hitboxes can be checked from the PNG directly. Default false.' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'restart_editor',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Restart the Godot editor. Needed for two things a rescan cannot fix: an AUTOLOAD added this session, and a brand-new class_name. Until the editor restarts, every script referencing them fails to compile — and a node whose script failed to compile loses its exported properties, so create_scene/add_node write defaults and still report ok. Symptom: you set a property, the call succeeds, and the value is wrong when you read it back. The bridge disconnects with the editor; poll get_godot_status until it reconnects (usually 20-40s).",
    inputSchema: {
      type: 'object',
      properties: {
        save: { type: 'boolean', description: 'Save all open scenes and project settings before restarting. Default true. Setting false discards unsaved editor work.' }
      }
    }
  },
  {
    name: 'undo_last',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Undo the editor's most recent action — the same stack Ctrl+Z drives. Mutating tools that edit an OPEN scene register an entry there, so this takes back your own last edit without the developer touching the keyboard. Two caveats: the history is GLOBAL, so if the developer acted after you did, this undoes THEIR action first (the response names what was actually undone — check it); and edits written straight to disk on a scene that is NOT open have no undo entry at all, so this will not reach them.",
    inputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'How many actions to step back (default 1). Stops early if the history runs out.' }
      }
    }
  },
  {
    name: 'redo_last',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Redo the action most recently undone, mirroring undo_last. Same global-history caveat: it redoes whatever is next on the editor's stack, which may not be yours.",
    inputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'How many actions to step forward (default 1). Stops early if the history runs out.' }
      }
    }
  },
  {
    name: 'get_uid',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Get the res:// UID (uid://...) for a resource file (Godot 4.4+). Useful for writing UID-based references instead of path-based ones. Fails if the file has not been imported yet or UIDs are not supported for its type.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the resource file (e.g., res://scenes/player.tscn)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'setup_autoload',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: "Register, unregister, or list autoload singletons. Autoloads are scripts/scenes loaded automatically at project start. ALWAYS use this rather than writing project.godot as text: a running editor holds its own copy of that file, so a text edit is invisible to it and gets overwritten the next time the editor saves. After adding one, call restart_editor — until the editor restarts, every script referencing the new singleton fails to compile, and a node whose script failed to compile silently loses its exported properties.",
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string', enum: ['add', 'remove', 'list'],
          description: '"add" to register, "remove" to unregister, "list" to show all autoloads'
        },
        name: {
          type: 'string',
          description: 'Autoload name (e.g., "GameManager", "AudioManager")'
        },
        path: {
          type: 'string',
          description: 'res:// path to the script or scene file (required for "add")'
        }
      },
      required: ['operation']
    }
  },
  {
    name: 'remove_autoload',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Unregister an autoload singleton by name. Counterpart to setup_autoload({operation:"remove"}).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Autoload name to remove' }
      },
      required: ['name']
    }
  },
  {
    name: 'get_editor_selection',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Get the nodes currently selected in the Godot editor scene tree. Returns node_path (relative to the edited scene) and node_type for each. Requires a live editor session.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'select_nodes',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Select the given nodes in the Godot editor scene tree, replacing the current selection. scene_path must match the currently open edited scene. Requires a live editor session.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the currently open edited scene' },
        node_paths: { type: 'array', items: { type: 'string' }, description: 'Node paths (relative to the scene root) to select' }
      },
      required: ['scene_path', 'node_paths']
    }
  },
  {
    name: 'clear_editor_selection',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: 'Clear the current selection in the Godot editor scene tree. Requires a live editor session.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'close_scene_tab',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Close a scene tab in the editor. If the scene isn\'t the currently-focused tab, it\'s focused first (via open_scene_from_path) then closed — EditorInterface.close_scene() only closes the active tab. Refuses if the scene has unsaved changes unless force=true.',
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Path to the scene file to close (res://path/to/scene.tscn)' },
        force: { type: 'boolean', description: 'Discard unsaved changes and close anyway (default: false)' }
      },
      required: ['scene_path']
    }
  },
  {
    name: 'save_scene',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: "Write an OPEN scene's unsaved editor state to its .tscn file. Needed because every mutating tool edits the LIVE editor tree when its target scene is open — that is what stops it clobbering the developer's unsaved work — and those edits stay in the editor until something saves them. Without this, editing an open scene and then calling run_scene tests the file as it was BEFORE the edit. Omit scene_path to save the scene the developer is currently looking at. Not needed for a CLOSED scene: tools write those to disk directly. Use close_scene_tab instead when the goal is to DISCARD the edits.",
    inputSchema: {
      type: 'object',
      properties: {
        scene_path: { type: 'string', description: 'Scene to save (res://path/to/scene.tscn). Must be open in the editor. Defaults to the currently-edited scene.' }
      }
    }
  },
  {
    name: 'get_performance_monitors',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read a snapshot of engine performance monitors: fps, process_time, physics_process_time, memory_static, object_count, object_node_count, render_total_draw_calls_in_frame, physics_2d_active_objects, physics_3d_active_objects.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_editor_performance',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read a small performance subset: fps and memory_static_mb.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'create_resource',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Instantiate a Resource-derived class and save it to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_path: { type: 'string', description: 'Path to save the resource (res://path/to/resource.tres)' },
        resource_type: { type: 'string', description: 'Resource class name (e.g. "Curve", "Gradient", "AudioStreamRandomizer")' }
      },
      required: ['resource_path', 'resource_type']
    }
  },
  {
    name: 'list_export_presets',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'List export presets defined in export_presets.cfg (index, name, platform, runnable, export_path). Returns an empty list (not an error) if the project has no export_presets.cfg yet.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_export_info',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Get all configuration keys/values for one export preset from export_presets.cfg, including its .options sub-section. Use list_export_presets first to find preset_index.',
    inputSchema: {
      type: 'object',
      properties: {
        preset_index: { type: 'number', description: 'Preset index (from list_export_presets)' }
      },
      required: ['preset_index']
    }
  },
  {
    name: 'export_project',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Build the project via a headless "shadow workspace": the project is cloned to a temp dir and a separate `godot --headless --export-*` subprocess exports it there (the live dir is never exported directly). Saves all scenes first. Requires an export preset (see list_export_presets) and the matching export templates installed (Project > Export > Manage Export Templates) — a missing template surfaces as exit_code != 0 with the reason in the returned `log`. Give the preset by name or index and an output_path.',
    inputSchema: {
      type: 'object',
      properties: {
        preset_name: { type: 'string', description: 'Export preset name (as shown in list_export_presets). Either this or preset_index.' },
        preset_index: { type: 'number', description: 'Export preset index (from list_export_presets). Used if preset_name is omitted.' },
        output_path: { type: 'string', description: 'Where to write the build: a res:// path (e.g. res://build/game.exe) or an absolute path.' },
        debug: { type: 'boolean', description: 'Export a debug build (--export-debug) instead of release. Default false.' }
      },
      required: ['output_path']
    }
  },
  {
    name: 'get_export_status',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Poll a background export started by export_project. Pass the job_id it returned. Status is "running" until the headless build finishes, then "done" (with the artifact path) or "failed" (with exit_code and a log tail explaining why).',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job_id returned by export_project.' }
      },
      required: ['job_id']
    }
  }
];
