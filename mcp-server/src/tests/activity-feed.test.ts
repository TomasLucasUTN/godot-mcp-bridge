import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivityFeed, ACTIVITY_URI, type ActivityEvent } from '../activity-feed.js';

/**
 * The live editor-activity feed.
 *
 * The point of it is that the AGENT never polls: it subscribes once and gets
 * told when the developer touches something. These cover the rules that make
 * that useful rather than noisy — only the developer's own actions, coalesced
 * bursts, no duplicate notifications, and no work at all while unsubscribed.
 */

function makeServer() {
  return { notification: vi.fn().mockResolvedValue(undefined) } as any;
}

function ev(id: number, source: 'human' | 'agent', type = 'selection'): ActivityEvent {
  return { id, type, detail: [], source };
}

describe('ActivityFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not poll until something subscribes', async () => {
    const fetch = vi.fn().mockResolvedValue({ events: [], latest_id: 0 });
    const feed = new ActivityFeed(makeServer(), fetch);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetch).not.toHaveBeenCalled();
    feed.stop();
  });

  it('notifies when the developer does something', async () => {
    const server = makeServer();
    const fetch = vi.fn().mockResolvedValue({ events: [ev(1, 'human')], latest_id: 1 });
    const feed = new ActivityFeed(server, fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(2000);

    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/resources/updated',
      params: { uri: ACTIVITY_URI },
    });
    feed.stop();
  });

  it('stays silent for the agent\'s own edits', async () => {
    // Every tool call produces agent-sourced events. Notifying on those would
    // make the agent wake itself up on every edit it makes.
    const server = makeServer();
    const fetch = vi.fn().mockResolvedValue({ events: [ev(1, 'agent'), ev(2, 'agent')], latest_id: 2 });
    const feed = new ActivityFeed(server, fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(5000);

    expect(server.notification).not.toHaveBeenCalled();
    feed.stop();
  });

  it('coalesces a burst into one notification', async () => {
    // Dragging a node fires selection events continuously.
    const server = makeServer();
    let next = 1;
    const fetch = vi.fn().mockImplementation(async () => {
      const events = [ev(next++, 'human'), ev(next++, 'human'), ev(next++, 'human')];
      return { events, latest_id: next - 1 };
    });
    const feed = new ActivityFeed(server, fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(1800); // one poll (1500ms) + the coalesce window (250ms)

    expect(server.notification).toHaveBeenCalledTimes(1);
    feed.stop();
  });

  it('does not re-notify when nothing new arrived', async () => {
    const server = makeServer();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ events: [ev(1, 'human')], latest_id: 1 })
      .mockResolvedValue({ events: [], latest_id: 1 });
    const feed = new ActivityFeed(server, fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(server.notification).toHaveBeenCalledTimes(1);
    feed.stop();
  });

  it('stops polling when the last subscriber leaves', async () => {
    const fetch = vi.fn().mockResolvedValue({ events: [], latest_id: 0 });
    const feed = new ActivityFeed(makeServer(), fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(2000);
    const callsWhileSubscribed = fetch.mock.calls.length;
    expect(callsWhileSubscribed).toBeGreaterThan(0);

    feed.unsubscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetch.mock.calls.length).toBe(callsWhileSubscribed);
    feed.stop();
  });

  it('survives the editor being disconnected', async () => {
    // fetch returns null when nothing is connected; the subscription must stay
    // alive so the feed resumes when the editor comes back.
    const server = makeServer();
    const fetch = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('not connected'))
      .mockResolvedValue({ events: [ev(1, 'human')], latest_id: 1 });
    const feed = new ActivityFeed(server, fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(6000);

    expect(server.notification).toHaveBeenCalledTimes(1);
    feed.stop();
  });

  it('exposes the buffered events for resources/read', async () => {
    const fetch = vi.fn().mockResolvedValue({
      events: [ev(1, 'human', 'scene_saved'), ev(2, 'agent')],
      latest_id: 2,
    });
    const feed = new ActivityFeed(makeServer(), fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(2000);

    const snap = feed.snapshot();
    expect(snap.subscribed).toBe(true);
    expect(snap.latest_id).toBe(2);
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0].type).toBe('scene_saved');
    feed.stop();
  });

  it('caps the buffer so a long session cannot grow without bound', async () => {
    let next = 1;
    const fetch = vi.fn().mockImplementation(async () => {
      const events = Array.from({ length: 20 }, () => ev(next++, 'human'));
      return { events, latest_id: next - 1 };
    });
    const feed = new ActivityFeed(makeServer(), fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(feed.snapshot().events.length).toBeLessThanOrEqual(50);
    feed.stop();
  });
});
