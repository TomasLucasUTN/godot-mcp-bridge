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

### GodotBridge (`src/tests/godot-bridge.test.ts`)

**Lifecycle**
- [ ] `isListening()` is false before start
- [ ] `isListening()` is true after start
- [ ] `isListening()` is false after stop
- [ ] `isListening()` is false after failed start (port occupied)
- [ ] `stop()` is idempotent
- [ ] `isConnected()` is false when no client is connected
- [ ] `getStatus()` reflects initial state (port, connected, pendingRequests)

**Connection management**
- [ ] Accepts a WebSocket connection and reports `isConnected()`
- [ ] `onConnectionChange(true)` fires when a client connects
- [ ] `onConnectionChange(false)` fires when a client disconnects
- [ ] `offConnectionChange` removes the callback
- [ ] Rejects a second simultaneous connection (close code 4000)

**WebSocket protocol**
- [ ] Handles `godot_ready` message and sets `projectPath`
- [ ] `invokeTool` sends `tool_invoke` and resolves on success result
- [ ] `invokeTool` rejects on error result
- [ ] `invokeTool` rejects on timeout
- [ ] `invokeTool` throws if Godot is not connected
- [ ] Pending requests are rejected on client disconnect
- [ ] Pending requests are rejected on server stop
- [ ] `sendClientStatus` sends `client_status` message to connected client

### PrimaryHttpServer (`src/tests/primary-http.test.ts`)

**Lifecycle**
- [ ] `isListening()` is false before start
- [ ] `isListening()` is true after start
- [ ] `isListening()` is false after stop
- [ ] `stop()` is idempotent
- [ ] `proxyClientCount` starts at 0

**HTTP endpoints**
- [ ] `GET /health` returns `{ server, version }`
- [ ] `GET /health` updates `lastActivityTime`
- [ ] `POST /tool` calls the executor and returns result
- [ ] `POST /tool` with missing `name` returns 400
- [ ] `POST /tool` with no `args` defaults to empty object
- [ ] `POST /client/register` increments proxy client count
- [ ] `POST /client/unregister` decrements proxy client count
- [ ] `POST /client/unregister` does not go below 0
- [ ] Client count change callback fires on register/unregister
- [ ] Unknown route returns 404
- [ ] Executor error returns 500

### Proxy client (`src/tests/proxy-client.test.ts`)

**probeExistingServer**
- [ ] Returns `alive:true` when a primary server is running
- [ ] Returns `alive:false` when no server is running

**proxyToolCall**
- [ ] Forwards a tool call and returns the result
- [ ] Rejects when no server is running

**register / unregister**
- [ ] Register increments and unregister decrements the count
- [ ] Register does not throw when server is down
- [ ] Unregister does not throw when server is down

### Tool registry (`src/tests/tool-registry.test.ts`)

- [ ] Exports a non-empty list of tools
- [ ] Every tool has `name`, `description`, and `inputSchema`
- [ ] Tool names are unique
- [ ] `toolExists` returns true for known tools
- [ ] `toolExists` returns false for unknown tools

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
- [ ] `get_godot_status` returns connection info
- [ ] File tools: `list_dir`, `read_file`, `write_file`
- [ ] Scene tools: `get_scene_tree`, `get_node_properties`
- [ ] Script tools: `read_script`, `update_script`
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
