/**
 * Live editor-activity feed, exposed as a subscribable MCP resource.
 *
 * `get_editor_activity` already reports what the developer did, but only when
 * the agent remembers to ask, and the piggyback digest on tool responses only
 * arrives when a tool happens to be called. Between calls — exactly when the
 * developer is doing something the agent should know about — there is nothing.
 *
 * This closes that: the agent subscribes once (`resources/subscribe`) and the
 * server pushes `notifications/resources/updated` when the developer touches
 * something. The agent then reads the resource to see what changed.
 *
 * The addon pushes each human action over the WebSocket as it happens
 * (`editor_activity`), so nothing polls in the steady state. The timer is kept
 * as a fallback for an addon older than that push — it backs off to a slow
 * heartbeat as soon as the first pushed event arrives, and stops entirely while
 * nobody is subscribed.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export const ACTIVITY_URI = 'godot-mcp://editor/activity';

/** How often the server asks the editor for new events while subscribed and no
 *  pushed event has been seen yet (i.e. the addon predates the push channel). */
const POLL_INTERVAL_MS = 1500;
/** Once the addon has pushed at least once, polling drops to this — it exists
 *  only to catch anything a dropped socket lost, not to drive the feed. */
const FALLBACK_POLL_INTERVAL_MS = 30000;
/**
 * Wait this long after seeing new events before notifying, so a burst (dragging
 * a node fires selection events continuously) becomes one notification instead
 * of a dozen.
 */
const COALESCE_MS = 250;
/** Events kept for a `resources/read` between notifications. */
const BUFFER_CAP = 50;

export interface ActivityEvent {
  /**
   * Per-source sequence, not global: the editor's activity log, the runtime
   * autoload and the debugger watch each number their own. `source` is what
   * tells the streams apart; only the editor's ids drive the poll cursor.
   */
  id: number;
  type: string;
  detail: unknown;
  /**
   * `human` — the developer did it in the editor. `agent` — the agent's own
   * tool call caused it, and is filtered out. `runtime` — the running game
   * reported it (a scene swap from the autoload, a crash from the debugger).
   */
  source: 'human' | 'agent' | 'runtime' | string;
  t_ms?: number;
}

/** Sources worth waking the agent for: everything except its own edits. */
function isNoteworthy(source: unknown): boolean {
  return source === 'human' || source === 'runtime';
}

/** Calls get_editor_activity. Returns null when the editor is not connected. */
export type ActivityFetcher = (sinceId: number) => Promise<{ events: ActivityEvent[]; latest_id: number } | null>;

export class ActivityFeed {
  private subscribers = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private coalesceTimer: NodeJS.Timeout | null = null;
  private cursor = 0;
  private buffered: ActivityEvent[] = [];
  private pendingNotify = false;
  private pushSeen = false;

  constructor(
    private readonly server: Server,
    private readonly fetch: ActivityFetcher,
    private readonly log: (level: string, message: string) => void = () => {}
  ) {}

  subscribe(uri: string): void {
    this.subscribers.add(uri);
    this.startPolling();
  }

  unsubscribe(uri: string): void {
    this.subscribers.delete(uri);
    if (this.subscribers.size === 0) this.stopPolling();
  }

  /**
   * An event the addon pushed, unsolicited. Same filtering as a polled one: the
   * agent is told about the developer and about the running game, never about
   * its own edits.
   */
  push(event: ActivityEvent): void {
    this.pushSeen = true;
    if (this.subscribers.size === 0) return;
    if (!isNoteworthy(event?.source)) return;
    // Only the editor's ids belong to the poll cursor. A runtime event carries
    // its own sequence, and letting it advance the cursor would skip whatever
    // the editor buffered under those same numbers.
    if (event.source === 'human') {
      const id = Number(event.id ?? 0);
      if (id > this.cursor) this.cursor = id;
    }
    this.buffered = [...this.buffered, event].slice(-BUFFER_CAP);
    this.scheduleNotify();
    // Polling was only ever a stand-in for this; slow it right down now that
    // the editor is telling us directly.
    this.restartPolling();
  }

  /** Current buffer, newest last, plus a plain-language summary of it. */
  snapshot(): {
    summary: string;
    events: ActivityEvent[];
    latest_id: number;
    subscribed: boolean;
  } {
    return {
      summary: summarizeActivity(this.buffered),
      events: this.buffered,
      latest_id: this.cursor,
      subscribed: this.subscribers.size > 0,
    };
  }

  stop(): void {
    this.stopPolling();
    this.subscribers.clear();
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pushSeen ? FALLBACK_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    // Don't hold the process open just for the feed.
    this.pollTimer.unref?.();
  }

