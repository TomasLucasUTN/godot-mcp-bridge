@tool
extends Node
class_name SceneToolBase
## Shared base for every tool node that reads or mutates scenes. Centralizes the
## helpers that were previously copy-pasted — and had started to diverge — across
## ~12 tool files: path sanitizing, scene load/save, node lookup, editor refresh,
## and the live-editor-tree detection used to avoid clobbering unsaved edits.
##
## Before this existed, `_load_scene` had 3 different implementations and only
## scene_tools.gd carried the live-tree route, so every other scene-editing tool
## silently overwrote unsaved editor changes. Keeping one copy here means a fix
## lands everywhere at once. Tool files `extends SceneToolBase` and drop their
## local copies.

const VariantCodec = preload("res://addons/godot_mcp/utils/variant_codec.gd")
const PathGuard = preload("res://addons/godot_mcp/utils/path_guard.gd")

var _editor_plugin: EditorPlugin = null

func set_editor_plugin(plugin: EditorPlugin) -> void:
	_editor_plugin = plugin

func _refresh_filesystem() -> void:
	if _editor_plugin:
		_editor_plugin.get_editor_interface().get_resource_filesystem().scan()

## Rescan the filesystem and, if the edited scene is the one that changed on disk,
## reload it so the editor view matches. Only meaningful after a disk save.
func _refresh_and_reload(scene_path: String) -> void:
	if _editor_plugin:
		var ei = _editor_plugin.get_editor_interface()
		ei.get_resource_filesystem().scan()
		var edited = ei.get_edited_scene_root()
		if edited and edited.scene_file_path == scene_path:
			ei.reload_scene_from_path(scene_path)

## Sanitizes a res://-relative path and blocks traversal outside the project
## (e.g. "../../../Windows/System32"). On rejection returns a path that can never
## resolve to a real file, so every downstream FileAccess/load() fails closed with
## a clear error instead of silently escaping the sandbox. See MERGE_NOTES.md — a
## plain "res://" prefix check does NOT stop "../" traversal.
func _ensure_res_path(path: String) -> String:
	var guarded := PathGuard.sanitize(path)
	if not guarded[&"ok"]:
		push_warning("[MCP] Rejected path outside project sandbox: %s (%s)" % [path, guarded[&"error"]])
		return "res://__mcp_rejected_path__"
	return guarded[&"path"]

## If `scene_path` is the scene currently open in the editor, return its LIVE root
## (the tree holding the user's unsaved edits). Otherwise null. Mutating this live
## tree (ideally via _get_undo_redo) is undo-safe and does NOT clobber unsaved
## changes — unlike the disk load→save path, which overwrites whatever wasn't saved.
func _edited_root_if_open(scene_path: String) -> Node:
	if not _editor_plugin:
		return null
	var edited = _editor_plugin.get_editor_interface().get_edited_scene_root()
	if edited and edited.scene_file_path == scene_path:
		return edited
	return null

func _get_undo_redo() -> EditorUndoRedoManager:
	if not _editor_plugin:
		return null
	return _editor_plugin.get_undo_redo()

## Returns [scene_root, error_dict]. If error_dict is not empty, scene_root is null.
## The instantiated tree is a disk copy the caller owns and must free (or hand to
## _save_scene / _finish_scene_edit, which free it).
func _load_scene(scene_path: String) -> Array:
	if scene_path.begins_with("res://__mcp_rejected_path__"):
		return [null, {&"ok": false, &"error": "Path escapes the project sandbox (rejected)"}]
	if not FileAccess.file_exists(scene_path):
		return [null, {&"ok": false, &"error": "Scene does not exist: " + scene_path}]
	var packed = load(scene_path) as PackedScene
	if not packed:
		return [null, {&"ok": false, &"error": "Failed to load scene: " + scene_path}]
	var root = _instantiate_packed_scene_for_edit(packed)
	if not root:
		return [null, {&"ok": false, &"error": "Failed to instantiate scene"}]
	return [root, {}]

