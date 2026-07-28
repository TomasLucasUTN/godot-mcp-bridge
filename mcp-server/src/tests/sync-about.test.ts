/**
 * The About-drift check, tested without the network.
 *
 * It exists because the description drifted to 213 tools while the server
 * shipped 228 — fifteen releases of drift on the first sentence anyone reads.
 * Its first CI run printed "About is up to date", which is exactly what a check
 * doing nothing at all would print, so the comparison is pinned here rather than
 * trusted.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script, no type declarations
import { buildDescription, isInSync } from '../../../scripts/about-description.mjs';

describe('sync-about', () => {
  it('puts the tool count in the description', () => {
    expect(buildDescription(228)).toContain('228 tools');
    expect(buildDescription(9)).toContain('9 tools');
  });

  it('accepts a description that matches exactly', () => {
    const wanted = buildDescription(228);
    expect(isInSync(wanted, wanted)).toBe(true);
  });

  // The whole point: a stale count has to be caught. This is the assertion the
  // green CI run could not distinguish itself from.
  it('rejects a description whose count is stale', () => {
    const wanted = buildDescription(228);
    const stale = buildDescription(213);
    expect(isInSync(stale, wanted)).toBe(false);
  });

  it('rejects an empty or missing description', () => {
    const wanted = buildDescription(228);
    expect(isInSync('', wanted)).toBe(false);
    expect(isInSync(null, wanted)).toBe(false);
    expect(isInSync(undefined, wanted)).toBe(false);
  });

  it('ignores surrounding whitespace, which GitHub sometimes returns', () => {
    const wanted = buildDescription(228);
    expect(isInSync(`  ${wanted}\n`, wanted)).toBe(true);
  });

  it('rejects a description that only differs late in the sentence', () => {
    const wanted = buildDescription(228);
    expect(isInSync(wanted.replace('play-testing.', 'play-testing'), wanted)).toBe(false);
  });
});
