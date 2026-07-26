# Changelog

This project started as a fork of [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp)
(MIT licensed) and has since diverged substantially in architecture and tool
surface. Versioning restarts at 1.0.0 for this repository; it does not carry
over upstream's version numbers or issue/PR history.

## [1.1.1] - 2026-07-26

See [`release-notes/v1.1.1.md`](./release-notes/v1.1.1.md) for the narrative
write-up. Almost everything here came out of writing one automated test for the
live-scene path, which had no coverage at all.

### Fixed
- **Fifteen scene tools destroyed unsaved work.** They loaded the scene from
  disk, mutated the copy and saved it; on an OPEN scene that discards the
  editor's unsaved state and the reload wipes the live tree. Confirmed by hand —
  an `attach_script` call deleted an unsaved node from a real project. Affected
  `attach_script`, `detach_script`, `set_node_groups`, `set_collision_shape`,
  `set_sprite_texture`, `set_mesh`, `set_material`, `set_anchor_preset`,
  `snap_node_to_grid`, `set_scene_node_property`, `set_resource_property`,
  `instance_scene`, `connect_signal`, `disconnect_signal`, `batch_scene_edit`.
- **Eleven read tools returned last-saved state** on an open scene, so an agent
  that edited and read back got stale values with no way to tell.
- **Undo only covered seven structural actions**, and even those filed into the
  wrong history — `EditorUndoRedoManager` infers the history from an action's
  first object, and `add_node` registered a node living under the EditorPlugin
  rather than in the scene, so Ctrl+Z never reached it. Every live edit now
  registers, with the history pinned explicitly.
- **`batch_scene_edit` reported "batch discarded, nothing saved" while leaving
  earlier operations applied.** It is now one undo entry, committed and
  immediately undone on failure.
- **`validate_scripts` flagged a valid file.** It compiled a pathless copy, which
  loses the path-sensitive `exclude_addons` warning exemption; any warning the
  project promotes to an error then failed the compile with an empty error list.
- **`query_runtime_node`** could not distinguish a null property from a
  nonexistent one; missing properties are now reported separately.
- **Stringified arguments** no longer coerce `"true"`/`"false"` on free-form text
  keys (a node named `true` became a boolean).
- **PathGuard** now covers five script-writing functions in `visualizer_tools.gd`.
- **The advertised minimum Godot version was wrong.** The badge said 4.3+; the
  editor-mode scene path does not work there. Measured by running the live
  harness against each release: 4.3 fails, 4.4 fails, 4.5 passes 28/28. The
  minimum is now stated as 4.5 and CI pins it, so the badge is checkable rather
  than aspirational. Three constructs that needed even newer engines were also
  replaced with portable equivalents (a typed `Dictionary`, `OS.get_temp_dir()`,
  and an inferred return from `EditorInterface.close_scene()`); the old parse
  check used `load()` and was too weak to see them at all.
- Test suites no longer collide on ports; `primary-http` walks a 17-port range
  that already swallowed `proxy-client`'s fixed port.

### Added
- **`undo_last` / `redo_last`** — step the editor's undo history, so the agent can
  take back its own edit. The history is shared with the developer, and the
  response names what was actually undone.
- **Configurable bridge port** — `GODOT_MCP_PORT`, or the
  `godot_mcp/network/port` project setting (env wins; out-of-range falls through).
- **`GODOT_MCP_PROJECT`** — the bridge refuses any editor that does not have this
  project open, with a close code distinct from "a slot is taken".
- **`_abort_edit` in `SceneToolBase`** — reverts writes a tool has already made,
  for error paths where validating first isn't possible.

### Testing
- **Live-scene harness**: 28 assertions against a real headless editor (no clobber,
  no partial writes, undo, batch rollback), now running in CI where the e2e suite
  previously skipped and went green by omission.
- GDScript suite 150 → 207 assertions.
- `parse_all.gd` compiles every addon script instead of calling `load()`, whose
  resource cache let a genuinely broken file through three times in one session.
- The e2e suite mirrors the addon into its fixture before starting the editor; the
  fixture's copy is no longer tracked, since three runners generate it.

## [1.1.0] - 2026-07-26

See [`release-notes/v1.1.0.md`](./release-notes/v1.1.0.md) for the narrative write-up.

### Added
- **Language-server tools (`code_intel` toolset, 8 tools)** — `gd_definition`,
  `gd_references`, `gd_rename`, `gd_diagnostics`, `gd_hover`, `gd_document_symbols`,
  `gd_completion`, `gd_lsp_status`, over Godot's built-in GDScript language server
  (port 6005). These understand scope, which fixes a real correctness gap:
  `rename_symbol_project_wide` is a text substitution and will rename an unrelated
  symbol that happens to share the name — `gd_rename` will not. Only capabilities Godot
  actually advertises are exposed (no workspace symbols, code actions, formatting or
  folding — it reports those as unsupported). These read and write files from the Node
  process, outside the addon's GDScript `PathGuard`, so they carry their own: every path
  resolves against the open project and is rejected if it escapes.
