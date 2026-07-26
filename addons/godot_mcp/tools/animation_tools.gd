@tool
extends SceneToolBase
class_name AnimationTools
## Animation operation tools for MCP.
## Handles: list_animations, create_animation, add_animation_track,
##          set_animation_keyframe, get_animation_info, remove_animation
## All tools operate on an AnimationPlayer node inside a scene file, reading
## and writing its default AnimationLibrary ("" / AnimationMixer::ANIM_LIB_DEFAULT).


const _DEFAULT_LIB := ""


## Validate that the target node exists and is an AnimationPlayer. Returns
## [node_or_null, error_string].
func _get_animation_player(root: Node, node_path: String) -> Array:
	var target = _find_node(root, node_path)
	if not target:
		return [null, "Node not found: " + node_path]
	if not (target is AnimationPlayer):
		return [null, "Node '%s' is %s, expected AnimationPlayer" % [node_path, target.get_class()]]
	return [target, ""]

## Get (or lazily create) the default AnimationLibrary on an AnimationPlayer.
func _get_or_create_default_library(player: AnimationPlayer) -> AnimationLibrary:
	if player.has_animation_library(_DEFAULT_LIB):
		return player.get_animation_library(_DEFAULT_LIB)
	var lib := AnimationLibrary.new()
	player.add_animation_library(_DEFAULT_LIB, lib)
	return lib

const _TRACK_TYPES := {
	"value": Animation.TYPE_VALUE,
	"position": Animation.TYPE_POSITION_3D,
	"rotation": Animation.TYPE_ROTATION_3D,
	"method": Animation.TYPE_METHOD,
}

# =============================================================================
# list_animations
# =============================================================================
func list_animations(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var player_result := _get_animation_player(root, node_path)
	if not player_result[1].is_empty():
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": player_result[1]}
	var player: AnimationPlayer = player_result[0]

	var animations: Array = []
	for anim_name: StringName in player.get_animation_list():
		var anim := player.get_animation(anim_name)
		animations.append({
			&"name": str(anim_name),
			&"length": anim.length,
			&"loop": anim.loop_mode != Animation.LOOP_NONE,
			&"track_count": anim.get_track_count(),
		})

	_discard_scene(root, is_live)

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"animations": animations, &"animation_count": animations.size()}

# =============================================================================
# create_animation
# =============================================================================
func create_animation(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))
	var animation_name: String = str(args.get(&"animation_name", ""))
	var length: float = float(args.get(&"length", 1.0))
	var loop: bool = bool(args.get(&"loop", false))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if animation_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'animation_name'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var player_result := _get_animation_player(root, node_path)
	if not player_result[1].is_empty():
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": player_result[1]}
	var player: AnimationPlayer = player_result[0]

	var lib := _get_or_create_default_library(player)
	if lib.has_animation(animation_name):
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Animation already exists: " + animation_name}

	var anim := Animation.new()
	anim.length = length
	anim.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	var ctx := _begin_edit(is_live, "MCP: create animation '%s'" % animation_name, root)
	lib.add_animation(animation_name, anim)
	_edit_record(ctx, lib, &"add_animation", [animation_name, anim],
		&"remove_animation", [animation_name])
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"animation_name": animation_name, &"length": length, &"loop": loop,
		&"message": "Created animation '%s' on '%s'" % [animation_name, node_path]}

# =============================================================================
# add_animation_track
# =============================================================================
func add_animation_track(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))
	var animation_name: String = str(args.get(&"animation_name", ""))
	var track_type: String = str(args.get(&"track_type", ""))
	var track_node_path: String = str(args.get(&"track_node_path", ""))
	var property_name: String = str(args.get(&"property", ""))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if animation_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'animation_name'"}
	if not _TRACK_TYPES.has(track_type):
		return {&"ok": false, &"error": "Invalid 'track_type': %s. Use one of: %s" % [track_type, ", ".join(_TRACK_TYPES.keys())]}
	if track_node_path.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'track_node_path'"}
	if track_type == "value" and property_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'property' (required for track_type 'value')"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var player_result := _get_animation_player(root, node_path)
	if not player_result[1].is_empty():
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": player_result[1]}
	var player: AnimationPlayer = player_result[0]

	var lib := _get_or_create_default_library(player)
	if not lib.has_animation(animation_name):
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Animation not found: " + animation_name}
	var anim := lib.get_animation(animation_name)

	var np: NodePath
	if track_type == "value":
		np = NodePath(str(track_node_path) + ":" + property_name)
	else:
		np = NodePath(track_node_path)

	var ctx := _begin_edit(is_live, "MCP: add %s track" % track_type, root)
	var track_idx := anim.add_track(_TRACK_TYPES[track_type])
	anim.track_set_path(track_idx, np)
	# add_track appends, so the inverse is removing the index it landed on.
	_edit_record(ctx, anim, &"add_track", [_TRACK_TYPES[track_type]],
		&"remove_track", [track_idx])
	_edit_record(ctx, anim, &"track_set_path", [track_idx, np],
		&"track_set_path", [track_idx, np])
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"animation_name": animation_name, &"track_index": track_idx,
		&"track_type": track_type, &"track_path": str(np),
		&"message": "Added %s track '%s' to '%s'" % [track_type, str(np), animation_name]}

