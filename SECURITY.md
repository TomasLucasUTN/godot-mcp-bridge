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
