/**
 * An MCP App: the scene tree, rendered inline in the client instead of read as
 * a wall of indented text.
 *
 * This is the bidirectional pitch made visible. The model already gets the tree
 * as text; what it could never do is let the DEVELOPER point at a node. Here
 * they can — clicking one sends `ui/update-model-context`, so the next thing
 * the model reads is "the human is looking at Player/AttackBox".
 *
 * Extension: `io.modelcontextprotocol/ui` (SEP-1865), stable spec 2026-01-26.
 * Hosts that do not support it ignore the `_meta.ui` on the tool and the
 * resource, and the tool keeps returning exactly the text it returned before —
 * this adds a surface, it does not change one.
 *
 * No framework and no external fetch on purpose: the host frames this in a
 * sandboxed iframe under a CSP, and a dependency-free page needs no
 * `connectDomains` grant at all.
 */

export const SCENE_TREE_APP_URI = 'ui://godot-mcp-bridge/scene-tree';

/** The one mimeType the spec allows for an app resource. */
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

export interface SceneTreeNode {
  name: string;
  type: string;
  script: string | null;
  hidden: number;
  children: SceneTreeNode[];
}

/**
 * Turn the tool's indented text into nodes.
 *
 *   Player (CharacterBody2D) [player.gd]
 *     AttackBox (Area2D)  (+1 descendant node(s), depth-limited)
 *
 * Parsing here rather than changing the Godot side means the text the MODEL
 * receives is byte-for-byte what it always was; the panel is additive.
 *
 * Defined as a standalone function with no closure so it can be both unit
 * tested here and stringified into the page below — the page runs this exact
 * code, not a copy that can drift from it.
 */
