# Changelog

This project started as a fork of [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp)
(MIT licensed) and has since diverged substantially in architecture and tool
surface. Versioning restarts at 1.0.0 for this repository; it does not carry
over upstream's version numbers or issue/PR history.

## [1.1.6] - 2026-07-28

See [`release-notes/v1.1.6.md`](./release-notes/v1.1.6.md).

Everything here was found by building a game with the tools rather than by
reading them. Three of the four gaps reported after that session turned out to
be real; one was a misdiagnosis, recorded below because the misdiagnosis is the
more useful lesson.

### Added
- **`set_node_reference`** — points an exported node slot (`@export var target:
  Area2D`) at another node. There was no way to do this at all: every property
  tool takes a JSON value and this needs a live object, so wiring components
  meant redesigning them to discover each other at runtime. The tool bending the
  code, rather than the other way round.
- **`render_scene_preview`** — renders a 2D scene to a PNG without launching the
  game, auto-framed on its content. Looking at a scene previously required a
  launch, a runtime connection, and remembering to stop it, so in practice
  nobody looked and visual mistakes were found late. Needs a real display;
  `--headless` uses the dummy driver and produces no image.
- **`restart_editor`** — saves scenes and project settings, then restarts. A new
  autoload or `class_name` is invisible to a running editor (measured: the
  setting registers, the script still fails to compile), and the only previous
  way out was killing the process from a shell.

### Fixed
- **`validate_scripts` called healthy scripts broken.** It compiled each file in
  isolation, where a project's autoloads and global classes do not exist, so
  anything touching a singleton came back as a parse error — 4 of 4 scripts in a
  real project, all of which ran fine. It now loads the file the way the editor
  does and judges it by whether the parser resolved a base type.
- **Exported properties passed with a script were silently dropped.** Properties
  were applied *before* `set_script`, so the property did not exist yet: a scene
  built with `max_health: 400` shipped with 100 and reported ok. Scripts attach
  first now, and anything still unapplied is returned under `warnings`.
- **Writes are read back.** A property can exist, accept an assignment and still
  hold something else — a `TextureRect` asked for `size.y = 6.667` keeps 16,
  because a Control's minimum size is its texture's. Mismatches are reported;
  exact writes stay silent.
- **`validate_scripts` sweeps are bounded.** Validation costs ~34ms per script on
  the editor's main thread, so a whole-project sweep could approach the bridge's
  20s ping watchdog and drop the connection it was answering through. `addons/`
  is skipped by default, and the response carries `elapsed_ms`.
- **`game_eval` no longer loses the runtime connection** to a stale `node_path`.
  The null access that followed could not be caught, broke the attached debugger,
  and cost the whole connection.
- **The piggybacked editor digest dropped `filesystem_changed`.** It fires on
  every file the *agent* writes but arrives deferred, so it was attributed to the
  developer and rode along on nearly every response — about 90% of all digest
  content, reporting writes the agent had just made.

### Not a bug, recorded so it is not "fixed" again
- **`send_input` works.** It was reported broken on the strength of a jump that
  never fired; the real cause was floor snapping cancelling the velocity. All
  three delivery routes update `is_action_pressed` and `is_action_just_pressed`,
  now covered by a test that runs as a scene (Input only advances on real frames).
- **`create_sprite_animation` already sets `UPDATE_DISCRETE`** on the frame track.
  That was a hypothesis recorded without checking.

## [1.1.5] - 2026-07-27

See [`release-notes/v1.1.5.md`](./release-notes/v1.1.5.md). Twelve tools added
and a long backlog closed, but the pattern is the part worth keeping: **five
times a recorded cause turned out to be wrong**, and each real one came from a
test that failed rather than from re-reading the code.

### Added
- **`save_scene`** — the loop-breaker. Every mutating tool edits the LIVE tree
  when its target scene is open, which is what stops it clobbering unsaved work,
  and nothing could persist those edits: an agent that edited a scene and then
  ran the game tested the PREVIOUS version of the file, silently, every time.
  Live-path responses now also carry `unsaved: true`.
- Runtime determinism cluster: `seed_rng`, `step_frames`, `time_scale`,
  `await_condition`.
