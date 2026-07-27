/**
 * Language-server session handling — the server-side half of the gd_* tools.
 *
 * Like the debug_* family, these bypass the addon bridge and talk to a listener
 * the editor owns (the GDScript language server, default port 6005). See
 * lsp-client.ts for the protocol details.
 */

import { readFile, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  LspClient, DEFAULT_LSP_PORT, pathToUri, uriToPath, severityName,
  type Diagnostic,
} from './lsp-client.js';

export const LSP_TOOL_NAMES = new Set([
  'gd_definition', 'gd_references', 'gd_rename', 'gd_diagnostics',
  'gd_hover', 'gd_document_symbols', 'gd_completion', 'gd_lsp_status',
]);

export function isLspTool(name: string): boolean {
  return LSP_TOOL_NAMES.has(name);
}

const LSP_PORT = Number(process.env.GODOT_MCP_LSP_PORT) || DEFAULT_LSP_PORT;

/**
 * The LSP capability each of our tools needs, so drift is visible in both
 * directions.
 *
 * Godot's GDScript server implements far less than a typical language server —
 * `workspaceSymbolProvider`, `codeActionProvider`, `documentFormattingProvider`,
 * `typeDefinitionProvider` and `implementationProvider` are all hardcoded false
 * in `godot_lsp.h`, and call hierarchy does not exist at all. That is why this
 * server wraps six LSP features rather than twenty: the rest would be tools that
 * always answer "not supported".
 *
 * But that is a fact about the Godot version in front of us, not a permanent
 * one. If a later Godot turns one of them on, nothing would have told us — so
 * `gd_lsp_status` reports what the server advertises that we do NOT wrap.
 */
const CAPABILITY_TOOLS: Record<string, string> = {
  definitionProvider: 'gd_definition',
  referencesProvider: 'gd_references',
  renameProvider: 'gd_rename',
  hoverProvider: 'gd_hover',
  documentSymbolProvider: 'gd_document_symbols',
  completionProvider: 'gd_completion',
};

/** True when the server advertised this capability (bool true, or an options object). */
function advertises(capabilities: Record<string, unknown>, key: string): boolean {
  const v = capabilities[key];
  return v === true || (typeof v === 'object' && v !== null);
}

/**
 * What the connected language server can do, what we expose for it, and — the
 * point of this — anything it gained that we have not wrapped.
 */
export function summarizeLspCapabilities(capabilities: Record<string, unknown>): {
  supported_capabilities: string[];
  tools_available: string[];
  tools_unavailable: string[];
  unwrapped_capabilities: string[];
  note: string;
} {
  const supported = Object.keys(capabilities).filter((k) => advertises(capabilities, k));

  const available: string[] = [];
  const unavailable: string[] = [];
  for (const [cap, tool] of Object.entries(CAPABILITY_TOOLS)) {
    (advertises(capabilities, cap) ? available : unavailable).push(tool);
  }

  // Only `*Provider` keys are feature flags; the rest (textDocumentSync and
  // friends) are transport details and would be noise here.
  const unwrapped = supported
    .filter((k) => k.endsWith('Provider') && !CAPABILITY_TOOLS[k])
    .sort();

  let note: string;
  if (supported.length === 0) {
    note = 'The language server has not completed a handshake yet, so nothing is known about its capabilities.';
  } else if (unwrapped.length > 0) {
    note =
      `This Godot advertises ${unwrapped.length} LSP capability/ies with no tool here: ${unwrapped.join(', ')}. ` +
      'That is worth reporting — it means Godot gained a feature this server could expose and does not.';
  } else {
    note =
      'Every LSP capability this Godot advertises is wrapped by a tool. Godot implements far fewer ' +
      'features than a typical language server (no workspace symbols, code actions, formatting, ' +
      'implementations or type definitions), so a small tool count here is the engine\'s limit, not a gap.';
  }

  return {
    supported_capabilities: supported,
    tools_available: available,
    tools_unavailable: unavailable,
    unwrapped_capabilities: unwrapped,
    note,
  };
}

let client: LspClient | null = null;

function getClient(): LspClient {
  if (!client) client = new LspClient('127.0.0.1', LSP_PORT);
  return client;
}

