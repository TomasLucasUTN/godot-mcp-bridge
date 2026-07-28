/**
 * The GitHub "About" sentence, and the check for whether the live one still
 * matches it.
 *
 * Split from sync-about.mjs so it can be tested without the network: the check's
 * first CI run printed "About is up to date", which is exactly what a check
 * doing nothing at all would print. A pure module can be pinned by a test.
 */

/** The one sentence GitHub shows. Everything variable in it is computed. */
export function buildDescription(toolCount) {
  return `MCP server for Godot 4 — give Claude, Cursor, or any MCP client full control of the Godot editor: ${toolCount} tools, live-tree editing with undo, DAP step debugger, GDScript LSP, runtime play-testing.`;
}

/** True when the live description already says exactly what it should. */
export function isInSync(current, wanted) {
  return String(current ?? '').trim() === wanted;
}
