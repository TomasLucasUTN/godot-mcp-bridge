import { describe, it, expect } from 'vitest';
import { handleToolsetTool } from '../index.js';

/**
 * Enabling a toolset changes what THIS process advertises in tools/list. A
 * proxy forwarded these calls to the primary, which flipped its own set while
 * the proxy kept serving the list it started with — the call answered
 * enabled:true and the tools never appeared for that client. Every client after
 * the first is a proxy, so that was most of them.
 *
 * Answering locally is what makes the mechanism work; these lock that in.
 */
function parse(result: ReturnType<typeof handleToolsetTool>) {
  expect(result).not.toBeNull();
  return JSON.parse(result!.content[0].text as string) as Record<string, unknown>;
}

function toolsets() {
  const body = parse(handleToolsetTool('list_toolsets', {}));
  return body.toolsets as Array<{ name: string; enabled: boolean; tool_count: number }>;
}

describe('toolset visibility', () => {
  it('leaves other tools alone', () => {
    expect(handleToolsetTool('read_scene', {})).toBeNull();
  });

  it('enables and disables one toolset', () => {
    const on = parse(handleToolsetTool('enable_toolset', { name: 'tilemap' }));
    expect(on.ok).toBe(true);
    expect(on.enabled).toBe(true);
    expect(toolsets().find((t) => t.name === 'tilemap')?.enabled).toBe(true);

    const off = parse(handleToolsetTool('disable_toolset', { name: 'tilemap' }));
    expect(off.enabled).toBe(false);
    expect(toolsets().find((t) => t.name === 'tilemap')?.enabled).toBe(false);
  });

  it('takes "all", the word GODOT_MCP_TOOLSETS documents', () => {
    const on = parse(handleToolsetTool('enable_toolset', { name: 'all' }));
    expect(on.ok).toBe(true);
    expect(toolsets().every((t) => t.enabled)).toBe(true);

    parse(handleToolsetTool('disable_toolset', { name: 'all' }));
    // core is never optional and stays on.
    const after = toolsets();
    expect(after.find((t) => t.name === 'core')?.enabled).toBe(true);
    expect(after.filter((t) => t.name !== 'core').some((t) => t.enabled)).toBe(false);
  });

  it('refuses an unknown name and says "all" is available', () => {
    const bad = handleToolsetTool('enable_toolset', { name: 'nope' });
    expect(bad?.isError).toBe(true);
    const body = JSON.parse(bad!.content[0].text as string);
    expect(body.available).toContain('all');
  });

  it('will not let core be turned off', () => {
    const core = handleToolsetTool('disable_toolset', { name: 'core' });
    expect(core?.isError).toBe(true);
    expect(toolsets().find((t) => t.name === 'core')?.enabled).toBe(true);
  });
});