export function parseSceneTreeText(text: string): SceneTreeNode[] {
  const LINE = /^(\s*)(.+?) \(([^)]+)\)(?: \[([^\]]+)\])?(?:\s+\(\+(\d+) descendant)?/;
  const roots: SceneTreeNode[] = [];
  const stack: SceneTreeNode[] = [];
  for (const raw of String(text).split('\n')) {
    if (!raw.trim()) continue;
    const m = LINE.exec(raw);
    if (!m) continue;
    const depth = Math.floor(m[1].length / 2);
    const node: SceneTreeNode = {
      name: m[2].trim(),
      type: m[3],
      script: m[4] || null,
      hidden: m[5] ? Number(m[5]) : 0,
      children: [],
    };
    while (stack.length > depth) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

export const SCENE_TREE_APP_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root {
    color-scheme: light dark;
    --fg: #1c1c1e;
    --dim: #6b6b70;
    --line: #d8d8dc;
    --accent: #478cbf;      /* Godot blue */
    --chip: #eceef1;
    --sel: #478cbf22;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #e6e6e8; --dim: #9a9aa0; --line: #34343a;
      --chip: #26262b; --sel: #478cbf33;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 10px 12px;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--fg); background: transparent;
  }
  header { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  #path { color: var(--dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #filter {
    flex: 1 1 120px; min-width: 80px; padding: 4px 8px;
    border: 1px solid var(--line); border-radius: 6px;
    background: transparent; color: var(--fg); font: inherit; font-size: 12px;
  }
  ul { list-style: none; margin: 0; padding-left: 14px; }
  #root { padding-left: 0; }
  li { position: relative; }
  .row {
    display: flex; align-items: baseline; gap: 6px;
    padding: 1px 4px; border-radius: 4px; cursor: default;
  }
  .row:hover { background: var(--chip); }
  .row.sel { background: var(--sel); }
  .row.hit .name { text-decoration: underline; text-decoration-color: var(--accent); }
  .tw {
    width: 12px; flex: 0 0 12px; color: var(--dim);
    cursor: pointer; user-select: none; text-align: center;
  }
  .name { font-weight: 600; }
  .type { color: var(--dim); }
  .script { color: var(--accent); }
  .more { color: var(--dim); font-style: italic; }
  .collapsed > ul { display: none; }
  footer { margin-top: 10px; color: var(--dim); font-size: 11px; }
  .empty { color: var(--dim); padding: 8px 0; }
</style>
</head>
<body>
<header>
  <input id="filter" type="search" placeholder="filter nodes…" autocomplete="off">
  <span id="path"></span>
</header>
<div id="tree"><div class="empty">Waiting for the scene tree…</div></div>
<footer id="status"></footer>

<script>
(() => {
  "use strict";

  // ---- host transport (JSON-RPC 2.0 over postMessage) ---------------------
  let seq = 0;
  const pending = new Map();

  function send(msg) { window.parent.postMessage(msg, "*"); }

  function request(method, params) {
    const id = "n" + (++seq);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
      // A host that does not implement an optional method may simply never
      // answer; nothing here should hang waiting for it.
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error("timeout: " + method));
      }, 4000);
    });
  }

  function notify(method, params) {
    send({ jsonrpc: "2.0", method, params });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message || "host error")) : resolve(msg.result);
      return;
    }

    if (msg.method === "ui/notifications/tool-result") {
      render(msg.params && msg.params.result);
    }
  });

  // ---- tree text -> model -------------------------------------------------
  // Injected from parseSceneTreeText() in scene-tree-app.ts, so the unit tests
  // exercise this exact function rather than a copy that can drift from it.
  ${parseSceneTreeText.toString()}
  const parse = parseSceneTreeText;

  // ---- render -------------------------------------------------------------
  const treeEl = document.getElementById("tree");
  const statusEl = document.getElementById("status");
  const pathEl = document.getElementById("path");
  const filterEl = document.getElementById("filter");

  let selected = null;
  let total = 0;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function nodeEl(node, parentPath) {
    total++;
    const path = parentPath ? parentPath + "/" + node.name : node.name;
    const li = el("li");
    const row = el("div", "row");
    row.dataset.path = path;
    row.dataset.search = (node.name + " " + node.type + " " + (node.script || "")).toLowerCase();

    const twisty = el("span", "tw", node.children.length ? "▾" : "");
    if (node.children.length) {
      twisty.addEventListener("click", (e) => {
        e.stopPropagation();
        li.classList.toggle("collapsed");
        twisty.textContent = li.classList.contains("collapsed") ? "▸" : "▾";
      });
    }
    row.append(twisty, el("span", "name", node.name), el("span", "type", "(" + node.type + ")"));
    if (node.script) row.append(el("span", "script", "[" + node.script + "]"));
    if (node.hidden) row.append(el("span", "more", "+" + node.hidden + " hidden"));

    row.addEventListener("click", () => select(row, path, node));
    li.append(row);

    if (node.children.length) {
      const ul = el("ul");
      for (const child of node.children) ul.append(nodeEl(child, path));
      li.append(ul);
    }
    return li;
  }

  // Clicking a node tells the MODEL what the developer is pointing at. That is
  // the whole reason this app exists rather than a prettier text dump.
  function select(row, path, node) {
    if (selected) selected.classList.remove("sel");
    selected = row;
    row.classList.add("sel");
    statusEl.textContent = path + "  —  " + node.type + (node.script ? "  " + node.script : "");
    request("ui/update-model-context", {
      context: "The developer is looking at the node " + path +
               " (" + node.type + ")" + (node.script ? " with script " + node.script : "") + ".",
    }).catch(() => { /* host may not implement it; the panel still works */ });
  }

  function render(result) {
    let data = result;
    if (data && data.structuredContent) data = data.structuredContent;
    if (data && Array.isArray(data.content)) {
      const textPart = data.content.find((c) => c && c.type === "text");
      if (textPart) { try { data = JSON.parse(textPart.text); } catch { data = { tree: textPart.text }; } }
    }
    if (!data || typeof data.tree !== "string") {
      treeEl.replaceChildren(el("div", "empty", "No scene tree in this result."));
      return;
    }

    pathEl.textContent = data.scene_path || "";
    total = 0;
    const roots = parse(data.tree);
    const ul = el("ul");
    ul.id = "root";
    for (const node of roots) ul.append(nodeEl(node, ""));
    treeEl.replaceChildren(ul);
    statusEl.textContent = total + " node" + (total === 1 ? "" : "s") +
      (data.max_depth && data.max_depth > 0 ? "  ·  depth " + data.max_depth : "");
    reportSize();
  }

  filterEl.addEventListener("input", () => {
    const q = filterEl.value.trim().toLowerCase();
    for (const row of treeEl.querySelectorAll(".row")) {
      row.classList.toggle("hit", q !== "" && row.dataset.search.includes(q));
    }
  });

  function reportSize() {
    notify("ui/notifications/size-changed", {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    });
  }
  window.addEventListener("resize", reportSize);

  // ---- handshake ----------------------------------------------------------
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    clientInfo: { name: "godot-mcp-bridge/scene-tree", version: "1" },
  }).then((result) => {
    // A host may hand the first tool result back through the handshake instead
    // of a notification.
    if (result && result.toolResult) render(result.toolResult);
  }).catch(() => { /* older hosts skip the handshake; notifications still arrive */ })
    .finally(() => {
      notify("ui/notifications/initialized", {});
      reportSize();
    });
})();
</script>
</body>
</html>`;

/** The resource entry, in the shape resources/list and resources/read want. */
export const SCENE_TREE_APP_RESOURCE = {
  uri: SCENE_TREE_APP_URI,
  name: 'Scene tree (interactive)',
  description:
    "The open scene's node tree, rendered as a collapsible panel instead of indented text. Clicking a node tells the model what the developer is pointing at.",
  mimeType: MCP_APP_MIME,
  _meta: {
    ui: {
      // Nothing is fetched, so no domain needs granting.
      csp: { connectDomains: [], resourceDomains: [] },
      prefersBorder: true,
    },
  },
} as const;