/**
 * res:// (or a project-relative path) → absolute filesystem path, confined to
 * the project directory.
 *
 * This is the TypeScript counterpart of the addon's PathGuard: these tools read
 * and WRITE files (gd_rename applies edits), so an unguarded `path` argument
 * would be an arbitrary-file read/write primitive. A `res://` prefix check
 * alone is not enough — "res://../../etc/passwd" resolves outside the project —
 * so the resolved path is compared against the project root after
 * normalization.
 *
 * Throws on escape; callers surface the message.
 */
export function resolveProjectPath(rawPath: string, projectPath: string | null): string {
  const path = rawPath.trim();
  if (!path) throw new Error("Missing 'path'");
  if (!projectPath) {
    throw new Error('No project path known yet — open a project in the Godot editor first.');
  }

  const root = nodePath.resolve(projectPath.replace(/[/\\]+$/, ''));
  const relative = path.startsWith('res://') ? path.slice('res://'.length) : path;
  const resolved = nodePath.resolve(root, relative);

  // relative() gives "" for the root itself and a path starting with ".." for
  // anything outside it. isAbsolute catches a different-drive result on Windows.
  const rel = nodePath.relative(root, resolved);
  if (rel.startsWith('..') || nodePath.isAbsolute(rel)) {
    throw new Error(`Path escapes the project sandbox: '${rawPath}'`);
  }
  return resolved;
}

/** True when an absolute path is inside the project root. */
export function isInsideProject(absolutePath: string, projectPath: string | null): boolean {
  if (!projectPath) return false;
  const root = nodePath.resolve(projectPath.replace(/[/\\]+$/, ''));
  const rel = nodePath.relative(root, nodePath.resolve(absolutePath));
  return rel !== '' && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
}

/** Absolute path → res:// when it's inside the project, for readable output. */
function toResPath(absolutePath: string, projectPath: string | null): string {
  if (!projectPath) return absolutePath;
  const base = projectPath.replace(/[/\\]+$/, '').replace(/\\/g, '/');
  const p = absolutePath.replace(/\\/g, '/');
  return p.toLowerCase().startsWith(base.toLowerCase())
    ? `res://${p.slice(base.length).replace(/^\/+/, '')}`
    : absolutePath;
}

/**
 * LSP positions are 0-based for both line and character; humans and Godot's own
 * error messages are 1-based. Tool arguments use 1-based, converted here, so a
 * caller can paste a line number straight from an error.
 */
function toLspPosition(line: unknown, column: unknown): { line: number; character: number } {
  return {
    line: Math.max(0, Number(line) - 1),
    character: Math.max(0, Number(column) - 1),
  };
}

function fromLspPosition(pos: { line: number; character: number }): { line: number; column: number } {
  return { line: pos.line + 1, column: pos.character + 1 };
}

interface LocationLike {
  uri?: string;
  targetUri?: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  targetRange?: { start: { line: number; character: number } };
}

function formatLocations(result: unknown, projectPath: string | null): Array<Record<string, unknown>> {
  const list: LocationLike[] = Array.isArray(result) ? result : result ? [result as LocationLike] : [];
  return list.map((loc) => {
    const uri = loc.uri ?? loc.targetUri ?? '';
    const range = loc.range ?? loc.targetRange;
    const start = range?.start ?? { line: 0, character: 0 };
    return {
      path: toResPath(uriToPath(uri), projectPath),
      ...fromLspPosition(start),
    };
  });
}

/**
 * Prepare the server to answer questions about a file: make sure the session is
 * initialized and the document has been opened (Godot only publishes
 * diagnostics for opened documents, and resolves positions more reliably once
 * it has the text).
 */
async function prepareDocument(
  c: LspClient,
  absPath: string,
  projectPath: string | null,
): Promise<{ uri: string; text: string }> {
  await c.ensureInitialized(projectPath ?? process.cwd());
  const uri = pathToUri(absPath);
  const text = await readFile(absPath, 'utf8');
  await c.openDocument(uri, text);
  return { uri, text };
}

function formatDiagnostics(diags: Diagnostic[]): Array<Record<string, unknown>> {
  return diags.map((d) => ({
    severity: severityName(d.severity),
    message: d.message,
    ...fromLspPosition(d.range.start),
    end_line: d.range.end.line + 1,
    source: d.source ?? undefined,
  }));
}