- **Multiplayer scaffolding (4 tools, in `scaffolding`)** — `mp_add_spawner`,
  `mp_add_synchronizer`, `mp_wire_rpc`, `mp_scaffold_lobby`. Builds Godot 4's replication
  nodes including the `SceneReplicationConfig` sub-resource, writes correctly-annotated
  `@rpc` methods (a wrong annotation is the classic silent-no-op multiplayer bug), and
  generates host/join plumbing.
- **`csharp_status`** — reports whether C# is usable in this editor and project before
  any is written. The standard Godot build has no C# support at all: a `.cs` file saves
  fine, attaches to nothing, and fails silently. `create_csharp_script` now carries the
  same warning in its result.
- **Opt-in confirmation gate** — `GODOT_MCP_REQUIRE_CONFIRM=true` makes operations with
  no undo path (file delete/rename, script rewrites, mass renames, project settings,
  autoloads) require an explicit `confirm: true`. Off by default so 1.0 callers are
  unaffected. Scene edits are deliberately exempt — they already go through Godot's undo
  history.
- **Step-debugger (`debug` toolset, 11 tools)** — `debug_launch`, `debug_attach`,
  `debug_set_breakpoints`, `debug_continue`, `debug_step`, `debug_stack_trace`,
  `debug_scopes`, `debug_variables`, `debug_evaluate`, `debug_status`,
  `debug_disconnect`. Speaks the Debug Adapter Protocol straight to Godot's own
  adapter (port 6006) rather than through the addon bridge, so the agent can stop at a
  breakpoint and read real frame values instead of inferring them from `print()` output.
  Not in `core` — enable with `enable_toolset({name: "debug"})`.
- **`debugging` guide** in `get_guide` / MCP resources (and `docs/TOOLS.md`), covering the
  breakpoint→launch→inspect→step loop and the engine quirks worth knowing.
- **`llms.txt`** at the repo root: a machine-readable summary for LLM consumption.
- **GDScript handler tests now run in CI** against a real headless Godot, alongside the
  existing Node suite.

### Fixed
- **`set_physics_layers` could leave a partial write on an open scene.** It applied
  `collision_layer` before validating `collision_mask`; an invalid mask returned a total
  failure while the layer stayed applied (`_discard_scene` is a no-op on a live scene).
  Both are now resolved before either is written. Same fix applied to `set_material_3d`
  and `setup_environment`, the latter of which could also leave a stray `WorldEnvironment`
  node behind after reporting failure.
- **`debug_variables` raced Godot's adapter.** Godot fills a frame's variable list
  asynchronously after `scopes`, so the first `variables` request was rejected with a bare
  "unknown". It now retries briefly instead of surfacing a confusing error.
- **The e2e test suite could run against the wrong project.** Port 6505 is hardcoded in
  the addon, so any open Godot editor would reconnect to the bridge the suite starts and
  then receive its scene mutations. It now verifies the connected project is the test
  fixture and refuses to run otherwise. Only affects contributors running `npm test` with
  `GODOT_BIN` set.

### Changed
- **`framing.ts`** — the `Content-Length` transport is now shared by the DAP and LSP
  clients instead of duplicated, since Godot serves both protocols the same way.

### Notes
- Godot's debug adapter does not advertise `supportsConditionalBreakpoints`; the
  `conditions` argument on `debug_set_breakpoints` is forwarded but may be ignored by the
  engine.
- Godot's language server supports fewer LSP features than a typical one. `gd_lsp_status`
  reports what the connected server actually advertises.

## [1.0.0] - 2026-07-25

See [`release-notes/v1.0.0.md`](./release-notes/v1.0.0.md) for the narrative write-up.

### Highlights
- **Runtime helper autoload (`MCPRuntime`)** — connects to the MCP server from inside the running game and exposes runtime-only tools (`take_screenshot`, `send_input`, `query_runtime_node`, `get_runtime_log`, and more), separate from the editor-side tool surface.
- **`SceneToolBase` architecture** — every scene-mutating tool shares one base class (`_ensure_res_path`, `_load_scene`, `_acquire_scene`, `_finish_scene_edit`, etc.) instead of copy-pasted per-file logic.
- **Live-tree editing** — mutating tools edit the currently open scene in the editor (via `EditorUndoRedoManager` or the live-tree acquire/finish pattern) so unsaved work survives, instead of clobbering the `.tscn` file on disk.
- **Semantic toolsets** — tools are grouped by intent (`core`, `runtime`, `scaffolding`, `analysis`, `editor`, `project_config`, `export`, `refactor`) instead of by source file, keeping the default agent-visible surface small.
- **Setup CLI** — `godot-mcp-bridge install` / `doctor` stage the addon and verify a real install (plugin enabled, port listening) without manual copy steps.
- **Competitive feature set** — `batch_scene_edit`, `run_gut_tests`, `create_csharp_script`, `game_eval`, `serialize_runtime_tree`, `set_main_scene`, UI-testing tools (`click_control_runtime`, `assert_screen_text`, `dump_control_tree`), localization sync, and more.
- **Security hardening** — path traversal protection via `PathGuard`, `dry_run` support across mutating tools.
- **Test coverage** — Vitest suite for the WS bridge/HTTP/proxy/tool registry, plus headless GDScript logic tests for the on-disk tool paths.
