/**
 * An MCP App for `analyze_2d_layout`: the findings, drawn.
 *
 * Every bug this tool reports is geometric — a piece 8px above the ground, a
 * silhouette fused into a platform, a 96px hole — and geometry read as a list
 * of numbers is the format that let all four of them ship in the first place.
 * The text answer stays exactly as it was; this is the same data with the
 * boxes where they actually are, and the findings picked out in it.
 *
 * Needs `include_rects: true` on the call. Without it the panel says so rather
 * than drawing an empty scene, because "nothing found" and "nothing sent" look
 * identical on a canvas.
 *
 * Extension: `io.modelcontextprotocol/ui` (SEP-1865). Same handshake and
 * transport as the scene-tree app; hosts without it never ask for this
 * resource.
 */

import { MCP_APP_MIME } from './scene-tree-app.js';

export const LAYOUT_APP_URI = 'ui://godot-mcp-bridge/layout';

export const LAYOUT_APP_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root {
    color-scheme: light dark;
    --fg: #1c1c1e; --dim: #6b6b70; --line: #d8d8dc; --chip: #eceef1;
    --solid: #6b7480; --decor: #478cbf;
    --bad: #d1495b; --warn: #e08e45; --gap: #b5179e;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e6e6e8; --dim: #9a9aa0; --line: #34343a; --chip: #26262b; --solid: #8a939f; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 10px 12px; color: var(--fg); background: transparent;
    font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  header { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; margin-bottom: 8px; }
  #scene { color: var(--dim); font-size: 12px; }
  canvas { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; display: block; }
  #legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 6px; font-size: 11px; color: var(--dim); }
  .key { display: inline-flex; align-items: center; gap: 5px; }
  .sw { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
  ul { list-style: none; margin: 6px 0 0; padding: 0; }
  li { padding: 2px 4px; border-radius: 4px; cursor: default; }
  li:hover, li.on { background: var(--chip); }
  .tag { font-weight: 600; }
  .num { color: var(--dim); }
  .empty { color: var(--dim); padding: 10px 0; }
</style>
</head>
<body>
<header><strong>2D layout</strong><span id="scene"></span></header>
<div id="stage"><div class="empty">Waiting for a layout analysis…</div></div>
<div id="legend"></div>
<ul id="findings"></ul>

<script>
(() => {
  "use strict";

  let seq = 0;
  const pending = new Map();
  const send = (m) => window.parent.postMessage(m, "*");
  function request(method, params) {
    const id = "n" + (++seq);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => { if (pending.delete(id)) reject(new Error("timeout")); }, 4000);
    });
  }
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message || "host error")) : resolve(msg.result);
      return;
    }
    if (msg.method === "ui/notifications/tool-result") render(msg.params && msg.params.result);
  });

  const stage = document.getElementById("stage");
  const legendEl = document.getElementById("legend");
  const findingsEl = document.getElementById("findings");
  const sceneEl = document.getElementById("scene");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function key(color, label) {
    const k = el("span", "key");
    const sw = el("span", "sw");
    sw.style.background = color;
    k.append(sw, document.createTextNode(label));
    return k;
  }

  // World space -> canvas, y down in both, so no flip. Fits the content with a
  // small margin; a scene is wider than tall far more often than not.
  function fit(rects, width, height, pad) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    if (!isFinite(minX)) return null;
    const scale = Math.min((width - pad * 2) / Math.max(maxX - minX, 1), (height - pad * 2) / Math.max(maxY - minY, 1));
    return { scale, minX, minY, pad };
  }
  const tx = (v, f) => (v - f.minX) * f.scale + f.pad;
  const ty = (v, f) => (v - f.minY) * f.scale + f.pad;

  function render(result) {
    let data = result;
    if (data && data.structuredContent) data = data.structuredContent;
    if (data && Array.isArray(data.content)) {
      const part = data.content.find((c) => c && c.type === "text");
      if (part) { try { data = JSON.parse(part.text); } catch { data = null; } }
    }
    if (!data || typeof data !== "object") return;

    sceneEl.textContent = (data.scene_path || "") + (data.read_from ? "  ·  " + data.read_from : "");

    const rects = data.rects;
    if (!rects || !Array.isArray(rects.solids)) {
      stage.replaceChildren(el("div", "empty",
        "This analysis was returned without geometry. Call analyze_2d_layout again with include_rects: true to draw it."));
      legendEl.replaceChildren();
      listFindings(data);
      return;
    }

    const solids = rects.solids || [];
    const decor = rects.decorations || [];
    const all = solids.concat(decor);

    const W = 900, H = 420, PAD = 14;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const f = fit(all, W, H, PAD);
    if (!f) {
      stage.replaceChildren(el("div", "empty", "No 2D geometry in this scene."));
      return;
    }

    const style = getComputedStyle(document.documentElement);
    const col = (name) => style.getPropertyValue(name).trim();

    const flagged = new Map();
    for (const item of data.floating || []) flagged.set(item.path, { kind: "floating", detail: item.gap_px + "px of air" });
    for (const item of data.over_nothing || []) flagged.set(item.path, { kind: "over nothing", detail: "no floor under it" });
    for (const item of data.overlaps || []) {
      const at = flagged.get(item.decoration);
      const note = "fused into " + item.solid;
      flagged.set(item.decoration, at ? { kind: at.kind + " + fused", detail: at.detail + "; " + note } : { kind: "fused", detail: note });
    }

    ctx.lineWidth = 1;
    for (const r of solids) {
      ctx.fillStyle = col("--solid") + "44";
      ctx.strokeStyle = col("--solid");
      ctx.fillRect(tx(r.x, f), ty(r.y, f), r.w * f.scale, r.h * f.scale);
      ctx.strokeRect(tx(r.x, f), ty(r.y, f), r.w * f.scale, r.h * f.scale);
    }
    for (const r of decor) {
      const bad = flagged.get(r.path);
      ctx.strokeStyle = bad ? col("--bad") : col("--decor");
      ctx.fillStyle = (bad ? col("--bad") : col("--decor")) + "33";
      ctx.lineWidth = bad ? 2 : 1;
      ctx.fillRect(tx(r.x, f), ty(r.y, f), r.w * f.scale, r.h * f.scale);
      ctx.strokeRect(tx(r.x, f), ty(r.y, f), r.w * f.scale, r.h * f.scale);
      ctx.lineWidth = 1;
    }
    // Floor gaps as a band along the bottom of the solids they sit between:
    // the width is the number that decides whether the level is crossable.
    for (const gap of data.floor_gaps || []) {
      const y = ty(Math.max(...solids.map((s) => s.y), 0), f);
      ctx.fillStyle = col("--gap") + (gap.clearable === false ? "66" : "33");
      ctx.fillRect(tx(gap.from_x, f), y, (gap.to_x - gap.from_x) * f.scale, 10);
      ctx.fillStyle = col("--gap");
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(gap.width_px + (gap.clearable === false ? "px ✗" : "px"), tx(gap.from_x, f), y - 3);
    }

    stage.replaceChildren(canvas);
    legendEl.replaceChildren(
      key(col("--solid"), "solid"),
      key(col("--decor"), "decoration"),
      key(col("--bad"), "flagged"),
      key(col("--gap"), "floor gap"),
    );
    listFindings(data, flagged);
    reportSize();
  }

  function listFindings(data, flagged) {
    const items = [];
    for (const [path, info] of (flagged || new Map())) items.push([path, info.kind, info.detail]);
    for (const gap of data.floor_gaps || []) {
      items.push(["floor " + gap.from_x + "→" + gap.to_x, "gap",
        gap.width_px + "px" + (gap.clearable === undefined ? "" : gap.clearable ? " (clears)" : " (does not clear)")]);
    }
    findingsEl.replaceChildren();
    if (items.length === 0) {
      findingsEl.append(el("li", "num", data.summary || "Nothing flagged."));
      return;
    }
    for (const [path, kind, detail] of items) {
      const li = el("li");
      li.append(el("span", "tag", kind + "  "), document.createTextNode(path + "  "), el("span", "num", detail || ""));
      findingsEl.append(li);
    }
  }

  function reportSize() {
    notify("ui/notifications/size-changed", {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    });
  }
  window.addEventListener("resize", reportSize);

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    clientInfo: { name: "godot-mcp-bridge/layout", version: "1" },
  }).then((r) => { if (r && r.toolResult) render(r.toolResult); })
    .catch(() => {})
    .finally(() => { notify("ui/notifications/initialized", {}); reportSize(); });
})();
</script>
</body>
</html>`;

export const LAYOUT_APP_RESOURCE = {
  uri: LAYOUT_APP_URI,
  name: '2D layout (drawn)',
  description:
    "analyze_2d_layout's findings drawn in world space: solids, decoration, the pieces flagged as floating or fused, and every floor gap with its width. Needs include_rects: true on the call.",
  mimeType: MCP_APP_MIME,
  _meta: {
    ui: {
      csp: { connectDomains: [], resourceDomains: [] },
      prefersBorder: true,
    },
  },
} as const;