## Instantiate with the right edit-state flag so sub-resources and inherited
## scenes round-trip correctly through a re-save (a plain instantiate() loses
## edit state and can corrupt inherited scenes). `as_instance` is for embedding
## one scene inside another (instance_scene).
func _instantiate_packed_scene_for_edit(packed: PackedScene, as_instance: bool = false) -> Node:
	if not packed:
		return null
	if not Engine.is_editor_hint():
		return packed.instantiate()
	if as_instance:
		return packed.instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)
	var state = packed.get_state()
	if state and state.get_base_scene_state() != null:
		return packed.instantiate(PackedScene.GEN_EDIT_STATE_MAIN_INHERITED)
	return packed.instantiate(PackedScene.GEN_EDIT_STATE_MAIN)

## Pack and save a disk-loaded scene root, then free it. Returns {} on success or
## an error dict. NEVER call this on a live edited root — it frees the node.
func _save_scene(scene_root: Node, scene_path: String) -> Dictionary:
	if scene_path.begins_with("res://__mcp_rejected_path__"):
		scene_root.queue_free()
		return {&"ok": false, &"error": "Path escapes the project sandbox (rejected)"}
	var packed = PackedScene.new()
	var pack_result = packed.pack(scene_root)
	if pack_result != OK:
		scene_root.queue_free()
		return {&"ok": false, &"error": "Failed to pack scene: " + str(pack_result)}
	var save_result = ResourceSaver.save(packed, scene_path)
	scene_root.queue_free()
	if save_result != OK:
		return {&"ok": false, &"error": "Failed to save scene: " + str(save_result)}
	_refresh_and_reload(scene_path)
	return {}

func _find_node(scene_root: Node, node_path: String) -> Node:
	if node_path == "." or node_path.is_empty():
		return scene_root
	return scene_root.get_node_or_null(node_path)

func _parse_value(value: Variant) -> Variant:
	return VariantCodec.parse_value(value)

func _serialize_value(value: Variant) -> Variant:
	return VariantCodec.serialize_value(value)

func _set_node_properties(node: Node, properties: Dictionary) -> void:
	for prop_name: String in properties:
		node.set(prop_name, _parse_value(properties[prop_name]))

## Acquire the scene root to mutate. Returns [root, is_live, error_dict]:
##   - is_live true  → root is the editor's LIVE tree; mutate in place, do NOT
##                     free it, and pass is_live to _finish_scene_edit (no disk save).
##   - is_live false → root is a disk copy; caller must _finish_scene_edit to persist.
## This is the single choke point that makes scene-editing tools stop clobbering
## unsaved edits when the target scene is open.
func _acquire_scene(scene_path: String) -> Array:
	var live := _edited_root_if_open(scene_path)
	if live != null:
		return [live, true, {}]
	var r := _load_scene(scene_path)
	if not r[1].is_empty():
		return [null, false, r[1]]
	return [r[0], false, {}]

## Finish a scene edit started with _acquire_scene. Disk copy → pack+save (frees
## root). Live tree → mark the edited scene unsaved so the user sees the dirty
## marker and knows to save; the mutation already landed on the editor's tree and
## persists on save, unclobbered. Returns {} on success / error dict.
func _finish_scene_edit(root: Node, scene_path: String, is_live: bool) -> Dictionary:
	if is_live:
		if _editor_plugin:
			_editor_plugin.get_editor_interface().mark_scene_as_unsaved()
		return {}
	return _save_scene(root, scene_path)

## Free a disk-loaded scene root on an error path. No-op when the root is the LIVE
## edited tree — freeing that would crash the editor. Lets tools keep their
## `root.queue_free()` error cleanup by swapping in `_discard_scene(root, is_live)`.
func _discard_scene(root: Node, is_live: bool) -> void:
	if not is_live and is_instance_valid(root):
		root.queue_free()
