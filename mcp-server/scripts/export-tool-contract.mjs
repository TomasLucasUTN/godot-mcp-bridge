#!/usr/bin/env node
/**
 * Write what the TypeScript side declares about every tool into a JSON file the
 * GDScript suite can read.
 *
 * A tool here is wired in three places — schema (TS), dispatch entry
 * (tool_executor.gd) and handler (tools/*.gd) — and it stays dark until all
 * three exist. Nothing checked that automatically: the registry test only sees
 * the TypeScript half, and the GDScript suite only sees the Godot half. This
 * file is the join, so the suite can assert that every advertised tool is
 * actually dispatchable, and can sweep the mutating ones for false success
 * without hardcoding a list that will rot.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// pathToFileURL, not the bare path: a Windows absolute path is a 'd:' URL
// scheme to the ESM loader and it refuses it.
const { allTools } = await import(pathToFileURL(resolve(here, '../dist/tools/index.js')).href);

const contract = allTools.map((tool) => ({
  name: tool.name,
  required: tool.inputSchema.required ?? [],
  read_only: tool.annotations?.readOnlyHint === true,
  destructive: tool.annotations?.destructiveHint === true,
}));

const out = resolve(here, '../src/tests/fixtures/e2e-project/tests/tool-contract.json');
writeFileSync(out, JSON.stringify(contract, null, 1) + '\n', 'utf8');
console.log(`tool-contract: ${contract.length} tools -> ${out}`);
