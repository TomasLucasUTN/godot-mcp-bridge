# Testing

## Running tests

```bash
cd mcp-server

# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/) and run against real servers on high ports (16505+) — no mocks for networking code.

---

## Automated tests

`cd mcp-server && npm test` runs the Node suite; `pwsh scripts/test-gd.ps1` runs
the GDScript one. Current: **243 Node**, **44 live** (skipped without an editor),
**786 GDScript**.

The checklists that used to live here went stale as soon as a test was added, so
this is an index instead — each file is the authority on what it asserts, and
most of them exist because something specific went wrong once.

| File | What it holds the line on |
|---|---|
| `godot-bridge.test.ts` | WebSocket lifecycle, the `tool_invoke` protocol, and that a pending call is rejected rather than lost on disconnect |
| `primary-http.test.ts` | The primary's HTTP surface and the proxy-client census behind the editor's "Agents (N)" |
| `proxy-client.test.ts` | Probing for an existing primary, forwarding a call, and register/unregister surviving a server that is not there |
| `tool-registry.test.ts` | Every advertised tool is wired, uniquely named, and reachable — a new tool that skips a step fails the build |
| `schema-handler-parity.test.ts` | A schema and its GDScript handler agree on argument names |
| `tool-annotations.test.ts` | Read-only and destructive hints match what the tool actually does |
| `mcp-surface.test.ts` | The MCP-level shape of what the server advertises |
| `toolset-visibility.test.ts` | enable/disable changes the list of THIS process, and `list_toolsets` stays cheap by default |
| `tool-search.test.ts`, `tool-search-quality.test.ts` | `find_tools` ranking, with a measured floor on top-1 and top-3 accuracy |
| `lsp-path-guard.test.ts` | The `gd_*` tools cannot read or write outside the project, and refuse files that are not GDScript |
| `lsp-document-sync.test.ts` | The language server is told when a file it has open changed — two renames in a row used to corrupt the source |
| `dap-start-refusal.test.ts` | A debug session that cannot start fails the call instead of the server |
| `dry-run-coverage.test.ts` | Every tool that claims `dry_run` actually previews |
| `confirmation-gate.test.ts` | The destructive tools that require an explicit confirm still do |
| `handshake-auth.test.ts` | Only an authorised client gets a connection |
| `activity-feed.test.ts` | The editor-activity digest the developer's own edits ride back on |
| `project-scan.test.ts`, `project-map.test.ts` | The two answers that used to be measured in the hundreds of thousands of characters |
| `project-binding.test.ts` | A server answers about the project it is actually bound to |
| `scene-tree-app.test.ts` | The MCP App's parser, injected into the page as source |
| `cli.test.ts` | `install` / `doctor` behave on a real directory |
| `sync-about.test.ts` | The published description matches the code |
| `e2e-godot.test.ts` | The live suite: skipped without an editor on 6505, run against a real one |

The GDScript suite (`mcp-server/src/tests/fixtures/e2e-project/tests/run_tests.gd`)
instantiates the tool handlers directly and exercises their on-disk path. Add a
case there when you change what a tool writes — it is the regression net a
refactor needs, and every fix in the last few releases has one.

---

## Manual tests (pre-release)

These require a running Godot editor with the MCP plugin enabled.

### Server startup
- [ ] Server starts in PRIMARY mode when no existing instance is running
- [ ] Server starts in PROXY mode when a primary is already running
- [ ] Server exits with code 1 when WebSocket server fails to bind (non-EADDRINUSE)
- [ ] Server recovers from EADDRINUSE by killing zombie and retrying
- [ ] `--no-force` flag prevents killing existing processes on the port

### Godot connection
- [ ] Godot plugin auto-connects when the MCP server is running
- [ ] Toolbar shows correct status: `MCP: Connecting...` → `MCP: Agent Active`
- [ ] Reconnects after Godot editor restart
- [ ] Reconnects after MCP server restart

### Tool execution (spot check — pick 3-5 tools per release)
- [ ] `get_runtime_status` returns connection info
- [ ] File tools: `list_dir`, `read_file`, `search_project`
- [ ] Scene tools: `read_scene`, `scene_tree_dump`, `get_node_properties`
- [ ] Script tools: `create_script`, `edit_script`
- [ ] Project tools: `get_project_settings`, `map_project`

### Multi-session
- [ ] Second AI client connects as proxy
- [ ] Proxy tool calls reach Godot and return results
- [ ] Toolbar shows correct agent count (`MCP: Agents (N)`)
- [ ] Primary stays alive after direct client disconnects (idle timeout)
- [ ] Primary shuts down after idle timeout with no connections

### Addon (only when `addons/godot_mcp/` changed)
- [ ] Plugin enables/disables cleanly in Project Settings → Plugins
- [ ] Plugin works on a fresh Godot project (no prior config)
- [ ] Plugin works across Godot versions (4.2+)
