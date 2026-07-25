# godot-mcp-bridge — project guide

Godot 4 MCP server: a GDScript editor addon (`addons/godot_mcp/`) talking over a
WebSocket (port 6505) to a TypeScript MCP server (`mcp-server/`). 185 tools.
Architecture is the converged standard for the space (Node stdio ↔ WS ↔ editor plugin).

## Two rules that keep the codebase healthy (apply these first)

**Extend `SceneToolBase` for scene work.** Every tool node that reads or mutates
scenes extends `SceneToolBase` (`tools/scene_tool_base.gd`) and inherits the shared
helpers: `_ensure_res_path`, `_load_scene`, `_instantiate_packed_scene_for_edit`,
`_save_scene`, `_find_node`, `_refresh_and_reload`, `_edited_root_if_open`,
`_get_undo_redo`, `_acquire_scene`, `_finish_scene_edit`, `_discard_scene`,
`_set_node_properties`. Fix any shared-helper bug in the base, in one place. (These
were once copy-pasted across ~12 files and drifted into 3 divergent `_load_scene`
versions — extending the base keeps that from returning.)

**Edit the live tree when the scene is open.** A mutating tool checks whether its
target scene is the one open in the editor and, if so, edits the LIVE tree so unsaved
edits survive. Two supported patterns:
- Structural ops (`scene_tools.gd`): `_edited_root_if_open` + `EditorUndoRedoManager`
  (undoable).
- Everything else: `_acquire_scene(path)` → mutate `root` → `_finish_scene_edit(root,
  path, is_live)`, using `_discard_scene(root, is_live)` on every error path. A raw
  `root.queue_free()` on the live root would crash the editor, so `_discard_scene`
  guards it (no-op when live). The live path marks the scene dirty; closed scenes save
  to disk as before.

## Adding or changing a tool

A tool is wired in three places, and it stays dark until all three exist:
1. GDScript handler in `addons/godot_mcp/tools/<area>_tools.gd` (editor) or
   `addons/godot_mcp/runtime/mcp_runtime.gd` (in-game runtime tools).
2. Dispatch entry in `addons/godot_mcp/tool_executor.gd` (`&"name": [_x_tools, &"fn"]`).
3. JSON schema + `annotations` in `mcp-server/src/tools/<area>-tools.ts`.

**Toolsets are by intent, not by file.** `mcp-server/src/tools/index.ts` builds them:
`CORE_TOOL_NAMES` (35 tools, the only set on by default) and `SEMANTIC_GROUPS`
(runtime, scaffolding, analysis, editor, project_config, export, refactor) pick tools
**by name**; anything unclaimed falls back to its source file's group. The builder
throws if a tool ends up in no toolset, so an unreachable tool breaks the build instead
of going unnoticed — but a new tool still lands in a fallback group unless you name it.
Keep `core` small on purpose: a big default tool surface makes agents wander and burns
context.

## Dev / test loop

If you develop against a real Godot project, symlink or junction its
`addons/godot_mcp/` to this repo's `addons/godot_mcp/` so repo edits are already
on disk — no copy step. What each kind of change needs:
- **Changing an existing tool handler's logic** (the body of a `func` in tools/*.gd) —
  **hot-reloads, no restart.** Edit the file, call `rescan_filesystem`, wait ~1-2s: Godot
  swaps the @tool node's script in place (the link makes the res:// change visible;
  the ToolExecutor's map still points at the same node instance, now running new code).
  This is the fast path; reserve editor restarts for the next case.
- **A brand-new tool, a new dispatch entry, or edits to `tool_executor.gd` / `plugin.gd`**
  — needs a full editor restart, then poll `get_runtime_status` until `connected:true`
  (~30-35s), because the tool map is built once in `_init_tools` and the plugin's
  `_enter_tree` ran once. A brand-new tool ALSO needs the Node **server** to restart
  (it caches `list_tools`) before the MCP client can see it.
- `mcp_runtime.gd` reloads fresh on every `run_scene`.

Confirm a change: `validate_scripts` reports 0 invalid after any GDScript edit, and a
live (open-scene) mutation leaves the `.tscn` file's md5 unchanged (proving no clobber).

## Tests

- `cd mcp-server && npm test` — Node/vitest suite: the WS bridge, HTTP, proxy, and the
  tool registry (checks every advertised tool is wired). Fully headless.
- `node mcp-server/dist/index.js doctor` — checks a real install (addon present, plugin
  enabled in project.godot, port 6505 listening). `install` is the user-facing setup path;
  it stages the addon from `mcp-server/bundled-addon/`, produced by `npm run build`.
- `pwsh scripts/test-gd.ps1` — headless GDScript logic tests
  (`.../fixtures/e2e-project/tests/run_tests.gd`): instantiates the tool handlers and
  exercises their on-disk path (scene create/add/set/remove, SceneToolBase inheritance,
  validate_script). No editor, no port 6505. Exit 0 = pass. Add a case here when you add
  or change a tool's disk-path logic — it's the regression net a refactor needs.

## Gotchas

- `validate_script` strips the `class_name` line before compiling; keep it that way, or
  every script that declares a `class_name` false-positives on a global-class collision.
- `run_scene`'s scene arg is `scene`, not `scene_path`.
- Launch Godot with the full `Godot_v4.7-stable_win64.exe` (the `_console.exe` sibling is
  a broken stub — CreateProcess error 193), and quote the `--path` value so a space in the
  user path doesn't truncate it.

Code and comments in English.
