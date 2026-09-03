/**
 * What `map_project` hands back to the model.
 *
 * The crawl produces the full structure of every script in the project,
 * including the body of every function it declares. That is the right payload
 * for the interactive visualisation, and the wrong one for a conversation:
 * measured on a 24,880-file project it is 151,159 characters, roughly 37k
 * tokens — seven times the next largest tool answer here, and about a fifth of
 * a 200k context window spent on data the browser is already showing.
 *
 * So the model gets an index instead: one line per script, which is 7,744
 * characters for the same project. `include_map` opts back into the whole
 * thing for the rare caller that genuinely wants it in context.
 */

export interface ProjectMapNode {
  path?: unknown;
  class_name?: unknown;
  extends?: unknown;
  line_count?: unknown;
  functions?: unknown;
  signals?: unknown;
  connections?: unknown;
}

export interface ProjectMap {
  nodes?: ProjectMapNode[];
  edges?: unknown[];
  total_scripts?: number;
  total_connections?: number;
}

export interface ScriptIndexEntry {
  path: unknown;
  class_name: string | null;
  extends: unknown;
  lines: number;
  functions: number;
  signals: number;
  connections: number;
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** One line per script: everything cheap, nothing that carries a function body. */
export function indexScripts(map: ProjectMap): ScriptIndexEntry[] {
  const nodes = Array.isArray(map.nodes) ? map.nodes : [];
  return nodes.map((node) => ({
    path: node.path ?? null,
    class_name: typeof node.class_name === 'string' && node.class_name !== '' ? node.class_name : null,
    extends: node.extends ?? null,
    lines: typeof node.line_count === 'number' ? node.line_count : 0,
    functions: count(node.functions),
    signals: count(node.signals),
    connections: count(node.connections),
  }));
}

export function projectMapAnswer(
  map: ProjectMap,
  visualizationUrl: string,
  includeMap: boolean
): Record<string, unknown> {
  const scripts = indexScripts(map);
  const totalScripts = map.total_scripts ?? scripts.length;
  const totalConnections = map.total_connections ?? 0;

  return {
    ok: true,
    visualization_url: visualizationUrl,
    total_scripts: totalScripts,
    total_connections: totalConnections,
    scripts,
    ...(includeMap ? { project_map: map } : {}),
    message: `Project mapped: ${totalScripts} scripts, ${totalConnections} connections. The interactive map is at ${visualizationUrl}.`,
    ...(includeMap ? {} : {
      note: 'Returned an index (one line per script) rather than the full map, which is where this tool used to spend ~37k tokens per call. Open the URL for the detail, read a specific script for its body, or pass include_map: true if you really need the whole structure inline.',
    }),
  };
}