- `validate_references`, which checks that the groups, input actions and signals
  scripts *use* actually exist — they fail silently at runtime otherwise.

### Fixed
- **Every write to an integer property was reported as a failure.** `_values_match`
  compared different types as text; JSON has one number type, so every integer
  arrives as a float, and the check compared `"1"` against `"1.0"`. A
  single-property call seeing a failure saved nothing. Two backlog entries were
  this one bug.
- **Breakpoints were never broken.** 1.1.4 shipped a section explaining that they
  never pause the game, with a Godot source reading behind it, and that reading
  led to a drafted engine bug report. The blocker was the editor's **"Skip
  Breakpoints"** toggle, which persists between sessions and cannot be read from
  GDScript. All eleven `debug_*` tools work on 4.7 with it off.
- `run_scene`'s editor freeze, the 1.5 MB activity digest, and unknown-tool
  errors that cost ~1,000 tokens each.

## [1.1.4] - 2026-07-27

See [`release-notes/v1.1.4.md`](./release-notes/v1.1.4.md). All of it came from
making the e2e harness launch a real game for the first time.

### Fixed
- **`run_scene` froze the editor for its entire timeout, on every call.** Its two
  wait loops used `OS.delay_msec`, which blocks Godot's main thread — so the
  addon stopped pumping its WebSocket, stopped answering pings, and the server
  force-closed the connection after two missed intervals. The agent got
  `Godot disconnected` back from a call that had launched the game fine. The
  conditions being waited on are updated by that same main loop, so blocking it
  meant they could never become true and every call ran the full
  `startup_timeout_ms` — which is what the "MCPRuntime connects in ~11-20s"
  comment above the default was actually measuring. `run_scene` is now a
  coroutine that yields to the SceneTree, as `wait` already did. A test enforces
  that any handler containing `await` is registered for coroutine dispatch,
  verified against a deliberate regression.
- **The activity feed could go silent for an hour.** `begin_agent_call()` opened
  the agent-attribution window for 3,600,000 ms, closed only by the matching
  `end_agent_call()`. A handler that dies mid-coroutine never reaches it — and
  1.1.3 fixed three handlers that did — after which every action the developer
  took was filed as the agent's own and nothing was reported. The window is now
  bounded regardless, and counted rather than flagged so overlapping calls do
  not un-tag each other.
- A comment in `mcp_runtime.gd` claimed engine errors were captured into the
  runtime log. Nothing captured them; there is no supported hook for it from
  inside a running game.
- `take_screenshot` writes into `addons/godot_mcp/cache`, which the addon bundler
  copied wholesale — a stale screenshot could ship inside the npm package.

### Added
- **Activity from the running game**, split by what each side can observe. The
  runtime autoload reports its own scene swaps (`game_started`,
  `game_scene_changed`), which the editor cannot see and which invalidate every
  runtime node path the agent holds. A new passive `EditorDebuggerPlugin` reports
  the game's life and death (`game_running`, `game_paused`, `game_crashed`,
  `game_stopped`, `game_resumed`), which the game cannot report about itself. The
  activity summary now describes game *state* rather than counting transitions,
  and always calls out a crash.

### Changed
- The e2e harness launches a real game (31 → 34 assertions), and CI runs it under
  Xvfb since the game does not inherit the editor's `--headless`. GDScript suite
  358 → 375; Node suite 118 → 124.

### Known limitation
- **Breakpoints still do not pause the game.** A real Godot bug was identified
  from source — the debug adapter's `update_breakpoints` calls
  `ScriptEditorDebugger::_set_breakpoint`, which only updates the editor UI,
  rather than the public `set_breakpoint` that messages the running game, which
  is why it answers `verified: true` and nothing stops. But that is not the whole
  cause: `EditorDebuggerSession.set_breakpoint` reaches the correct function and,
  tested against a live game on a line running every physics frame, still did not
  pause. No fix ships on a source reading alone.

## [1.1.3] - 2026-07-27

See [`release-notes/v1.1.3.md`](./release-notes/v1.1.3.md). Most of this came out
of two things: finishing the automated coverage of every mutating tool, and
hand-testing the 28 tools added since the original 185-tool pass.

