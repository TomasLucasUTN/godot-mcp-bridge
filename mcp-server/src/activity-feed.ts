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
 * The server still polls the editor behind the scenes — the addon's ring buffer
 * has no push channel of its own — but it only polls while somebody is
 * subscribed, and the AGENT never polls, which is the part that costs tokens
 * and gets forgotten. Replacing the internal poll with a real push from the
 * addon is a later change that does not alter this contract.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export const ACTIVITY_URI = 'godot-mcp://editor/activity';

/** How often the server asks the editor for new events while subscribed. */
const POLL_INTERVAL_MS = 1500;
/**
 * Wait this long after seeing new events before notifying, so a burst (dragging
 * a node fires selection events continuously) becomes one notification instead
 * of a dozen.
 */
const COALESCE_MS = 250;
/** Events kept for a `resources/read` between notifications. */
const BUFFER_CAP = 50;

export interface ActivityEvent {
  id: number;
  type: string;
  detail: unknown;
  source: 'human' | 'agent' | string;
  t_ms?: number;
}

/** Calls get_editor_activity. Returns null when the editor is not connected. */
export type ActivityFetcher = (sinceId: number) => Promise<{ events: ActivityEvent[]; latest_id: number } | null>;

export class ActivityFeed {
  private subscribers = new Set<string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private coalesceTimer: NodeJS.Timeout | null = null;
  private cursor = 0;
  private buffered: ActivityEvent[] = [];
  private lastNotifiedId = 0;

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

  /** Current buffer, newest last. Read by resources/read. */
  snapshot(): { events: ActivityEvent[]; latest_id: number; subscribed: boolean } {
    return {
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
    }, POLL_INTERVAL_MS);
    // Don't hold the process open just for the feed.
    this.pollTimer.unref?.();
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

    // Only the developer's own actions are worth waking the agent for: the
    // agent already knows what it did itself, and notifying on its own edits
    // would make every tool call trigger a round trip.
    const human = (result.events ?? []).filter((e) => e.source === 'human');
    if (human.length === 0) return;

    this.buffered = [...this.buffered, ...human].slice(-BUFFER_CAP);
    this.scheduleNotify();
  }

  private scheduleNotify(): void {
    if (this.coalesceTimer) return;
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = null;
      const newest = this.buffered.at(-1)?.id ?? 0;
      if (newest <= this.lastNotifiedId) return;
      this.lastNotifiedId = newest;
      void this.server
        .notification({ method: 'notifications/resources/updated', params: { uri: ACTIVITY_URI } })
        .catch((err) => this.log('debug', `activity notification failed: ${err}`));
    }, COALESCE_MS);
    this.coalesceTimer.unref?.();
  }
}
