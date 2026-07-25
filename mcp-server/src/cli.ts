/**
 * Setup CLI: `godot-mcp-bridge install` and `godot-mcp-bridge doctor`.
 *
 * Onboarding is where adopters are lost — the usual flow is "install the addon
 * from the AssetLib, enable it in Project Settings, hand-edit your MCP client's
 * JSON, restart both". Every one of those steps can fail quietly. These two
 * commands do the mechanical parts and then say exactly what is still missing.
 *
 * Nothing here writes outside the Godot project unless --client is passed, and
 * every file it replaces is backed up first.
 */

import { cp, mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADDON_DIR_NAME = 'godot_mcp';
const WS_PORT = 6505;

type ClientKey = 'claude-desktop' | 'cursor';

function log(msg = ''): void {
  // stdout is the MCP transport when running as a server; the CLI is a separate
  // mode, but keeping all human output on stderr means a stray `install` in a
  // client config can never corrupt a JSON-RPC stream.
  console.error(msg);
}

/** Where the addon source lives: the staged copy in a published package, or the
 *  repo checkout when running from source. */
function addonSource(): string | null {
  const candidates = [
    resolve(HERE, '../bundled-addon', ADDON_DIR_NAME),
    resolve(HERE, '../../bundled-addon', ADDON_DIR_NAME),
    resolve(HERE, '../../addons', ADDON_DIR_NAME),
    resolve(HERE, '../../../addons', ADDON_DIR_NAME),
  ];
  return candidates.find(p => existsSync(join(p, 'plugin.cfg'))) ?? null;
}

/** Walk up from `start` looking for a project.godot. */
function findGodotProject(start: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'project.godot'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function clientConfigPath(client: ClientKey): string | null {
  const home = homedir();
  const os = platform();
  if (client === 'claude-desktop') {
    if (os === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData/Roaming'), 'Claude', 'claude_desktop_config.json');
    if (os === 'darwin') return join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    return join(home, '.config/Claude/claude_desktop_config.json');
  }
  if (client === 'cursor') return join(home, '.cursor', 'mcp.json');
  return null;
}

/** Add the godot server entry to an MCP client config, preserving everything
 *  else in the file and backing the original up first. */
async function registerWithClient(client: ClientKey): Promise<string> {
  const path = clientConfigPath(client);
  if (!path) return `unknown client: ${client}`;

  let parsed: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = await readFile(path, 'utf8');
    try {
      parsed = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      return `${path} is not valid JSON — not touching it. Add the server entry by hand.`;
    }
    await copyFile(path, `${path}.bak`);
  } else {
    await mkdir(dirname(path), { recursive: true });
  }

  const servers = (parsed.mcpServers ??= {}) as Record<string, unknown>;
  if (servers.godot) return `${path}: a "godot" server entry already exists, left as is.`;

  servers.godot = platform() === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', '-y', 'godot-mcp-bridge'] }
    : { command: 'npx', args: ['-y', 'godot-mcp-bridge'] };

  await writeFile(path, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return `${path}: added the "godot" server (backup at ${path}.bak). Restart the client.`;
}

/** Turn the plugin on in project.godot so the user does not have to find it in
 *  Project Settings > Plugins. */
async function enablePluginInProject(projectDir: string): Promise<string> {
  const path = join(projectDir, 'project.godot');
  const raw = await readFile(path, 'utf8');
  const entry = `res://addons/${ADDON_DIR_NAME}/plugin.cfg`;
  if (raw.includes(entry)) return 'plugin already enabled in project.godot';

  await copyFile(path, `${path}.bak`);
  let next: string;
  if (/^\[editor_plugins\]/m.test(raw)) {
    next = raw.replace(/^\[editor_plugins\]\s*\n(enabled\s*=\s*PackedStringArray\()?/m, (match, hasEnabled) => {
      return hasEnabled ? `${match}"${entry}", ` : `[editor_plugins]\n\nenabled=PackedStringArray("${entry}")\n`;
    });
    if (!next.includes(entry)) {
      next = `${raw.trimEnd()}\n\n[editor_plugins]\n\nenabled=PackedStringArray("${entry}")\n`;
    }
  } else {
    next = `${raw.trimEnd()}\n\n[editor_plugins]\n\nenabled=PackedStringArray("${entry}")\n`;
  }
  await writeFile(path, next, 'utf8');
  return `enabled the plugin in project.godot (backup at ${path}.bak)`;
}

function portInUse(port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise(resolvePromise => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const finish = (inUse: boolean) => {
      socket.destroy();
      resolvePromise(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

export async function runInstall(argv: string[]): Promise<number> {
  const projectArg = valueOf(argv, '--project');
  const clients = (valueOf(argv, '--client') ?? '').split(',').map(s => s.trim()).filter(Boolean) as ClientKey[];

  const projectDir = projectArg
    ? resolve(projectArg)
    : findGodotProject(process.cwd());

  log('godot-mcp-bridge install');
  log('');

  if (!projectDir || !existsSync(join(projectDir, 'project.godot'))) {
    log('  No Godot project found.');
    log('  Run this from inside your project folder, or pass --project <path to the folder holding project.godot>.');
    return 1;
  }
  log(`  project: ${projectDir}`);

  const source = addonSource();
  if (!source) {
    log('  Could not locate the addon files in this package. Install the addon from the Godot AssetLib instead.');
    return 1;
  }

  const target = join(projectDir, 'addons', ADDON_DIR_NAME);
  const existed = existsSync(target);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  log(`  addon:   ${existed ? 'updated' : 'installed'} at addons/${ADDON_DIR_NAME}`);

  log(`  plugin:  ${await enablePluginInProject(projectDir)}`);

  if (clients.length > 0) {
    for (const client of clients) log(`  client:  ${await registerWithClient(client)}`);
  } else {
    log('');
    log('  MCP client not configured (pass --client claude-desktop or --client cursor to do it automatically).');
    log('  Claude Code:  claude mcp add godot -- npx -y godot-mcp-bridge');
    log('  Others: add this to the client\'s MCP config:');
    log('    "godot": { "command": "npx", "args": ["-y", "godot-mcp-bridge"] }');
    log('    (on Windows: { "command": "cmd", "args": ["/c", "npx", "-y", "godot-mcp-bridge"] })');
  }

  log('');
  log('  Next: restart your MCP client, then restart the Godot project.');
  log('  Godot should show "MCP Connected" in the top-right. If it does not, run:');
  log('    npx godot-mcp-bridge doctor');
  return 0;
}

export async function runDoctor(argv: string[]): Promise<number> {
  const projectArg = valueOf(argv, '--project');
  const projectDir = projectArg ? resolve(projectArg) : findGodotProject(process.cwd());

  log('godot-mcp-bridge doctor');
  log('');

  const problems: string[] = [];

  log(`  node:    ${process.version}`);
  const major = Number(process.version.slice(1).split('.')[0]);
  if (Number.isFinite(major) && major < 18) problems.push('Node 18+ is required; upgrade from nodejs.org.');

  if (!projectDir) {
    log('  project: not found from this folder');
    problems.push('Run doctor from inside your Godot project, or pass --project <path>.');
  } else {
    log(`  project: ${projectDir}`);
    const addonPath = join(projectDir, 'addons', ADDON_DIR_NAME);
    if (!existsSync(join(addonPath, 'plugin.cfg'))) {
      log('  addon:   NOT installed');
      problems.push(`Addon missing. Run: npx godot-mcp-bridge install --project "${projectDir}"`);
    } else {
      const files = await readdir(addonPath);
      log(`  addon:   installed (${files.length} entries)`);
      const projectFile = await readFile(join(projectDir, 'project.godot'), 'utf8').catch(() => '');
      if (!projectFile.includes(`res://addons/${ADDON_DIR_NAME}/plugin.cfg`)) {
        log('  plugin:  NOT enabled');
        problems.push('Plugin is installed but not enabled: Project > Project Settings > Plugins, tick "Godot MCP" (or re-run install).');
      } else {
        log('  plugin:  enabled in project.godot');
      }
    }
  }

  const wsBusy = await portInUse(WS_PORT);
  log(`  port ${WS_PORT}: ${wsBusy ? 'in use (a server is listening)' : 'free (no server listening)'}`);
  if (!wsBusy) {
    problems.push(`Nothing is listening on ${WS_PORT}. The MCP server starts when your client launches it — open/restart the client, then re-run doctor.`);
  }

  log('');
  if (problems.length === 0) {
    log('  No problems found. If the editor still shows disconnected, restart the Godot project.');
    return 0;
  }
  log('  Problems:');
  for (const p of problems) log(`    - ${p}`);
  return 1;
}

function valueOf(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

export function printCliHelp(): void {
  log('godot-mcp-bridge — Godot 4 editor control over MCP');
  log('');
  log('  (no arguments)   run the MCP server on stdio (this is what your client launches)');
  log('  install          install the editor addon into a Godot project and enable it');
  log('  doctor           check the setup and report what is wrong');
  log('');
  log('Options:');
  log('  --project <dir>  the folder containing project.godot (default: search upward from cwd)');
  log('  --client <name>  also register the server in an MCP client config: claude-desktop, cursor');
}
