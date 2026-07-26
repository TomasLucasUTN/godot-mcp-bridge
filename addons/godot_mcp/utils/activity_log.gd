extends RefCounted
class_name McpActivityLog
## Ring buffer of editor activity, tagged human vs agent.
##
## Split out of plugin.gd so the buffering/tagging/digest rules can be tested
## headless: an EditorPlugin cannot be instantiated outside the editor, and the
## alternative (a human clicking around in a live editor) is not automatable.

const CAP := 200
## Editor signals fire DEFERRED — a frame or two after the tool call that caused
## them returns. So instead of an "is a tool running" flag, a window runs through
## the call and a little past it; activity inside it is the agent's own.
const AGENT_GRACE_MS := 350
## How many events ride along on a tool response. The full history is available
## through get_editor_activity; this is only a nudge, so it stays cheap.
const DIGEST_MAX := 5

## Emitted for each HUMAN-sourced event as it happens, so the plugin can push it
## to the server instead of the server polling for it. Agent-sourced events are
## not emitted: the agent already knows what it did, and pushing them back would
## make every tool call generate traffic.
signal human_activity(event: Dictionary)

var _ring: Array = []
var _seq: int = 0
var _agent_until_ms: int = 0
var _digest_cursor: int = 0

## Open the agent window for the duration of a tool call.
func begin_agent_call() -> void:
	_agent_until_ms = Time.get_ticks_msec() + 3600000

## Close it, leaving the grace period for deferred signals.
func end_agent_call() -> void:
	_agent_until_ms = Time.get_ticks_msec() + AGENT_GRACE_MS

func record(type: String, detail) -> void:
	_seq += 1
	# Best-effort attribution: a human action within the grace window can be
	# mis-tagged agent, and a very slow deferred signal can slip to human.
	var source := "agent" if Time.get_ticks_msec() < _agent_until_ms else "human"
	var event := {&"id": _seq, &"t_ms": Time.get_ticks_msec(), &"type": type, &"detail": detail, &"source": source}
	_ring.append(event)
	if _ring.size() > CAP:
		_ring = _ring.slice(_ring.size() - CAP)
	if source == "human":
		human_activity.emit(event)

## Events after `since_id` (0 = everything buffered), newest last. `source_filter`
## of "human"/"agent" narrows to that origin. `latest_id` lets a poller advance
## its cursor: call again with since_id = latest_id to get only what is new.
func query(since_id: int, limit: int, source_filter: String = "") -> Dictionary:
	var out: Array = []
	for e in _ring:
		if int(e[&"id"]) <= since_id:
			continue
		if not source_filter.is_empty() and str(e.get(&"source", "")) != source_filter:
			continue
		out.append(e)
	if out.size() > limit:
		out = out.slice(out.size() - limit, out.size())
	return {&"events": out, &"latest_id": _seq, &"count": out.size()}

## Compact summary of human events since the last call, or {} if there were none.
## Advances its own cursor (kept separate from query()'s caller-supplied since_id,
## so the two do not consume each other's events) — each event is digested once.
func human_digest() -> Dictionary:
	var events: Array = []
	for e in _ring:
		if int(e[&"id"]) <= _digest_cursor:
			continue
		if str(e.get(&"source", "")) == "human":
			events.append(e)
	_digest_cursor = _seq
	if events.is_empty():
		return {}

	var recent: Array = events.slice(maxi(0, events.size() - DIGEST_MAX), events.size())
	var compact: Array = []
	for e in recent:
		compact.append({&"type": e[&"type"], &"detail": e[&"detail"]})
	return {
		&"human_events_since_last_call": events.size(),
		&"recent": compact,
		&"note": "The developer did this in the editor while you were working. Call get_editor_activity for the full history.",
	}
