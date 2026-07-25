# Changelog

This project started as a fork of [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp)
(MIT licensed) and has since diverged substantially in architecture and tool
surface. Versioning restarts at 1.0.0 for this repository; it does not carry
over upstream's version numbers or issue/PR history.

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