  /** Re-arm the timer at whichever interval now applies. */
  private restartPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.startPolling();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
  }

  private async poll(): Promise<void> {
    let result;
    try {
      result = await this.fetch(this.cursor);
    } catch (err) {
      // The editor disconnecting mid-session is normal; keep the subscription
      // alive so the feed resumes when it comes back.
      this.log('debug', `activity poll failed: ${err}`);
      return;
    }
    if (!result) return;

    this.cursor = result.latest_id ?? this.cursor;

    // The agent already knows what it did itself, and notifying on its own
    // edits would make every tool call trigger a round trip.
    const noteworthy = (result.events ?? []).filter((e) => isNoteworthy(e.source));
    if (noteworthy.length === 0) return;

    this.buffered = [...this.buffered, ...noteworthy].slice(-BUFFER_CAP);
    this.scheduleNotify();
  }

  private scheduleNotify(): void {
    this.pendingNotify = true;
    if (this.coalesceTimer) return;
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = null;
      // A flag rather than a high-water id: ids are per-source now, so "newer
      // than the last one notified" is not a question a single number answers.
      if (!this.pendingNotify) return;
      this.pendingNotify = false;
      void this.server
        .notification({ method: 'notifications/resources/updated', params: { uri: ACTIVITY_URI } })
        .catch((err) => this.log('debug', `activity notification failed: ${err}`));
    }, COALESCE_MS);
    this.coalesceTimer.unref?.();
  }
}

/**
 * Turn a run of raw events into one line of intent.
 *
 * "The developer saved 2 scenes and reselected nodes 12 times" is what an agent
 * can act on; twelve separate `selection` records are what it has to read and
 * discard. Selection churn in particular is almost all noise — a drag fires it
 * continuously — so it collapses to a count while the things that change the
 * project (saves, script edits, reimports, undo) are named individually.
 *
 * Deliberately rule-based, not a model call: this runs on every read of the
 * activity resource and has to be free.
 */
export function summarizeActivity(events: ActivityEvent[]): string {
  if (events.length === 0) return 'Nothing since you last looked.';

  const sentences = [
    summarizeDeveloper(events.filter((e) => e.source !== 'runtime')),
    summarizeGame(events.filter((e) => e.source === 'runtime')),
  ].filter(Boolean);
  return sentences.length > 0 ? sentences.join(' ') : `${events.length} event(s).`;
}

/**
 * The running game's events are state transitions, not a tally — three scene
 * changes in a row mean the game is in the third scene, and counting them helps
 * nobody. So this reports the latest state, with a crash always called out
 * because it is the one an agent must not silently work past.
 */
function summarizeGame(events: ActivityEvent[]): string {
  if (events.length === 0) return '';
  if (events.some((e) => e.type === 'game_crashed')) {
    return 'The game crashed — call get_runtime_log for the error.';
  }
  const last = events[events.length - 1];
  const where = describeDetail(last.detail);
  switch (last.type) {
    case 'game_paused':
      return 'The game is paused in the debugger.';
    case 'game_stopped':
      return 'The game stopped.';
    case 'game_scene_changed':
      // The consequence matters more than the fact: every runtime node path the
      // agent resolved before this points at a freed node.
      return `The game switched to ${where || 'another scene'}, so runtime node paths from before it are stale.`;
    case 'game_started':
    case 'game_running':
      return `The game is running${where ? ` (${where})` : ''}.`;
    case 'game_resumed':
      return 'The game resumed.';
    default:
      return '';
  }
}

function summarizeDeveloper(events: ActivityEvent[]): string {
  if (events.length === 0) return '';

  const counts = new Map<string, number>();
  const detailsByType = new Map<string, string[]>();
  for (const e of events) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const detail = describeDetail(e.detail);
    if (detail) {
      const list = detailsByType.get(e.type) ?? [];
      if (!list.includes(detail)) list.push(detail);
      detailsByType.set(e.type, list);
    }
  }

  const parts: string[] = [];
  const named = (type: string, verb: string, noun: string) => {
    const n = counts.get(type);
    if (!n) return;
    const files = detailsByType.get(type) ?? [];
    // Name up to two, then fall back to counting: a list of nine paths is the
    // wall of text this is meant to replace.
    if (files.length > 0 && files.length <= 2) {
      parts.push(`${verb} ${files.join(' and ')}`);
    } else {
      parts.push(`${verb} ${n} ${noun}${n === 1 ? '' : 's'}`);
    }
  };

  named('scene_saved', 'saved', 'scene');
  named('resource_saved', 'saved', 'resource');
  named('scene_opened', 'opened', 'scene');
  named('scene_closed', 'closed', 'scene');
  named('script_focus', 'opened', 'script');
  named('resources_reimported', 'reimported', 'asset');

  const undo = counts.get('undo_redo');
  if (undo) parts.push(`used undo/redo ${undo} time${undo === 1 ? '' : 's'}`);

  const settings = counts.get('project_settings_changed');
  if (settings) parts.push('changed project settings');

  const selection = counts.get('selection');
  if (selection) parts.push(`changed the selection ${selection} time${selection === 1 ? '' : 's'}`);

  const screen = detailsByType.get('main_screen');
  if (screen?.length) parts.push(`switched to the ${screen[screen.length - 1]} screen`);

  if (parts.length === 0) return '';
  const last = parts.pop() as string;
  const joined = parts.length > 0 ? `${parts.join(', ')} and ${last}` : last;
  return `The developer ${joined}.`;
}

/** A short label for an event's detail, or '' when there is nothing useful. */
function describeDetail(detail: unknown): string {
  if (typeof detail === 'string') {
    if (!detail) return '';
    // Paths are long and the leading res:// adds nothing to a summary.
    return detail.startsWith('res://') ? detail.slice(6) : detail;
  }
  if (Array.isArray(detail)) {
    if (detail.length === 0) return '';
    if (detail.length === 1) return describeDetail(detail[0]);
    return `${detail.length} items`;
  }
  return '';
}
