# Security Policy

## Reporting a vulnerability

If you find a security issue (e.g. a path-traversal bypass, a way to reach
files outside the project root, or a way to get the MCP server to execute
something it shouldn't), please report it privately rather than opening a
public issue:

1. Preferred: use GitHub's [private vulnerability reporting](https://github.com/TomasLucasUTN/godot-mcp-bridge/security/advisories/new) ("Report a vulnerability" under the repo's Security tab).
2. If that's not available, open an issue asking for a private channel and we'll follow up.

Please include:
- The tool(s) or code path involved
- Steps to reproduce
- What you'd expect vs. what actually happens

## Scope

This project runs entirely on `localhost` and is meant to be used by one
trusted AI client controlling one local Godot editor/game process. It is not
designed or hardened for exposure over a network, and doing so is out of
scope for this policy — don't do that.

Within that local-only scope, things worth reporting include: a path
guard (`PathGuard`) bypass that reaches files outside the project directory,
an RCE-shaped bug reachable from a tool's arguments, or a way for the
WebSocket bridge to accept connections/commands it shouldn't.

## What guards the bridge

The bridge listens on a WebSocket port (6505 by default). Anything that can
complete that handshake can issue tool calls — which write files into the
project and evaluate GDScript in the running game. Four things stand between a
process and that:

1. **Loopback binding.** The server binds `127.0.0.1`, so nothing off this
   machine can reach it.
2. **Origin rejection.** Loopback binding alone does *not* keep the local
   browser out: a WebSocket handshake is not subject to the same-origin policy,
   so a page the developer happens to visit while the editor is open could
   otherwise connect and drive it. Browsers always send an `Origin` header on
   that handshake and cannot be told not to; Godot's `WebSocketPeer` never sends
   one. The bridge refuses any handshake carrying `Origin`. Always on, no
   configuration.
3. **Project binding** (opt-in, `GODOT_MCP_PROJECT`). The addon dials a fixed
   port and cannot tell which server answered, so with several editors open the
   wrong one can be handed the editor slot. When set, an editor with a different
   project open is refused.
4. **Shared secret** (opt-in, `GODOT_MCP_SECRET` on the server plus the same
   value in the editor via that env var or the `godot_mcp/network/secret`
   project setting). Covers what Origin rejection cannot: another *native*
   process on the same machine opening a plain WebSocket and claiming to be
   Godot. Compared in constant time. Prefer the env var over the project setting
   if the value is sensitive — `project.godot` is usually committed.

Worth reporting: any way to complete the handshake that bypasses 2 or 4, or to
issue a tool call without completing it.
