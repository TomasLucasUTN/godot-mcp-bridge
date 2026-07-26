# godot-mcp-bridge

**Give your AI assistant full access to the Godot editor.**

Build games faster with Claude, Cursor, or any MCP-compatible AI — no copy-pasting, no context switching. The AI reads, writes, and manipulates your scenes, scripts, nodes, and project settings directly inside the running Godot editor.

> Godot 4.3+ · 209 tools (35 loaded by default) · Live-tree editing with undo · Interactive project visualizer · MIT license

See the [project README](https://github.com/TomasLucasUTN/godot-mcp-bridge#readme) for the full tool breakdown, architecture, and setup guide. This file is the condensed version shown on npm.

---

## Quick Start

### 1. Install the Godot plugin

```bash
npx godot-mcp-bridge install
```

Run from inside your Godot project folder — copies the addon into `addons/godot_mcp/` and enables the plugin. Or copy `addons/godot_mcp/` from the [GitHub repo](https://github.com/TomasLucasUTN/godot-mcp-bridge) by hand and enable it under Project Settings → Plugins. (The "Godot AI Assistant tools MCP" AssetLib listing belongs to the upstream project this forked from, not this repo.)

### 2. Add the server to your AI client

**Claude Desktop / Cursor** — add to the client's MCP config:
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

Windows: use `"command": "cmd", "args": ["/c", "npx", "-y", "godot-mcp-bridge"]`.

Works with any MCP-compatible client (Claude Code, Cline, Windsurf, etc.)

### 3. Connect

Restart your AI client, then restart your Godot project. Check the **top-right corner** of the editor for **MCP Connected** in green.

---

## What Can It Do?

209 tools grouped by intent; only `core` (35 tools) loads by default so the agent stays focused. `enable_toolset({ name: "..." })` pulls in more — runtime control, scene editing, project config, animation, physics, analysis, scaffolding, testing, and more. Edits to a scene that's open in the editor go through the **live tree and Godot's undo system** instead of silently overwriting the `.tscn` file on disk.

### Interactive Visualizer

Run `map_project` and get a browser-based project explorer at `localhost:6510`:

- Force-directed graph of all scripts and their relationships
- Click any script to see variables, functions, signals, and connections
- Edit code directly in the visualizer — changes sync to Godot in real time
- Scene view with node property editing
- Find usages before refactoring

---

## Current Limitations

- **Local only** — runs on localhost, no remote connections
- **Single connection** — one Godot instance at a time
- **AI has limited Godot knowledge** — it can help debug, write scripts, and build scenes, but can't create a complete game without guidance

---

## Build From Source

```bash
git clone https://github.com/TomasLucasUTN/godot-mcp-bridge
cd godot-mcp-bridge/mcp-server
npm install
npm run build
```

Then point your AI client at `mcp-server/dist/index.js` instead of using `npx`.

---

## License

MIT

---

**[GitHub](https://github.com/TomasLucasUTN/godot-mcp-bridge)** · **[Report Issues](https://github.com/TomasLucasUTN/godot-mcp-bridge/issues)**
