# Tool guides

Static copy of the guides the running server exposes as MCP resources
(`godot-mcp://guide/<slug>`) and through the `get_guide` tool, so you can read
them here without installing anything first. Source of truth is
[`mcp-server/src/resources.ts`](../mcp-server/src/resources.ts) — if the two
ever disagree, that file wins.

## Contents

- [Quick tool index by goal](#quick-tool-index-by-goal)
- [Scene editing patterns](#scene-editing-patterns)
- [Testing loop for running games](#testing-loop-for-running-games)
- [Step-debugging a failure](#step-debugging-a-failure)
- [Generating 2D assets](#generating-2d-assets)
- [Troubleshooting common failures](#troubleshooting-common-failures)

---

## Quick tool index by goal

A flat goal-to-tool index optimized for "I want to do X — which tool?" lookups.

### Cannot find the tool
- Search all 230 by what you want to do, loaded or not: `find_tools({query})`.
  Only `core` (38) is loaded by default; the answer says which toolset to
  turn on with `enable_toolset`.

## Editing files / scripts
- Edit a small chunk of GDScript: `edit_script`
- Validate it parses: `validate_script`
- Create / delete / rename files: `create_script`, `delete_file` (requires `confirm:true`), `rename_file`
- List GDScripts: `list_scripts`

### Scenes
- Create / read / hierarchy: `create_scene`, `read_scene`, `scene_tree_dump`
- Add / remove / move / rename / duplicate / reorder nodes: `add_node`, `remove_node`, `move_node`, `rename_node`, `duplicate_node`, `reorder_node`
- Properties on a node: `modify_node_property` (one), `set_node_properties` (many), `read_scene` (read them back)
- Class-level property metadata: `get_node_properties` (with `node_type`)
- Groups: `set_node_groups`, `get_node_groups`, `find_nodes_in_group`
- Scripts on nodes: `attach_script`, `detach_script`
- Wiring a node into another node's exported slot: `set_node_reference` (an `@export var x: SomeNode` takes an object, so the property tools cannot set it)
- Resources on nodes: `set_collision_shape`, `set_sprite_texture`, `set_mesh`, `set_material`, `set_resource_property`, `save_resource_to_file`
- Resource introspection: `get_resource_info`
- Signals: `list_signal_connections` (source scene_file or runtime), `connect_signal`, `disconnect_signal`
- Instancing other scenes: `instance_scene`
- 3D math: `get_node_spatial_info`, `measure_node_distance`, `snap_node_to_grid`

### Project / editor
- Settings: `get_project_settings`, `list_settings`, `update_project_settings` (renames are safe)
- Input: `get_input_map`, `configure_input_map`
- Collision layers: `get_collision_layers`
- Autoloads: `setup_autoload`
- ClassDB: `classdb_query`
- Output / errors: `get_console_log`, `get_errors`, `clear_console_log`
- Filesystem: `rescan_filesystem`, `list_dir`, `read_file`, `search_project`
- Open in editor: `open_in_godot`
- Look at a scene WITHOUT running it: `render_scene_preview` (renders to PNG offscreen, auto-framed; `show_collision:true` draws the collision shapes)
- Where things actually SIT in a 2D scene: `analyze_2d_layout` — decoration floating above the ground, standing over a hole, or fused into a platform, plus every floor gap with its width (and whether a given jump clears it). The class of bug that is numerically plausible and visually broken.
- A texture's real content box: `texture_info` — size, alpha bbox, per-frame bbox, and whether the crop secretly contains two disconnected pieces
- Restart the editor: `restart_editor` (required after adding an autoload or a new `class_name` — a running editor registers neither, and scripts using them fail to compile until it restarts)

### Running the game
- Launch: `run_scene` (block_until_started, wait_for_runtime)
- Status: `is_playing`, `get_runtime_status`
- Runtime tools: `take_screenshot`, `send_input`, `query_runtime_node`, `get_runtime_log`, `wait`
- Stop: `stop_scene`

### Step-debugging (toolset `debug` — see [Step-debugging a failure](#step-debugging-a-failure))
- Breakpoints: `debug_set_breakpoints` (set them BEFORE launching)
- Start / attach: `debug_launch`, `debug_attach`
- Move: `debug_step` (over/in/out), `debug_continue`
- Inspect: `debug_stack_trace`, `debug_scopes`, `debug_variables`, `debug_evaluate`
- Session: `debug_status`, `debug_disconnect`

### Asset generation
- SVG -> PNG: `generate_2d_asset` (now with `width`, `height`, `scale`)

### Visualizer
- Project map: `map_project` (scripts, their structure, and what connects to what)

### TileMap
- Paint / read cells: `tilemap_set_cell`, `tilemap_get_cell`, `tilemap_fill_rect`, `tilemap_clear`
- Terrain autotiling: `tilemap_set_terrain_cells`
- Introspection: `tilemap_get_info`, `tilemap_get_used_cells`

### Animation (AnimationPlayer)
- List / create / remove: `list_animations`, `create_animation`, `remove_animation`
- Tracks and keys: `add_animation_track`, `set_animation_keyframe`
- Introspection: `get_animation_info`

### Audio
- Players: `add_audio_player` (AudioStreamPlayer/2D/3D)
- Buses: `add_audio_bus`, `get_audio_bus_layout`

### Physics
- Raycasts: `add_raycast` (RayCast2D/3D)
- Collision shapes: `setup_collision`
- Layers/masks: `set_physics_layers`, `get_collision_info`
- Presets: `get_collision_presets`, `set_collision_preset`, `apply_collision_preset`

### Theme / UI resources
- Create / inspect: `create_theme`, `get_theme_info`
- Overrides: `set_theme_color`, `set_theme_constant`, `set_theme_font_size`, `set_theme_stylebox`

### Particles (2D/3D)
- Create: `create_particles`
- Configure: `set_particle_material`, `set_particle_color_gradient`, `apply_particle_preset`
- Introspection: `get_particle_info`

### 3D Scene
- Meshes and lighting: `add_mesh_instance`, `setup_lighting`, `set_material_3d`
- Environment / camera: `setup_environment`, `setup_camera_3d`
- Tile-based 3D: `add_gridmap`

### Batch / Refactor
- Bulk property edits across matching nodes: `batch_set_property` (pairs with `find_nodes_by_type`)
- Find nodes: `find_nodes_by_type`
- Scene dependency graph: `get_scene_dependencies`
- Project-wide symbol rename: `rename_symbol_project_wide`

### Navigation
- Regions and baking: `setup_navigation_region`, `bake_navigation_mesh`
- Agents: `setup_navigation_agent`
- Layers: `set_navigation_layers`
- Introspection: `get_navigation_info`

### AnimationTree / state machines
- Create / inspect: `create_animation_tree`, `get_animation_tree_structure`
- States: `add_state_machine_state`, `remove_state_machine_state`
- Transitions: `add_state_machine_transition`, `remove_state_machine_transition`

### Shaders
- Create / read / edit: `create_shader`, `read_shader`, `edit_shader`
- Apply to a node: `assign_shader_material`
- Params: `set_shader_param`, `get_shader_params`

### Testing / QA (static, no running game required)
- Single assertion against saved scene state: `assert_node_property`
- Batch of assertions against one scene: `run_scene_assertions`
- Scan for empty required resource slots (shape/texture/stream never set): `validate_scene_integrity`

### UI runtime (requires a running game, see [testing loop](#testing-loop-for-running-games))
- Inspect Control tree: `dump_control_tree`
- Simulate a click: `click_control_runtime`
- Focused control: `get_focused_control`
- Tween a property live: `tween_property_runtime`
- Play an AnimationPlayer animation live: `play_animation_runtime`
- Wire / unwire a signal on the running tree (not persisted to .tscn): `connect_signal_runtime`, `disconnect_signal_runtime`

### Editor selection
- Read / set / clear the editor's node selection: `get_editor_selection`, `select_nodes`, `clear_editor_selection`
- Close an open scene tab: `close_scene_tab`

### Profiling
- Performance monitors: `get_performance_monitors`, `get_editor_performance`

### Export / build
- Presets: `list_export_presets`, `get_export_info`
- Run an export: `export_project`

---

## Scene editing patterns

When to use `add_node` vs `modify_node_property` vs `set_node_properties` vs `set_resource_property` vs the specialized resource tools.

### Pick the right tool

| Goal | Tool |
|---|---|
| Create scene with several nodes in one shot | `create_scene` with `nodes` tree |
| Add ONE node | `add_node` (now supports `script`, `groups`, `children`) |
| Add a SUBTREE | `add_node` with `children` |
| Change ONE simple value (position, modulate) | `modify_node_property` |
| Change MANY values on one node | `set_node_properties` |
| Change a Resource value (e.g. radius of a Shape, albedo of a Material) | `set_resource_property` |
| Replace the entire Resource (different mesh, different texture) | `set_mesh` / `set_sprite_texture` / `set_material` / `set_collision_shape` |
| Persist a node-attached resource as a .tres | `save_resource_to_file` |
| Group membership | `set_node_groups` (replace/add/remove) |
| Verify which nodes belong to a group | `find_nodes_in_group` |
| Wire up a signal (persisted to .tscn) | `connect_signal` |
| See what is wired | `list_signal_connections` (source: scene_file or runtime) |
| Inspect a resource on disk | `get_resource_info` (works for any Resource subclass) |

### Variant value formats

For any tool that takes a typed value (`modify_node_property.value`, `set_node_properties.properties`, `set_resource_property.value`), pass either a primitive or a discriminated object:

- `{type:"Vector2", x:1, y:2}`, `{type:"Vector3", x, y, z}`
- `{type:"Color", r, g, b, a}`
- `{type:"Quaternion", x, y, z, w}`
- `{type:"Basis", euler:{x, y, z}}`
- `{type:"Transform3D", basis:{...}, origin:{x, y, z}}`
- `{type:"AABB", position:{x,y,z}, size:{x,y,z}}`
- `{type:"Rect2", x, y, width, height}`

For Resource-typed properties, do not pass the value directly — use the resource-aware tools listed above.

---

## Testing loop for running games

How to drive a running game from the agent: `run_scene`, `send_input`, `query_runtime_node`, `take_screenshot`, `get_errors`.

The MCPRuntime autoload (registered automatically when the godot_mcp plugin is enabled) lets the agent inspect and drive a running game.

### Minimum viable loop

1. `run_scene({ wait_for_runtime: true })` — launches the scene and BLOCKS until the in-game helper connects. Inspect `runtime_connected` in the response; if false, take_screenshot/send_input will fail with a clear error.
2. `get_errors({ max_errors: 20 })` — catches startup crashes early.
3. Drive input. Examples:
   - Click a button: `send_input({ event: { type: 'mouse_button', button_index: 1, pressed: true, position: { x: 640, y: 360 } } })` followed by another with `pressed: false`.
   - Press a key: `send_input({ event: { type: 'key', key: 'Space', pressed: true } })`.
   - Trigger a named action: `send_input({ event: { type: 'action', action: 'jump', pressed: true } })`.
4. `wait({ ms: 200 })` between events to let the engine process them.
5. `query_runtime_node({ node_path: '/root/Main/Player', properties: ['position', 'velocity', 'visible'] })` — verify state changes.
6. `take_screenshot({})` — visual confirmation.
7. `stop_scene()` before editing code, or `get_errors` again to confirm clean shutdown.

### Cutting the round trips

Each of those steps is a WebSocket round trip while the game keeps running. When
several of them need no waiting in between, send them as one:

```
batch_runtime({ operations: [
  { tool: 'send_input', args: { event: { type: 'action', action: 'jump', pressed: true } } },
  { tool: 'query_runtime_node', args: { node_path: '/root/Main/Player', properties: ['position'] } },
] })
```

Measured on a live game: six calls, 43ms one at a time against 6ms batched. It
takes synchronous runtime tools only; anything that answers later (`wait`,
`step_frames`, `await_condition`, `await_signal_runtime`, `monitor_properties`,
`replay_input_sequence`) is refused by name, with a pointer to the tool that
already covers that shape.

## Driving a non-input-driven game (cutscene, idle simulation)

Skip step 3 and use `wait` + `query_runtime_node` + `take_screenshot` to sample the simulation at intervals.

### Common pitfalls

- Calling `take_screenshot` immediately after `run_scene` without `wait_for_runtime: true` returns "Runtime helper not connected".
- The runtime ring buffer (`get_runtime_log`) only contains entries pushed via `MCPRuntime.push_runtime_log(level, text)`. For full engine stdout use the editor's `get_console_log`.
- `send_input` with type `action` requires the action to exist in the InputMap (check with `get_input_map`).

---

## Step-debugging a failure

How to stop at a bug and read real values with the `debug_*` tools, instead of adding prints and re-running.

These drive Godot's built-in Debug Adapter (port 6006) directly from the MCP server — a different channel from every other tool here, which goes through the editor addon. They keep working when `get_godot_status` says the addon isn't connected, as long as the editor is open.

Enable them first: `enable_toolset({name: "debug"})`.

### The loop

1. `debug_set_breakpoints({path: "res://scenes/player.gd", lines: [17]})` — set breakpoints BEFORE launching. They are buffered and applied during the launch handshake. This REPLACES all breakpoints in that file; pass the full list you want, or `lines: []` to clear it.
2. `debug_launch({scene: "res://scenes/level.tscn", wait_ms: 25000})` — starts the game under the debugger. Check `state` in the response: `"stopped"` means a breakpoint was hit. Allow a generous wait_ms; a cold start plus shader compilation can take 20s+.
3. `debug_stack_trace()` — where it stopped, and the frame ids.
4. `debug_scopes()` → `debug_variables({variables_reference})` — the actual values. A returned entry with `variables_reference > 0` is expandable: call `debug_variables` again with that number to drill into an object.
5. `debug_evaluate({expression: "player.hp"})` — evaluate anything in the paused frame. This is the fastest way to test a hypothesis.
6. `debug_step({mode: "over"|"in"|"out"})` or `debug_continue()` — both wait for the program to settle again before returning, so the response already reflects the new position.
7. `debug_disconnect({terminate: true})` when done.

### When to reach for this instead of prints

Use the debugger when you need a value you don't already log: a wrong number, a null reference, a branch that shouldn't have been taken. Reading the real frame beats adding `print()`, re-running, and inferring — and it doesn't leave debug noise in the code.

Stick to `get_errors` / `get_console_log` when you just need the stack of a crash that already happened, or output the game already prints.

### Gotchas

- **Breakpoints in `_process`/`_physics_process` fire every frame.** `debug_continue` will land on the same line immediately. That is expected — clear the breakpoint first if you want to run on.
- **Conditional breakpoints may be ignored.** Godot's adapter does not advertise `supportsConditionalBreakpoints`; the `conditions` argument is passed through but the engine may break unconditionally. Verify rather than assume.
- **A dead session leaves the game running.** If a session ends abnormally, the game process can outlive it and the next `debug_launch` may terminate immediately instead of stopping. Call `stop_scene` (or close the window) first, and use `debug_status` to see the real state.
- **`debug_launch` refuses when a session is already active** — call `debug_disconnect` first, or `debug_continue` to resume the existing one.

---

## Generating 2D assets

How `generate_2d_asset` really works (no temp file, intrinsic dimensions) and the width / height / scale overrides.

The asset generator renders SVG markup directly to a Godot `Image` via `Image.load_svg_from_buffer` and saves a PNG. There is no temporary SVG file on disk and no dependency on `user://`, so concurrent calls and project-rename quirks cannot break it.

### Sizing modes

- Default: render the SVG at its intrinsic size (whatever `<svg width=... height=...>` declares).
- `{ scale: 2.0 }`: render at 2x.
- `{ width: 256 }` (or `height`): derive a uniform render scale from the SVG's intrinsic width/height. Pass either dimension; the other axis scales proportionally.

### Tips for clean SVG

- Either single or double quotes work in attributes.
- Use a viewBox plus explicit width/height if you want predictable scaling.
- For pixel-perfect output, set `shape-rendering="crispEdges"` and align rect coordinates to integers.

### Output

```json
{
  "ok": true,
  "resource_path": "res://assets/generated/foo.png",
  "absolute_path": "/.../foo.png",
  "dimensions": { "width": 128, "height": 128 },
  "render_scale": 2.0,
  "message": "Generated res://assets/generated/foo.png (128x128, scale=2.000)"
}
```

---

## Troubleshooting common failures

Quick fixes for "Runtime helper not connected", project rename surprises, and other recurring errors.

### "Runtime helper is not connected"

The MCPRuntime autoload only runs when the game is running.
1. Confirm the godot_mcp plugin is enabled (Project > Project Settings > Plugins).
2. Check that an autoload named `MCPRuntime` is registered (`setup_autoload({operation:"list"})`). The plugin auto-registers it on enable.
3. Launch with `run_scene({ wait_for_runtime: true })` so the call blocks until the helper connects.

### Renaming the project broke things

Changing `application/config/name` causes Godot to re-bind `user://` to a different OS folder. Files written under the old name appear to vanish.
- Use `update_project_settings` for the rename — it pre-creates the new `user://` folder and returns a warning describing the move.
- The MCP cache lives under `res://addons/godot_mcp/cache/` (project-relative) so it survives renames.

### Tool returned "no GDScript files found in res://"

This is a benign empty result, not a real failure. `map_project` will return an empty visualization for an empty project.

### set_sprite_texture set the wrong texture class

`texture_type: "ImageTexture"` (deprecated alias) and `"FromPath"` both call `load(path)`, which the importer typically returns as a CompressedTexture2D. To force an actual ImageTexture in memory use `texture_type: "NewImageTexture"`.