/**
 * Apply a WorkspaceEdit's textDocument changes to disk.
 *
 * Edits within a file are applied bottom-up: an edit changes the length of the
 * text after it, so applying top-down would invalidate every later range's
 * offsets.
 */
async function applyWorkspaceEdit(
  edit: Record<string, unknown>,
  projectPath: string | null,
): Promise<Array<{ path: string; edits: number }>> {
  const changes = (edit['changes'] ?? {}) as Record<string, Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>>;
  const applied: Array<{ path: string; edits: number }> = [];

  for (const [uri, edits] of Object.entries(changes)) {
    const filePath = uriToPath(uri);
    // The URIs come from the language server rather than the caller, but a
    // rename must never write outside the project on anyone's say-so.
    if (!isInsideProject(filePath, projectPath)) {
      throw new Error(`Refusing to edit a file outside the project: ${filePath}`);
    }
    const original = await readFile(filePath, 'utf8');
    // Split on \n but keep \r so CRLF files round-trip unchanged.
    const lines = original.split('\n');

    const sorted = [...edits].sort((a, b) =>
      b.range.start.line - a.range.start.line ||
      b.range.start.character - a.range.start.character);

    for (const e of sorted) {
      const { start, end } = e.range;
      if (start.line === end.line) {
        const line = lines[start.line] ?? '';
        lines[start.line] = line.slice(0, start.character) + e.newText + line.slice(end.character);
      } else {
        const first = (lines[start.line] ?? '').slice(0, start.character);
        const last = (lines[end.line] ?? '').slice(end.character);
        lines.splice(start.line, end.line - start.line + 1, first + e.newText + last);
      }
    }

    await writeFile(filePath, lines.join('\n'), 'utf8');
    applied.push({ path: filePath, edits: edits.length });
  }
  return applied;
}