### Known limitation
- **Breakpoints do not pause the game.** `debug_launch` starts a session,
  `debug_status` reports the adapter connected, and Godot accepts *and verifies*
  each breakpoint (`verified: true`, with source checksums) — but execution never
  stops. Reproduced against a line that runs every frame, against `_ready`, and
  with `stop_on_entry`. Every downstream tool (`debug_stack_trace`,
  `debug_variables`, …) then correctly refuses because nothing is paused. Found
  by hand-testing; cause not yet identified. The `debug` toolset's descriptions
  now say so instead of promising otherwise, and the swallowed error that hid it
  is gone. Inspect a running game with `get_runtime_log`, `game_eval` and
  `query_runtime_node` in the meantime.

### Fixed
- **Every analysis tool was reading the last SAVED scene.** `analysis_tools` was
  the one tool node the executor never called `set_editor_plugin` on, so
  `_edited_root_if_open` could never find the live tree. `scene_diff` reported
  "no changes" for an edit sitting unsaved in the editor — the same stale-read
  class eleven read tools were fixed for in 1.1.1, reintroduced by a new file
  being wired in without that one line. A test now asserts the wiring itself.
- **`close_scene_tab` was broken on Godot 4.5**, the advertised minimum:
  `EditorInterface.get_unsaved_scenes()` is 4.6+, so calling it aborted the
  handler and the caller got "Tool returned no status". Where that API is
  missing there is no way to ask which scenes are dirty, so `force` is now
  required explicitly rather than risking a tab holding unsaved work. Caught by
  the new two-version CI matrix on its first real run.
- **`remove_state_machine_transition` never worked** — it called
  `find_transition()`, which does not exist on `AnimationNodeStateMachine`. The
  handler aborted mid-edit and returned an empty dictionary: no `ok`, no `error`,
  undo action left open.
- **Vector properties rejected `[x, y]` arrays.** `{x, y}` is canonical, but an
  agent that just wrote `position: [100, 100]` elsewhere reasonably tries an
  array — and `set_node_properties` passed it straight to `node.set()`, which
  no-ops on a type mismatch, so the caller got "set had no effect (type
  mismatch?)". The shared codec now accepts arrays wherever a type hint asks for
  a vector, and `set_node_properties` passes each property's declared type so the
  hint exists at all. Same fix applied to tilemap coordinates (which silently
  painted at `(0, 0)`) and navmesh outlines.
- **A `res://` path for a Resource-typed property silently did nothing.**
  Assigning a resource by path is what `attach_script`, `set_sprite_texture` and
  `assign_shader_material` all take; `set_node_properties` now loads it, and says
  clearly if the path is missing or fails to load.
- **Painting a tilemap cell with no TileSet reported plain success.** The cells
  are stored but nothing can render them. Refusing would break assigning the
  TileSet afterwards, so `tilemap_set_cell` and `tilemap_fill_rect` now warn —
  and the warning disappears once a TileSet is assigned.

### Added
- **`scene_diff`** — "what changed since I last looked", without re-reading the
  tree. One call takes a snapshot and returns an id (no tree sent); the next
  returns only added/removed/modified nodes with per-property before/after. It
  compares the actual tree, so the developer's edits are caught like the agent's.
- **`mp_diagnose`** — finds the multiplayer mistakes that fail silently: an
  `.rpc()` call to a method with no `@rpc` annotation, a `MultiplayerSynchronizer`
  replicating nothing, a `MultiplayerSpawner` with no spawnable scenes or an
  unresolvable `spawn_path`. Static analysis; the game is never run.
- **Editor activity is now pushed, not polled.** The addon sends each human
  action over the existing socket as it happens, so the activity resource
  notifies immediately instead of waiting for a 1.5s tick. Polling remains as a
  fallback for older addons and backs off to a 30s heartbeat once a push arrives.
- **The activity resource leads with intent**, not records: "The developer saved
  levels/one.tscn and changed the selection 12 times." Selection churn collapses
  to a count; saves, script edits, reimports and undo are named.
- **Automated coverage for every mutating tool: 99 of 99** (was 52 at the start
  of this cycle). The GDScript suite goes 285 → 358 assertions; the live harness
  28 → 31. Tools that need a real editor moved to the live harness; ones that
  cannot do their real work in CI (`export_project`, the headless-peer tools)
  assert their refusal contract instead.

