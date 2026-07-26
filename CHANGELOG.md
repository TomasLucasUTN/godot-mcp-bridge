# Changelog

This project started as a fork of [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp)
(MIT licensed) and has since diverged substantially in architecture and tool
surface. Versioning restarts at 1.0.0 for this repository; it does not carry
over upstream's version numbers or issue/PR history.

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
