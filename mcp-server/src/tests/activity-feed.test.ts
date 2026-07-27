import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivityFeed, ACTIVITY_URI, summarizeActivity, type ActivityEvent } from '../activity-feed.js';

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

describe('ActivityFeed — events pushed by the addon', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('notifies on a pushed event without waiting for a poll', async () => {
    const server = makeServer();
    const fetch = vi.fn().mockResolvedValue({ events: [], latest_id: 0 });
    const feed = new ActivityFeed(server, fetch);

    feed.subscribe(ACTIVITY_URI);
    feed.push(ev(1, 'human', 'scene_saved'));
    await vi.advanceTimersByTimeAsync(300); // only the coalesce window

    expect(server.notification).toHaveBeenCalledTimes(1);
    expect(feed.snapshot().events).toHaveLength(1);
    feed.stop();
  });

  it('ignores a pushed agent event', async () => {
    const server = makeServer();
    const feed = new ActivityFeed(server, vi.fn().mockResolvedValue(null));

    feed.subscribe(ACTIVITY_URI);
    feed.push(ev(1, 'agent'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(server.notification).not.toHaveBeenCalled();
    feed.stop();
  });

  it('drops a pushed event when nobody is subscribed', () => {
    const feed = new ActivityFeed(makeServer(), vi.fn());
    feed.push(ev(1, 'human'));
    expect(feed.snapshot().events).toHaveLength(0);
    feed.stop();
  });

  it('backs the poll right off once the addon has pushed', async () => {
    // Polling exists only for an addon older than the push channel. Once a push
    // arrives it must stop driving the feed, or the work is duplicated forever.
    const fetch = vi.fn().mockResolvedValue({ events: [], latest_id: 0 });
    const feed = new ActivityFeed(makeServer(), fetch);

    feed.subscribe(ACTIVITY_URI);
    await vi.advanceTimersByTimeAsync(5000);
    const pollsBefore = fetch.mock.calls.length;
    expect(pollsBefore).toBeGreaterThan(1); // fast poll while no push seen

    feed.push(ev(1, 'human'));
    fetch.mockClear();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetch.mock.calls.length).toBe(0); // now on the slow fallback
    feed.stop();
  });
});

describe('summarizeActivity', () => {
  it('says so plainly when nothing happened', () => {
    expect(summarizeActivity([])).toContain('Nothing');
  });

  it('names a saved scene instead of counting it', () => {
    const s = summarizeActivity([{ id: 1, type: 'scene_saved', detail: 'res://levels/one.tscn', source: 'human' }]);
    expect(s).toContain('saved');
    expect(s).toContain('levels/one.tscn');
    expect(s).not.toContain('res://'); // the prefix is noise in a summary
  });

  it('collapses selection churn to a count', () => {
    // A drag fires selection continuously; twelve records is what the summary
    // exists to replace.
    const events: ActivityEvent[] = Array.from({ length: 12 }, (_, i) => ev(i + 1, 'human', 'selection'));
    const s = summarizeActivity(events);
    expect(s).toContain('12 times');
  });

  it('counts rather than lists once there are several files', () => {
    const events: ActivityEvent[] = ['a', 'b', 'c'].map((n, i) => ({
      id: i + 1, type: 'script_focus', detail: `res://${n}.gd`, source: 'human',
    }));
    const s = summarizeActivity(events);
    expect(s).toContain('3 scripts');
    expect(s).not.toContain('a.gd');
  });

  it('reads as one sentence when several kinds of thing happened', () => {
    const s = summarizeActivity([
      { id: 1, type: 'scene_saved', detail: 'res://a.tscn', source: 'human' },
      { id: 2, type: 'undo_redo', detail: 'Move Node', source: 'human' },
      ev(3, 'human', 'selection'),
    ]);
    expect(s.startsWith('The developer ')).toBe(true);
    expect(s).toContain(' and ');
    expect(s.endsWith('.')).toBe(true);
  });
});

/**
 * The running game is a second source. It reports what only it can see — the
 * autoload knows its scene was swapped, the editor's debugger knows the game
 * died — and neither is the developer, so neither may be filtered out as the
 * agent's own work.
 */
describe('ActivityFeed — the running game', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const runtime = (type: string, detail: unknown = '', id = 1): ActivityEvent =>
    ({ id, type, detail, source: 'runtime' });

  it('notifies on a pushed runtime event', async () => {
    const server = makeServer();
    const feed = new ActivityFeed(server, vi.fn().mockResolvedValue(null));
    feed.subscribe(ACTIVITY_URI);

    feed.push(runtime('game_crashed', { can_debug: false }));
    await vi.advanceTimersByTimeAsync(500);

    expect(server.notification).toHaveBeenCalledTimes(1);
    feed.stop();
  });

  it('keeps runtime ids out of the editor poll cursor', () => {
    // The two sources number their events independently. A runtime event with
    // id 900 must not make the feed skip the editor's events 1..900.
    const feed = new ActivityFeed(makeServer(), vi.fn().mockResolvedValue(null));
    feed.subscribe(ACTIVITY_URI);

    feed.push(runtime('game_started', 'res://main.tscn', 900));

    expect(feed.snapshot().latest_id).toBe(0);
    feed.stop();
  });

  it('notifies again for a second runtime event with a lower id', async () => {
    // Regression: dedup used to be "id higher than the last notified", which a
    // second source's independent sequence silently defeats.
    const server = makeServer();
    const feed = new ActivityFeed(server, vi.fn().mockResolvedValue(null));
    feed.subscribe(ACTIVITY_URI);

    feed.push(runtime('game_started', 'res://a.tscn', 50));
    await vi.advanceTimersByTimeAsync(500);
    feed.push(runtime('game_crashed', { can_debug: false }, 1));
    await vi.advanceTimersByTimeAsync(500);

    expect(server.notification).toHaveBeenCalledTimes(2);
    feed.stop();
  });

  it('reports the game state rather than counting transitions', () => {
    const s = summarizeActivity([
      runtime('game_started', 'res://menu.tscn', 1),
      runtime('game_scene_changed', 'res://level_1.tscn', 2),
      runtime('game_scene_changed', 'res://level_2.tscn', 3),
    ]);
    expect(s).toContain('level_2.tscn');
    expect(s).toContain('stale');
    expect(s).not.toContain('menu.tscn');
  });

  it('calls out a crash even when a later event superseded it', () => {
    const s = summarizeActivity([
      runtime('game_crashed', { can_debug: false }, 1),
      runtime('game_stopped', '', 2),
    ]);
    expect(s).toContain('crashed');
  });

  it('reports the developer and the game in one summary', () => {
    const s = summarizeActivity([
      { id: 1, type: 'scene_saved', detail: 'res://a.tscn', source: 'human' },
      runtime('game_crashed', { can_debug: false }, 1),
    ]);
    expect(s).toContain('The developer saved a.tscn');
    expect(s).toContain('The game crashed');
  });
});