## [1.1.2] - 2026-07-27

See [`release-notes/v1.1.2.md`](./release-notes/v1.1.2.md) for the narrative
write-up.

### Security
- **The bridge accepted WebSocket connections from the local browser.** It binds
  `127.0.0.1`, which stops remote hosts — but a WebSocket handshake is not
  subject to the same-origin policy, so any page the developer visited while the
  editor was open could connect to `ws://127.0.0.1:6505` and issue tool calls,
  which include writing files into the project and `game_eval`. The bridge now
  refuses any handshake carrying an `Origin` header; browsers always send one
  and cannot suppress it, Godot's `WebSocketPeer` never does. Always on, no
  configuration, no effect on the addon.
- **Optional shared secret** — `GODOT_MCP_SECRET` on the server, the same value
  in the editor via that env var or the `godot_mcp/network/secret` project
  setting. Covers the case Origin rejection cannot: another native process on
  this machine opening a plain WebSocket and claiming to be Godot. Compared in
  constant time; a mismatch closes with 4003 and the addon stops retrying and
  says which setting to fix, rather than reconnecting forever. Unset on either
  side means no check, so existing setups are unaffected.
- `SECURITY.md` now documents what actually guards the bridge, in order.

### Fixed
- **`remove_state_machine_transition` never worked.** It called
  `find_transition()`, which does not exist on `AnimationNodeStateMachine`. The
  call aborted the handler mid-edit, so the tool returned an empty dictionary —
  neither success nor error, no message — with the undo action left open. The
  transition index is now located by walking `get_transition_from/to`. Found by
  writing the first automated coverage for the animation-tree tools.
- **`tilemap_set_cell` and `tilemap_fill_rect` reported plain success on a layer
  with no TileSet.** The cells are stored but nothing can render them, because a
  `source_id` resolves against a TileSet there isn't one of. Refusing would break
  assigning the TileSet afterwards, so both now return a `warning` saying the
  cells cannot render yet. (`tilemap_set_terrain_cells` already refused; the
  plain-cell path was the gap.)
- **Tilemap coordinates rejected `[x, y]` silently.** Other tools here take an
  array for a coordinate (`add_node`'s position, `setup_collision`'s size), so an
  agent reasonably tries it — the tilemap tools fell through to `(0, 0)` and
  reported success, painting the wrong cell. Arrays are now accepted alongside
  `{x, y}`.

### Added
- **A live editor-activity feed the agent subscribes to instead of polling.**
  `get_editor_activity` only reports when the agent remembers to ask, and the
  digest attached to tool responses only arrives when a tool happens to be
  called — between calls, exactly when the developer is doing something worth
  knowing about, there was nothing. The server now exposes
  `godot-mcp://editor/activity` as a subscribable MCP resource: subscribe once
  and it pushes `notifications/resources/updated` when the developer touches
  something, then `resources/read` returns what changed. Only the developer's
  own actions fire it (the agent already knows its own edits), bursts are
  coalesced into one notification, and nothing is polled while unsubscribed.
- **Automated coverage for 29 more mutating tools** — 3D authoring, physics
  presets, particles, audio, themes, shaders, animation-tree state machines,
  navigation, tilemap bulk ops, the input map, autoloads, and the property
  forwarder. The GDScript suite goes from 207 to 285 assertions; tools with
  automated coverage go from 52 of 99 to 81 of 99. All three fixes above came
  out of writing it.
- **CI runs the GDScript and live-editor suites against two Godot versions**
  (the advertised minimum and the latest stable) instead of one. Both engine
  breaks this project has had — `NavigationRegion2D.get_bounds()` moving, and
  the advertised 4.3 minimum never having worked in editor mode — were found by
  hand, late. `fail-fast` is off so a break in one version still reports the
  other.
- **The MCP registry entry publishes itself** on a published GitHub release, via
  GitHub OIDC (no secret). The registry sat at 1.0.0 while 1.1.0 and 1.1.1
  shipped, because publishing was a manual step nobody re-ran. The workflow
  fails loudly if `server.json` and `package.json` disagree on the version,
  rather than advertising a version that does not exist on npm.

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