# =============================================================================
# set_animation_keyframe
# =============================================================================
func set_animation_keyframe(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))
	var animation_name: String = str(args.get(&"animation_name", ""))
	var track_index: int = int(args.get(&"track_index", -1))
	var time: float = float(args.get(&"time", 0.0))
	var value = args.get(&"value")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if animation_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'animation_name'"}
	if track_index < 0:
		return {&"ok": false, &"error": "Missing or invalid 'track_index'"}
	if value == null:
		return {&"ok": false, &"error": "Missing 'value'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var player_result := _get_animation_player(root, node_path)
	if not player_result[1].is_empty():
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": player_result[1]}
	var player: AnimationPlayer = player_result[0]

	var lib := _get_or_create_default_library(player)
	if not lib.has_animation(animation_name):
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Animation not found: " + animation_name}
	var anim := lib.get_animation(animation_name)

	if track_index >= anim.get_track_count():
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Track index %d out of range (animation has %d tracks)" % [track_index, anim.get_track_count()]}

	var track_type := anim.track_get_type(track_index)
	var parsed_value = VariantCodec.parse_value(value)

	var key_index: int
	if track_type == Animation.TYPE_METHOD:
		if typeof(parsed_value) != TYPE_DICTIONARY or not parsed_value.has(&"method"):
			_discard_scene(root, is_live)
			return {&"ok": false, &"error": "For a method track, 'value' must be {\"method\": \"name\", \"args\": [...]}"}
		key_index = anim.track_insert_key(track_index, time, {
			&"method": str(parsed_value[&"method"]),
			&"args": parsed_value.get(&"args", []),
		})
	else:
		key_index = anim.track_insert_key(track_index, time, parsed_value)

	if key_index < 0:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Failed to insert keyframe: value type doesn't match track type %d (position/rotation tracks require Vector3/Quaternion — for 2D nodes use track_type 'value' with property 'position'/'rotation' instead)" % track_type}

	# Registered after the insert because the key index isn't known until the
	# engine places it by time — and the failure above must not leave an action
	# open on the undo stack.
	var ctx := _begin_edit(is_live, "MCP: keyframe at %ss" % time, root)
	_edit_record(ctx, anim, &"track_insert_key", [track_index, time, anim.track_get_key_value(track_index, key_index)],
		&"track_remove_key", [track_index, key_index])
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"animation_name": animation_name, &"track_index": track_index,
		&"key_index": key_index, &"time": time,
		&"message": "Inserted keyframe at t=%s on track %d of '%s'" % [str(time), track_index, animation_name]}

# =============================================================================
# get_animation_info
# =============================================================================
func get_animation_info(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))
	var animation_name: String = str(args.get(&"animation_name", ""))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if animation_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'animation_name'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var player_result := _get_animation_player(root, node_path)
	if not player_result[1].is_empty():
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": player_result[1]}
	var player: AnimationPlayer = player_result[0]

	var lib := _get_or_create_default_library(player)
	if not lib.has_animation(animation_name):
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Animation not found: " + animation_name}
	var anim := lib.get_animation(animation_name)

	var tracks: Array = []
	for i in range(anim.get_track_count()):
		var keys: Array = []
		for k in range(anim.track_get_key_count(i)):
			keys.append({
				&"time": anim.track_get_key_time(i, k),
				&"value": VariantCodec.serialize_value(anim.track_get_key_value(i, k)),
			})
		tracks.append({
			&"index": i,
			&"type": anim.track_get_type(i),
			&"path": str(anim.track_get_path(i)),
			&"keys": keys,
		})

	_discard_scene(root, is_live)

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"animation_name": animation_name, &"length": anim.length,
		&"loop": anim.loop_mode != Animation.LOOP_NONE,
		&"tracks": tracks, &"track_count": tracks.size()}

# =============================================================================
# remove_animation
# =============================================================================
func remove_animation(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))
	var animation_name: String = str(args.get(&"animation_name", ""))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if animation_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'animation_name'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var player_result := _get_animation_player(root, node_path)
	if not player_result[1].is_empty():
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": player_result[1]}
	var player: AnimationPlayer = player_result[0]

	var lib := _get_or_create_default_library(player)
	if not lib.has_animation(animation_name):
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Animation not found: " + animation_name}

	# Grab the resource before dropping it, or undo has nothing to put back.
	var removed_anim := lib.get_animation(animation_name)
	var ctx := _begin_edit(is_live, "MCP: remove animation '%s'" % animation_name, root)
	lib.remove_animation(animation_name)
	_edit_record(ctx, lib, &"remove_animation", [animation_name],
		&"add_animation", [animation_name, removed_anim])
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"animation_name": animation_name,
		&"message": "Removed animation '%s' from '%s'" % [animation_name, node_path]}
