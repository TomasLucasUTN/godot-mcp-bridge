<div align="center">

<img src="./icon.png" width="96" alt="godot-mcp-bridge" />

# godot-mcp-bridge

**An AI that works *with* you in the Godot editor — not instead of you.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Godot 4.5+](https://img.shields.io/badge/Godot-4.5%2B-478CBF?logo=godotengine&logoColor=white)](https://godotengine.org)
[![231 tools](https://img.shields.io/badge/tools-231-brightgreen)](#-what-can-it-do)
[![Last commit](https://img.shields.io/github/last-commit/TomasLucasUTN/godot-mcp-bridge)](https://github.com/TomasLucasUTN/godot-mcp-bridge/commits/main)
[![Stars](https://img.shields.io/github/stars/TomasLucasUTN/godot-mcp-bridge?style=social)](https://github.com/TomasLucasUTN/godot-mcp-bridge/stargazers)

</div>

Every Godot MCP server lets an AI drive the editor. **This one also tells the AI what
*you* just did** — the scene you opened, the node you selected, the file you saved —
so you can both work in the same project at the same time without stepping on each
other. Add a real step-debugger, scope-aware refactoring through Godot's language
server, live-tree edits that never clobber your unsaved work, and 231 tools that were
each verified against a running editor rather than just written.

Started as a fork of [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp) (MIT
licensed) and has since diverged substantially — see [`CHANGELOG.md`](./CHANGELOG.md).

---

## 💬 What you'd actually say to it

> *"The player falls through the floor sometimes. Set a breakpoint in
> `_physics_process` and tell me what `velocity` is when it happens."*

> *"Build me an enemy: CharacterBody2D, circle collider, sprite, patrol script,
> and put it in the `enemies` group."*

> *"Run the game, press jump, screenshot it, and tell me if the animation played."*

> *"Which of my resources aren't referenced by anything anymore?"*

> *"Export a Windows debug build and tell me when it's done."*

Under the hood that's a breakpoint hit read from a paused frame, a scaffolded scene
tree, a runtime input + screenshot loop, a dependency sweep, and an async headless
build — but you don't have to know which tool does which.

<details>
<summary>What a debug session actually returns</summary>

```jsonc
// debug_launch({scene: "res://scenes/level.tscn"})
{ "state": "stopped", "stopped_reason": "breakpoint", "hit_breakpoint": true }

// debug_stack_trace()
{ "frames": [{ "name": "_physics_process", "line": 17,
               "source": ".../scenes/player.gd" }] }

// debug_variables({variables_reference: 1})   ← the Locals scope
{ "variables": [{ "name": "delta",     "value": "0.01666666666667" },
                { "name": "direction", "value": "<null>" }] }

// debug_evaluate({expression: "velocity"})
{ "result": "(0.0, 0.0)" }
```

Real output from the test project — `delta` is exactly 1/60, matching its 60 Hz
physics tick.
</details>

---

## ✨ Why this one

**It's bidirectional.** The AI can poll `get_editor_activity` to see what *you* just did
in the editor — selection, scene open/close/save, script focus, resource saves, asset
reimports, undo/redo, which screen you're on — tagged human vs its own actions. It finds
out you moved something without having to ask. Every other Godot MCP is one-directional:
the AI drives, and is blind to you. (Checked by reading the source of 12 competing
servers in July 2026, not their READMEs.)

**It doesn't clobber your work.** Many Godot MCP servers edit your `.tscn` files on disk.
If you have that scene open with unsaved changes, they silently overwrite it. Here, when
a scene is open, every mutating tool edits the **live editor tree** instead — your
unsaved edits survive and every change goes through Godot's **undo system** (Ctrl+Z
works). Closed scenes still edit on disk as usual.

**The claims are tested, not asserted.** 526 GDScript checks against the tool handlers,
147 Node tests for the bridge and the tool registry, and 43 that drive a **real Godot
editor** — creating scenes, mutating one that is open, launching an actual game — on
every push, on both Godot 4.5 and 4.7. Every one of the tools that writes to your project
has automated coverage.

That suite is not decoration; it is where the bugs came from. It caught `close_scene_tab`
being broken on 4.5 (the minimum this README promises), a `run_scene` that froze the
whole editor for its entire timeout on every single call, and a `res://` texture path
that five different tools accepted and silently threw away. Each of those was found by a
test that failed, not by reading the code — and each is in
[`CHANGELOG.md`](./CHANGELOG.md) with what it cost.

See [Limitations](#-limitations) for what it still can't do.

More of what it does:

- **Step-debugger** — set breakpoints, step, read the real call stack and frame variables,
  evaluate expressions in the paused frame, over Godot's own Debug Adapter. Stop at the
  failure and look at actual values instead of inferring them from `print()` output.
- **Real headless export** — builds an actual game binary via a shadow-workspace clone,
  asynchronously, without freezing the editor (`export_project` → `get_export_status`).
- **Runs your real tests** — `run_gut_tests` executes your GUT unit suite (sync or async)
  and reports pass/fail, so the AI acts on real results instead of guessing.
- **Drives the running game** — call methods, set properties, `await` signals, `game_eval`
  a snippet, record/replay input, snapshot the live tree, even a multiplayer peer-spawn
  harness (`spawn_headless_peers`) — deterministic playtesting without screenshots.
- **Sandboxed paths** — every path is guarded against traversal outside the project
  (the class of bug behind CVE-2026-15522 in another server).
- **Writes the boilerplate for you** — `wire_signal` connects a signal *and* generates
  the correctly-typed handler; `generate_onready_refs` emits typed `@onready` vars for a
  subtree; `scaffold_entity` builds a character (body + collision shape resource + sprite
  + movement script) in one call; `scaffold_state_machine` lays out a working FSM.
  Physics layers can be set **by name** instead of bit indices.
- **Tells you what's rotting** — `find_unused_resources`, `detect_circular_dependencies`,
  `analyze_scene_complexity`, and `analyze_signal_flow` (which catches connections whose
  handler doesn't exist — a bug that otherwise only shows up at runtime).
- **Asks what changed, not for everything again** — `scene_diff` takes a snapshot id
  and then returns only the added, removed and modified nodes (with before/after
  values), so the agent stops paying for a full `read_scene` every time it looks back.
  It catches your edits too, not just its own.
- **Catches multiplayer bugs that fail silently** — `mp_diagnose` flags an `.rpc()`
  call to a method with no `@rpc` annotation, a synchronizer replicating nothing, and
  a spawner whose `spawn_path` goes nowhere. None of those error when you write them;
  all of them look like "the client is broken" when a second peer joins.
- **Visual regression** — `compare_screenshots` diffs two frames and reports the changed
  percentage and region, so "did my change actually alter the screen?" has an answer.
- **Tests your UI like a human would** — click a button by its visible caption
  (`click_control_runtime({text: "Start"})`, which refuses and lists candidates if the
  text is ambiguous), then assert what's on screen with `assert_screen_text` — reading the
  live Control tree, so it works headless with no OCR.
- **Localization that doesn't half-work** — `sync_localization` registers the
  `.translation` files Godot generated from your CSV (the manual step that silently makes
  a language never load) and reports every key you haven't translated yet, per locale.
- **Setup that explains itself** — `npx godot-mcp-bridge install` installs and enables the
  addon in one command; `doctor` diagnoses a broken setup; `diagnose_connection` tells the
  AI exactly why the editor isn't connecting.
- **Fast + robust** — `batch_execute` / `batch_scene_edit` cut N calls to one; heavy reads
  (`read_scene`, `scene_tree_dump`, `classdb_query`) take `max_depth`/`filter` to stay
  token-cheap; only 38 tools load by default so the agent stays focused. **Measured, not
  claimed** — see below.
- **Symbol-accurate refactoring** — `gd_rename` and `gd_references` go through Godot's
  language server, so they understand scope: renaming a local `speed` won't touch an
  unrelated class's `speed` the way a text search would. `gd_diagnostics` surfaces type
  errors without running the game.
- **Multiplayer scaffolding** — `mp_add_spawner` / `mp_add_synchronizer` build Godot 4's
  replication nodes (including the `SceneReplicationConfig` sub-resource that makes them
  tedious by hand), `mp_wire_rpc` writes correctly-annotated `@rpc` methods, and
  `mp_scaffold_lobby` generates the host/join plumbing.
- **C#, honestly** — `create_csharp_script` scaffolds the boilerplate, and `csharp_status`
  tells you up front whether C# can work here at all. The standard Godot build has no C#
  support: a `.cs` file saves fine, attaches to nothing, and fails silently. Better to
  find that out before writing any.
- **Preset toolsets at startup** — `GODOT_MCP_TOOLSETS=runtime,debug` (or `all`) puts those tools in the FIRST tool list. Enabling one mid-session relies on the client re-fetching `list_tools`, and several clients cache it for the session; presetting sidesteps that entirely.
- **Opt-in confirmation gate** — set `GODOT_MCP_REQUIRE_CONFIRM=true` and operations with
  no undo path (file deletes/renames, script rewrites, mass renames, project settings)
  require an explicit `confirm: true`. Edits to an **open** scene are exempt — those do
  land on Godot's undo history, so Ctrl+Z (or `undo_last`) already covers them.
- **Pre-flight validation** — `validate_scripts` sweeps every `.gd` (loading each the way
  the editor does, so a script using an autoload isn't reported as broken);
  `validate_scene_integrity` flags nodes left with an empty required resource — including
  an instance whose script went missing, which otherwise just stops behaving with no error;
  `validate_meshes` catches empty geometry.
- **Look at a scene without running it** — `render_scene_preview` renders a 2D scene to a
  PNG offscreen, auto-framed on its content. Checking whether a level's platforms line up
  used to mean launching the game; now it doesn't, so it actually gets checked.
- **Says when a write didn't land** — a property can exist, accept an assignment and still
  hold something else (Godot clamps and coerces silently: a `TextureRect` asked for
  `size.y = 6.667` keeps 16). Scene tools read back what they wrote and report the
  mismatch instead of reporting success.
- **Wires exported node slots** — `set_node_reference` points an `@export var target: Area2D`
  at another node, the thing you'd otherwise do by dragging in the inspector and which no
  value-based property tool can express.

---

## ⚙️ Running more than one project

One project on one machine needs no configuration. If you run several — or a CI
editor alongside your own — set two things, because the addon dials a fixed port
and cannot tell which server answered:

| Variable | Where | What it does |
|---|---|---|
| `GODOT_MCP_PORT` | server **and** editor | Port for the bridge. Give each project its own. |
| `godot_mcp/network/port` | Project Settings | Per-project port, if you'd rather not set an env var on the editor. `GODOT_MCP_PORT` overrides it. |
| `GODOT_MCP_PROJECT` | server | Absolute path of the project this server serves. Any editor with a different project open is refused. |

`GODOT_MCP_PROJECT` is the one worth setting even with a single project. Without
it the first editor to reach the port is trusted with every tool call, so an
unrelated editor that happens to be open can end up receiving edits meant for
this one. With it, that connection is refused and the editor says so instead of
silently taking the work.

---

## 🧮 What it costs per request

Tool definitions are sent on **every** request, so a large always-on surface is a
standing tax on every message — the most common complaint about Godot MCP servers,
and one nobody publishes a number for. Here is ours, from
[`scripts/measure-tools.mjs`](./mcp-server/scripts/measure-tools.mjs) so you can
re-run it:

| | tools | ~tokens |
|---|---:|---:|
| **`core`** — what loads by default | 38 | **8,764** |
| Everything, every toolset on | 231 | 49,811 |

So the default surface is **17.6% of the full one**, and turning everything on
costs roughly **41,000 extra tokens on every request**. That is the reason the
default is small and the rest is opt-in per toolset (or preset once via
`GODOT_MCP_TOOLSETS`), rather than a judgement that the other 192 tools do not
matter. `find_tools` searches all 231 by what you want to do, so a tool being
unloaded never means it is unfindable. The default grew by ~800 tokens when
previews (`dry_run`), subtree reads and the detached launch mode were added to
core tools — measured rather than assumed, which is the point of publishing it.

The estimate is chars ÷ 4, which is close enough to compare sets and honest about
being an estimate. The most expensive definitions inside `core` are
`modify_node_property`, `add_node` and `run_scene` — verbose because they carry
the "use this, NOT that" wording that stops an agent picking the wrong neighbour.

---

## 📊 How it compares

Checked in July 2026 by reading each project's **source**, not its marketing. Star count
mostly tracks how early a project shipped, so it's listed last rather than first.

| | **godot-mcp-bridge** (this repo) | [yurineko73/Godot-MCP-Native](https://github.com/yurineko73/Godot-MCP-Native) (most active) | [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp) (fork origin) | [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) (most-starred) |
|---|---|---|---|---|
| Tools | 231 (38 loaded by default) | 155 | 42 | ~14 |
| Live-tree editing + undo | ✅ | ✅ | ❌ (overwrites open scenes on disk) | ❌ |
| Step-debugger | ✅ | ✅ | ❌ | ❌ |
| Drives the running game (input, `game_eval`) | ✅ | ✅ | ❌ | ❌ |
| **Sees what *you* just did** (`get_editor_activity`) | ✅ | ❌ | ❌ | ❌ |
| Async headless export (doesn't block the editor) | ✅ | CLI export | ❌ | ❌ |
| Runs your real test suite (GUT) | ✅ | ❌ | ❌ | ❌ |
| Works with Codex CLI (stdio) | ✅ | ❌ (HTTP only — their issues #1, #24) | ✅ | ✅ |
| Last release | active | active | Apr 2026 | Apr 2026 |
| GitHub stars | — | 464 | 397 | 4.9k |

**About the Node process.** `Godot-MCP-Native` runs entirely inside the editor and
sells that as "no sidecar". It is a real trade, so here is the other half of it. A
server living in the editor process is bound to the editor's lifetime *and* to its
main thread. That costs three things: it cannot be spawned over **stdio**, so
stdio-only clients like Codex CLI cannot load it at all; it **dies when Godot
crashes**, taking your AI client's connection with it; and any slow work **freezes
the editor**, because `@tool` scripts run on the main thread.

That last one is measurable. Asked "which assets does nothing reference?" on a
project with a couple of free asset packs in it (24,649 files, 12,201 images), the
same analysis takes **1.6 seconds** in a separate process and never touches the
editor — where an in-editor implementation blocks the UI for **26 seconds**. The
sidecar is an install step you pay once; the main thread is one you pay every call.

The honest read: undo, a debugger, and runtime control are table stakes now — the good
projects all have them. What no one else does is the bidirectional half, and the two
most-starred options haven't shipped since April.

---

## 📦 Quick Start

### 0. Install Node.js (one-time setup)

Download and run the installer from **[nodejs.org](https://nodejs.org/en/download)** (LTS version). It's a standard installer — no terminal needed.

### 1. Install the Godot plugin

**One command, from inside your Godot project folder:**

```bash
npx godot-mcp-bridge install
```

That copies the addon into `addons/godot_mcp/` and enables the plugin in
`project.godot` (backing the file up first, and keeping every other plugin and
setting intact). Add `--client claude-desktop` or `--client cursor` and it will
register the server in that client's config too.

Something not connecting? Run this and it tells you which step is missing:

```bash
npx godot-mcp-bridge doctor
```

<details>
<summary>Prefer to do it by hand</summary>

Copy the `addons/godot_mcp/` folder from this repo into your Godot project's
`addons/` directory. Then go to **Project → Project Settings → Plugins** and
enable the **Godot MCP** plugin.

(The "Godot AI Assistant tools MCP" AssetLib listing belongs to the upstream
project this repo forked from, not this one — installing from there gets you
the upstream addon, not this fork.)
</details>

### 2. Add the server config to your AI client

**Claude Desktop** — Settings → Developer → Edit Config → open the config file and paste:

Mac / Linux:
```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "godot-mcp-bridge"]
    }
  }
}
```

Windows:
```json
{
  "mcpServers": {
    "godot": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "godot-mcp-bridge"]
    }
  }
}
```

**Cursor** — Settings → MCP → Add Server:

Mac / Linux:
```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "godot-mcp-bridge"]
    }
  }
}
```

Windows:
```json
{
  "mcpServers": {
    "godot": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "godot-mcp-bridge"]
    }
  }
}
```

**Claude Code** — run in terminal:
```bash
claude mcp add godot -- npx -y godot-mcp-bridge
```

**Codex CLI** — run in terminal:
```bash
codex mcp add godot -- npx -y godot-mcp-bridge
```

Or add it to `~/.codex/config.toml` by hand:
```toml
[mcp_servers.godot]
command = "npx"
args = ["-y", "godot-mcp-bridge"]
```

On Windows use `command = "cmd"` and `args = ["/c", "npx", "-y", "godot-mcp-bridge"]`.

Codex CLI speaks stdio only — it cannot use an MCP server that is reachable
solely over HTTP. This server is a stdio server, so it works there without a
bearer token or a port to keep track of.

Works with any MCP-compatible client (Cline, Windsurf, etc.)

### 3. Restart your AI client

Close and reopen Claude Desktop / Cursor / your client so it picks up the new config.

### 4. Restart your Godot project

Hit **Restart Project** in the Godot editor. Check the **top-right corner** — you should see **MCP Connected** in green. You're ready to go.

---

## 🧰 What Can It Do?

### 231 Tools, 38 Loaded by Default

A big always-on tool list makes an AI agent wander between unrelated
capabilities and burns context on definitions it never uses. So only **`core`
(38 tools)** is visible by default — the smallest set that carries a normal
session end to end: look around, edit scenes and scripts, run the game, read the
errors.

Everything else is grouped **by intent** and is one call away:
`enable_toolset({ name: "runtime" })`. `list_toolsets` shows every set, what it's
for, and the names of the tools inside it — so the AI can find what it needs
without loading the whole catalog first. Nothing is ever unreachable.

For a goal-to-tool index and per-topic usage guides (scene editing patterns,
the runtime testing loop, asset generation, troubleshooting), see
[`docs/TOOLS.md`](./docs/TOOLS.md) — the same content the server exposes live
via the `get_guide` tool, in browsable form.

| Toolset | Tools | What it's for |
|---------|-------|---------|
| **core** *(always on)* | 38 | Look around (`read_scene`, `scene_tree_dump`, `search_project`, `classdb_query`), edit scenes/nodes (live-tree + undo, `batch_scene_edit`, `set_node_reference`), scripts, run the game, **see a scene without running it** (`render_scene_preview`), read errors, `restart_editor` |
| **runtime** | 29 | Drive the running game: input (keyboard/mouse/**gamepad/touch**), `game_eval`, live node/property access, `await_signal_runtime`, UI-by-text clicking + `assert_screen_text`, input record/replay, multiplayer + `spawn_headless_peers` |
| **debug** | 11 | Step-debugger over Godot's own Debug Adapter: breakpoints, step over/in/out, call stack, scope variables, expression evaluation in the paused frame |
| **code_intel** | 8 | Godot's language server: scope-aware `gd_definition`, `gd_references` and `gd_rename` (unlike text search), plus type diagnostics without running the game |
| **scene_editing** | 14 | Deeper scene work: collision shapes, sprites/meshes/materials, groups, anchors, spatial queries |
| **project_config** | 13 | Project settings, input map, autoloads, resources, `sync_localization` |
| **animation** | 14 | AnimationPlayer tracks/keyframes, AnimationTree state machines |
| **editor** | 14 | The editor itself: `get_editor_activity` (what *you* just did), selection, scene tabs, performance |
| **physics** | 7 | Collision shapes, raycasts, layers **by name**, collision presets |
| **tilemap** | 8 | TileMapLayer cell painting, terrain + deterministic bitwise autotiling |
| **analysis** | 9 | `scene_diff` (what changed since you last looked, without re-reading the tree), `mp_diagnose` (silent multiplayer bugs), `find_unused_resources`, `detect_circular_dependencies`, `analyze_scene_complexity`, `analyze_signal_flow`, `get_project_statistics`, `compare_screenshots` |
| **scaffolding** | 12 | `wire_signal`, `generate_onready_refs`, `scaffold_entity`, `scaffold_state_machine`, `create_csharp_script`, plus multiplayer: `mp_add_spawner`, `mp_add_synchronizer`, `mp_wire_rpc`, `mp_scaffold_lobby` |
| **testing** | 6 | GUT test runner (sync/async), scene/mesh integrity validation, assertions |
| **ui** | 6 | Theme resources, colors, stylebox overrides |
| **3d** | 9 | Mesh instances, lighting presets, materials, environment, cameras, gridmaps |
| **shaders** | 6 | Create/read/edit GDShader, assign materials, set params |
| **navigation** | 5 | NavigationRegion setup, mesh baking, agents, layers |
| **vfx** | 5 | GPUParticles2D/3D, gradients, presets |
| **refactor** | 5 | Project-wide symbol rename, bulk property edits, file moves |
| **export** | 4 | Export presets and async export jobs |
| **audio** | 3 | AudioStreamPlayer variants, buses |
| **utility** | 2 | 2D asset generation, project/scene visualizer |

### Interactive Visualizer

Run `map_project` and get a browser-based explorer at `localhost:6510`:
- Force-directed graph of all scripts and their relationships
- Click any script to see variables, functions, signals, and connections
- Edit code directly in the visualizer — changes sync to Godot in real time
- Scene view with node property editing
- Find usages before refactoring

![Interactive project visualizer](./screenshots/visualizer-preview.png)

---

## 🏗️ Architecture

```
┌─────────────┐    MCP (stdio)   ┌──────────────┐   WebSocket   ┌──────────────┐
│  AI Client  │◄────────────────►│  MCP Server  │◄─────────────►│ Godot Editor │
│  (Claude,   │                  │  (Node.js)   │   port 6505   │  (Plugin)    │
│   Cursor)   │                  │              │               │              │
└─────────────┘                  │  Visualizer  │               │  230 tool    │
                                 │  HTTP :6510  │               │  handlers    │
                                 └──────┬───────┘               └──────────────┘
                                        │
                                 ┌──────▼───────┐
                                 │   Browser    │
                                 │  Visualizer  │
                                 └──────────────┘
```

---

## ⚠️ Limitations

Written to be the section you read *before* hitting these, not after.

**Requires a running editor.** This drives a live Godot instance over a WebSocket; it
is not a headless CLI. No editor open, no tools. Godot **4.5 or newer** — 4.3 and 4.4
were measured against the live suite and the editor-mode scene path does not work there.

**Local only, one editor at a time.** Port 6505 on localhost, first come first served.
Two projects open at once means the second one loses; set `GODOT_MCP_PORT` on both the
server and the addon, or `GODOT_MCP_PROJECT` so the bridge refuses the wrong project
instead of silently driving it.

**A closed scene is edited on disk, with no undo entry.** When the scene is *open*
everything goes through Godot's undo history and Ctrl+Z works, including over a whole
`batch_scene_edit`. When it is closed there is no history to write to — use version
control. Many destructive tools take `dry_run: true` to preview first.

**Enabling a toolset mid-session may not reach your client.** Only `core` (38 tools) is
on by default. `enable_toolset` flips it server-side and the server does send
`notifications/tools/list_changed`, but several clients cache the tool list for the
whole session and never re-fetch — and then the newly enabled tools stay invisible until
you restart the client. If you know you want them, set
`GODOT_MCP_TOOLSETS=runtime,debug` (or `all`) so they are in the *first* list.

**`game_eval` runs your snippet inside the running game.** Code that does not compile is
caught in the editor before the game ever sees it. A snippet that fails at *runtime* —
dereferencing a freed node, calling a method that does not exist — halts the game under
the editor's attached debugger, and the call times out instead of returning an error.
That is the debugger, not the bridge: launch with `run_scene({attach_debugger: false})`
and the same bad snippet comes back as a result in ~18ms with the connection intact
(measured). The trade is stated in the tool description — no step-debugging, and
`get_errors` loses its Debugger>Errors source.

### What has been measured, and when

Numbers rather than adjectives, all from 2026-09-03 against a 24,880-file project:

| | |
|---|---|
| Default tool surface | 38 tools, **8,764 tokens** of schema (everything on: 231 / 49,811) |
| Slowest read-only tool | `get_project_statistics` at **2,012 ms** — it answers in the MCP server; the in-editor version took 120,685 ms |
| Largest answer | `map_project` at **7,744 chars** — it used to return 151,159 |
| Runtime helper connect | **1.6-1.7 s**, attached or detached |
| `game_eval` runtime error, detached | **18 ms**, connection survives |
| Mutating tools pointed at a target that cannot exist | 70 editor-side + 11 runtime, **none reports success** |
| Path-traversal attempts against the sandbox | 16 refused, 11 odd-but-contained inputs checked by where they resolve, **zero escapes** |
| Tests | 243 Node unit, 44 live against a real editor, 786 GDScript — green on Godot 4.5 and 4.7 |

Every one of those is re-runnable: `mcp-server/scripts/measure-tools.mjs` for the
schema cost, `scripts/measure-runtime-cost.gd` for per-tool time and payload, and the
rest are assertions in the suites.

**C# is scaffolding only.** `create_csharp_script` writes a correctly-shaped file and
`csharp_status` tells you honestly whether this editor can run C# at all (a standard,
non-Mono build cannot). The language-server and debugger tools cover GDScript, not C#.
The blocker is upstream: Godot has no non-interactive way to generate the `.csproj`,
verified across four CI runs.

**The AI still does not know Godot as well as you do.** It struggles with complex UI
layouts, compositing scenes, and some property manipulation. It cannot build a game on
its own — it debugs, writes scripts, runs and inspects the thing, and keeps you company
while you do. Feedback welcome.

---

## 🔧 Development

To build from source instead of using npm:

```bash
cd mcp-server
npm install
npm run build
```

Then point your AI client at `mcp-server/dist/index.js` instead of using `npx`.

---

## 📖 Release notes

Narrative write-ups of each release live in [`release-notes/`](./release-notes/) — latest is [v1.2.0](./release-notes/v1.2.0.md). For the full change history, see [`CHANGELOG.md`](./CHANGELOG.md).

---

## 🤝 Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Security issues: see [`SECURITY.md`](./SECURITY.md) instead of opening a public issue.

---

## 📄 License

MIT

---

**[Report Issues](https://github.com/TomasLucasUTN/godot-mcp-bridge/issues)**
