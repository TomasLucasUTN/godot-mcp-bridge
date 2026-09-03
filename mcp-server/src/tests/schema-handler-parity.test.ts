/**
 * Every argument a GDScript handler reads must be declared in its schema.
 *
 * The two halves drift in one direction and it is always the same one: the
 * handler learns a new argument, the schema does not, and the capability is
 * invisible — worse than invisible, because the server's unknown-argument
 * guard then REFUSES anyone who passes it. Found this way, in one sweep:
 * `search_project.max_results` and `case_sensitive`, `list_dir.include_hidden`,
 * `read_file.max_bytes`, and `duplicate_node.dry_run` — five real capabilities
 * that existed and could not be used.
 *
 * Schemas are read from the built tool list rather than from the TypeScript
 * source, so a property defined through a shared const (the tilemap tools all
 * share one `coordsSchema`) resolves properly instead of looking undeclared.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTools } from '../tools/index.js';

const ADDON = resolve(dirname(fileURLToPath(import.meta.url)), '../../../addons/godot_mcp');

/** An underscore-prefixed argument is internal plumbing between our own tools. */
const INTERNAL = (key: string) => key.startsWith('_');

/** Accepted by the server itself for every tool, not per-schema. */
const UNIVERSAL = new Set(['confirm']);

function gdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...gdFiles(full));
    else if (entry.endsWith('.gd')) out.push(full);
  }
  return out;
}

/** tool name -> the argument keys its handler reads out of `args`. */
function handlerArguments(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of gdFiles(ADDON)) {
    const text = readFileSync(file, 'utf8');
    const funcs = text.matchAll(/func ([a-z_0-9]+)\(args: Dictionary\)([\s\S]*?)(?=\nfunc |$)/g);
    for (const [, name, body] of funcs) {
      const keys = new Set<string>();
      for (const [, key] of body.matchAll(/args\.(?:get|has)\(&?"([a-z_0-9]+)"/g)) keys.add(key);
      const existing = found.get(name);
      if (existing) for (const k of keys) existing.add(k);
      else found.set(name, keys);
    }
  }
  return found;
}

describe('schema / handler parity', () => {
  const handlers = handlerArguments();

  it('found the GDScript handlers to compare against', () => {
    expect(handlers.size).toBeGreaterThan(100);
  });

  it('declares every argument a handler actually reads', () => {
    const undeclared: string[] = [];
    let compared = 0;

    for (const tool of allTools) {
      const args = handlers.get(tool.name);
      if (!args) continue;   // server-side tool (debug_*, gd_*) or a differently-named handler
      compared++;
      const declared = new Set(Object.keys(tool.inputSchema.properties ?? {}));
      for (const key of args) {
        if (INTERNAL(key) || UNIVERSAL.has(key) || declared.has(key)) continue;
        undeclared.push(`${tool.name}.${key}`);
      }
    }

    expect(compared).toBeGreaterThan(150);
    expect(undeclared).toEqual([]);
  });
});