export async function handleLspTool(
  name: string,
  args: Record<string, unknown>,
  projectPath: string | null,
): Promise<Record<string, unknown>> {
  const c = getClient();

  if (name === 'gd_lsp_status') {
    let reachable = c.isConnected();
    let error: string | undefined;
    if (!reachable) {
      try {
        await c.ensureInitialized(projectPath ?? process.cwd());
        reachable = true;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    return { reachable, port: LSP_PORT, error, ...summarizeLspCapabilities(c.capabilities) };
  }

  const rawPath = String(args.path ?? '').trim();
  if (!rawPath) return { ok: false, error: "Missing 'path'" };

  let uri: string;
  try {
    const absPath = resolveProjectPath(rawPath, projectPath);
    ({ uri } = await prepareDocument(c, absPath, projectPath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, path: rawPath };
  }

  switch (name) {
    case 'gd_definition': {
      if (!c.supports('definitionProvider')) {
        return { ok: false, error: 'This language server does not advertise definition support.' };
      }
      const result = await c.request('textDocument/definition', {
        textDocument: { uri },
        position: toLspPosition(args.line, args.column),
      });
      const locations = formatLocations(result, projectPath);
      return {
        path: rawPath,
        definitions: locations,
        count: locations.length,
        note: locations.length === 0 ? 'No definition found at that position — check that line/column point at the symbol itself.' : undefined,
      };
    }

    case 'gd_references': {
      if (!c.supports('referencesProvider')) {
        return { ok: false, error: 'This language server does not advertise references support.' };
      }
      const result = await c.request('textDocument/references', {
        textDocument: { uri },
        position: toLspPosition(args.line, args.column),
        context: { includeDeclaration: args.include_declaration !== false },
      });
      const locations = formatLocations(result, projectPath);
      return { path: rawPath, references: locations, count: locations.length };
    }

    case 'gd_rename': {
      if (!c.supports('renameProvider')) {
        return { ok: false, error: 'This language server does not advertise rename support.' };
      }
      const newName = String(args.new_name ?? '').trim();
      if (!newName) return { ok: false, error: "Missing 'new_name'" };

      const edit = await c.request<Record<string, unknown>>('textDocument/rename', {
        textDocument: { uri },
        position: toLspPosition(args.line, args.column),
        newName,
      });

      const changes = (edit?.['changes'] ?? {}) as Record<string, unknown[]>;
      const summary = Object.entries(changes).map(([u, edits]) => ({
        path: toResPath(uriToPath(u), projectPath),
        edits: Array.isArray(edits) ? edits.length : 0,
      }));
      const total = summary.reduce((n, s) => n + s.edits, 0);

      if (total === 0) {
        return {
          ok: false,
          error: 'The language server returned no edits — the position may not be a renameable symbol.',
          path: rawPath,
          new_name: newName,
        };
      }

      if (args.apply !== true) {
        return {
          applied: false,
          new_name: newName,
          files: summary,
          total_edits: total,
          message: `Preview only: ${total} edit(s) across ${summary.length} file(s). Call again with apply=true to write them.`,
        };
      }

      const written = await applyWorkspaceEdit(edit, projectPath);
      return {
        applied: true,
        new_name: newName,
        files: written.map((w) => ({ path: toResPath(w.path, projectPath), edits: w.edits })),
        total_edits: total,
        message: `Renamed to '${newName}' across ${written.length} file(s). Call rescan_filesystem so the editor picks the changes up.`,
      };
    }

    case 'gd_diagnostics': {
      const waitMs = typeof args.wait_ms === 'number' ? args.wait_ms : 3000;
      const diags = await c.waitForDiagnostics(uri, waitMs);
      const formatted = formatDiagnostics(diags);
      return {
        path: rawPath,
        diagnostics: formatted,
        count: formatted.length,
        error_count: formatted.filter((d) => d.severity === 'error').length,
        warning_count: formatted.filter((d) => d.severity === 'warning').length,
        note: formatted.length === 0
          ? 'No diagnostics reported. An empty result can also mean the server had nothing to say yet — raise wait_ms if the file was just edited.'
          : undefined,
      };
    }

    case 'gd_hover': {
      if (!c.supports('hoverProvider')) {
        return { ok: false, error: 'This language server does not advertise hover support.' };
      }
      const result = await c.request<{ contents?: unknown }>('textDocument/hover', {
        textDocument: { uri },
        position: toLspPosition(args.line, args.column),
      });
      const contents = result?.contents;
      let text = '';
      if (typeof contents === 'string') text = contents;
      else if (Array.isArray(contents)) {
        text = contents.map((c2) => (typeof c2 === 'string' ? c2 : (c2 as { value?: string })?.value ?? '')).join('\n');
      } else if (contents && typeof contents === 'object') {
        text = (contents as { value?: string }).value ?? '';
      }
      return { path: rawPath, hover: text.trim(), found: text.trim().length > 0 };
    }

    case 'gd_document_symbols': {
      if (!c.supports('documentSymbolProvider')) {
        return { ok: false, error: 'This language server does not advertise document symbol support.' };
      }
      const result = await c.request('textDocument/documentSymbol', { textDocument: { uri } });
      const flatten = (nodes: unknown[], depth = 0): Array<Record<string, unknown>> =>
        nodes.flatMap((n) => {
          const node = n as {
            name?: string; kind?: number; detail?: string;
            range?: { start: { line: number; character: number } };
            location?: { range: { start: { line: number; character: number } } };
            children?: unknown[];
          };
          const start = node.range?.start ?? node.location?.range?.start ?? { line: 0, character: 0 };
          const entry = {
            name: node.name,
            kind: node.kind,
            detail: node.detail || undefined,
            line: start.line + 1,
            depth,
          };
          return [entry, ...(node.children ? flatten(node.children, depth + 1) : [])];
        });
      const symbols = Array.isArray(result) ? flatten(result) : [];
      return { path: rawPath, symbols, count: symbols.length };
    }

    case 'gd_completion': {
      if (!c.supports('completionProvider')) {
        return { ok: false, error: 'This language server does not advertise completion support.' };
      }
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      const result = await c.request<unknown>('textDocument/completion', {
        textDocument: { uri },
        position: toLspPosition(args.line, args.column),
      });
      const rawItems = Array.isArray(result)
        ? result
        : ((result as { items?: unknown[] })?.items ?? []);
      const items = rawItems.slice(0, limit).map((i) => {
        const item = i as { label?: string; kind?: number; detail?: string };
        return { label: item.label, kind: item.kind, detail: item.detail || undefined };
      });
      return {
        path: rawPath,
        completions: items,
        count: items.length,
        truncated: rawItems.length > items.length ? rawItems.length : undefined,
      };
    }

    default:
      return { ok: false, error: `Unhandled LSP tool: ${name}` };
  }
}
