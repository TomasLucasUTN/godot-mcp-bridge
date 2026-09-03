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

/** Words too common in this domain to tell two tools apart. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'it',
  'how', 'do', 'i', 'my', 'with', 'from', 'that', 'this', 'godot', 'tool',
  'scene', 'node', // present in most of the surface; matching them ranks noise
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
      score += inName ? 10 : 1;
      // An exact name segment ("autotile" in tilemap_autotile) beats a
      // substring that merely happens to contain it.
      if (inName && name.split('_').includes(term)) score += 5;
    }
    if (matched === 0) continue;
    // Covering more of the question is worth more than any single strong hit,
    // so a tool matching two words outranks one matching a name once.
    score += matched * matched * 4;
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
