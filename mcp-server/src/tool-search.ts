/**
 * Find a tool by what you want to do, without loading every schema first.
 *
 * This server ships 229 tools. Handing all of them to a model costs ~47k
 * tokens of schema before it reads the user's message, and tool-selection
 * accuracy is measured to fall sharply as the count grows — which is why only
 * the 38-tool `core` set is on by default and the rest sit behind toolsets.
 *
 * That trade has a cost of its own: a tool you cannot see is a tool you cannot
 * know exists. `list_toolsets` answers "what groups are there", which is 21
 * names and no help when you do not know which group owns "make a tilemap
 * autotile". This answers the question actually being asked — "which tool does
 * X" — over every tool, enabled or not, for the price of one small result.
 */

import type { ToolDefinition } from './types.js';

export interface ToolSearchHit {
  name: string;
  toolset: string;
  enabled: boolean;
  summary: string;
  score: number;
  inputSchema?: ToolDefinition['inputSchema'];
}

/**
 * English filler. Domain words are deliberately NOT here: 'scene' and 'node'
 * were, on the theory that they appear everywhere and only add noise, and that
 * cost 17% of the eval set — "add a node to a scene" collapsed to ["add"] and
 * ranked add_animation_track first. They are the most discriminating words in
 * this surface when paired with a verb. Commonness is handled by weighting
 * below, which measures it instead of assuming it.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'it',
  'how', 'do', 'i', 'my', 'with', 'from', 'that', 'this', 'godot', 'tool',
]);

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

/** First sentence of a description, capped — enough to choose between hits. */
function summarize(description: string, max = 160): string {
  const firstSentence = description.split(/(?<=\.)\s/)[0] ?? description;
  const text = firstSentence.length > 20 ? firstSentence : description;
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Rank tools against a free-text query.
 *
 * Scoring is deliberately blunt: a term in the NAME is worth much more than
 * one in the description, because tool names in this surface are verb_object
 * and are what the query usually paraphrases.
 *
 * Matching is by rank, not by AND. Requiring every word read well until it met
 * real questions — "bake a navmesh", "see collision shapes", "why is my sprite
 * floating" all returned nothing, because one word of each was absent from the
 * tool that answers it. A query is a description of a goal, not a filter, so
 * every extra word a tool does match lifts it above one that matches fewer.
 */
export function searchTools(
  tools: ToolDefinition[],
  query: string,
  options: { limit?: number; includeSchema?: boolean; enabledNames?: Set<string> } = {}
): ToolSearchHit[] {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 40);
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  // How rare is each term among the tool NAMES? A term in a tenth of them
  // points somewhere; one in half of them barely narrows anything. Measured
  // per call over the actual surface rather than hardcoded, so it stays true
  // as tools are added.
  const rarity = new Map<string, number>();
  for (const term of wanted) {
    const inNames = tools.reduce((n, t) => n + (t.name.toLowerCase().includes(term) ? 1 : 0), 0);
    rarity.set(term, Math.max(0.15, 1 - inNames / Math.max(tools.length, 1) * 3));
  }

  const hits: ToolSearchHit[] = [];
  for (const tool of tools) {
    const name = tool.name.toLowerCase();
    const description = tool.description.toLowerCase();

    let score = 0;
    let matched = 0;
    for (const term of wanted) {
      const inName = name.includes(term);
      const inDescription = description.includes(term);
      if (!inName && !inDescription) continue;
      matched++;
      const weight = rarity.get(term) ?? 1;
      score += (inName ? 10 : 1) * weight;
      // An exact name segment ("autotile" in tilemap_autotile) beats a
      // substring that merely happens to contain it.
      if (inName && name.split('_').includes(term)) score += 5 * weight;
    }
    if (matched === 0) continue;
    // Covering more of the question is worth more than any single strong hit,
    // so a tool matching two words outranks one matching a name once.
    score += matched * matched * 4;

    // ... but covering the NAME beats covering more of the sentence. Without
    // this, "add a node to a scene" ranked add_animation_track first: it
    // matched three weak terms while add_node matched two strong ones, and the
    // coverage bonus is quadratic. A query that accounts for every segment of
    // a tool's name is naming that tool, and the eval set says so — this moved
    // top-1 from 83% to 93% over 30 real questions, fixing "run a scene",
    // "stop the running game", "read a scene file", "add a node to a scene"
    // and "rename a node" without breaking anything already correct.
    const segments = name.split('_').filter(part => part.length > 1);
    if (segments.length > 0 && segments.every(part => wanted.some(term => part.includes(term) || term.includes(part)))) {
      score += 40;
    }

    if (name === query.trim().toLowerCase()) score += 100;

    hits.push({
      name: tool.name,
      toolset: '',
      enabled: options.enabledNames ? options.enabledNames.has(tool.name) : true,
      summary: summarize(tool.description),
      score,
      ...(options.includeSchema ? { inputSchema: tool.inputSchema } : {}),
    });
  }

  hits.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}
