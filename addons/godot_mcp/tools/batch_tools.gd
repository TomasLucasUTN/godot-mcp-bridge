@tool
extends SceneToolBase
class_name BatchTools
## Batch/refactor/analysis tools for MCP.
## Handles: find_nodes_by_type, batch_set_property, get_scene_dependencies,
##          rename_symbol_project_wide

const _SKIP_EXTENSIONS := {".import": true, ".uid": true, ".translation": true}
const MAX_TRAVERSAL_DEPTH := 24

# =============================================================================
# find_nodes_by_type
# =============================================================================
func find_nodes_by_type(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_type: String = str(args.get(&"node_type", ""))
	var exact_match: bool = bool(args.get(&"exact_match", false))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if node_type.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'node_type'"}

	# Read the open scene's live tree when there is one, so nodes the user added
	# but has not saved yet are reported instead of silently missing.
	var acquired := _acquire_scene(scene_path)
	if not acquired[2].is_empty():
		return acquired[2]
	var root: Node = acquired[0]

	var matches: Array = []
	_find_nodes_by_type_recursive(root, root, node_type, exact_match, matches)
	_discard_scene(root, acquired[1])

	return {&"ok": true, &"scene_path": scene_path, &"node_type": node_type,
		&"matches": matches, &"count": matches.size()}

func _find_nodes_by_type_recursive(node: Node, root: Node, node_type: String, exact_match: bool, out: Array) -> void:
	var matches_type := (node.get_class() == node_type) if exact_match else node.is_class(node_type)
	if matches_type:
		var path_str: String = "." if node == root else str(root.get_path_to(node))
		out.append({&"node_path": path_str, &"node_name": node.name, &"node_type": node.get_class()})
	for child in node.get_children():
		_find_nodes_by_type_recursive(child, root, node_type, exact_match, out)

# =============================================================================
# batch_set_property
# =============================================================================
func batch_set_property(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_paths: Array = args.get(&"node_paths", [])
	var property_name: String = str(args.get(&"property_name", ""))
	var value = args.get(&"value")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if node_paths.is_empty():
		return {&"ok": false, &"error": "Missing 'node_paths' (non-empty array)"}
	if property_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'property_name'"}
	if not args.has(&"value"):
		return {&"ok": false, &"error": "Missing 'value'"}

	# Used to load from disk, save, and reload the open scene: every unsaved edit
	# in that scene was lost, even with dry_run. The live tree keeps them, and the
	# change lands as one undo entry.
	var acquired := _acquire_scene(scene_path)
	if not acquired[2].is_empty():
		return acquired[2]
	var root: Node = acquired[0]
	var is_live: bool = acquired[1]

	var applied: Array = []
	var failed: Array = []
	var ctx := _begin_edit(is_live, "MCP: batch set %s" % property_name, root)

	for np in node_paths:
		var node_path := str(np)
		var target := _find_node(root, node_path)
		if not target:
			# Named in the message too: a batch answer is read as a list of
			# strings, and "Node not found" repeated four times says nothing
			# about which four.
			failed.append({&"node_path": node_path, &"error": "Node not found: " + node_path})
			continue
		if not (property_name in target):
			failed.append({&"node_path": node_path, &"error": "No property '%s' on %s" % [property_name, target.get_class()]})
			continue
		if property_name in ["script", "owner", "scene_file_path"]:
			failed.append({&"node_path": node_path, &"error": "Use the dedicated script/structural tool"})
			continue
		if property_name == "name":
			var guard := _structural_edit_error(root, target)
			if not guard.is_empty():
				failed.append({&"node_path": node_path, &"error": guard[&"error"]})
				continue
		var parsed_value: Variant = _parse_typed_value(value, _property_type_map(target).get(property_name, -1))
		var old_value = target.get(property_name)
		target.set(property_name, parsed_value)
		if not _values_match(target.get(property_name), parsed_value):
			target.set(property_name, old_value)
			failed.append({&"node_path": node_path, &"error": "Property rejected or clamped the requested value"})
			continue
		_edit_record(ctx, target, &"set", [StringName(property_name), target.get(property_name)],
			&"set", [StringName(property_name), old_value])
		applied.append({&"node_path": node_path, &"old": VariantCodec.serialize_value(old_value), &"new": VariantCodec.serialize_value(parsed_value)})

	if applied.is_empty():
		# Nothing changed: no undo entry, no dirty marker, no rewrite of the file.
		_edit_abort(ctx)
		_discard_scene(root, is_live)
	else:
		_edit_commit(ctx)
		var err := _finish_scene_edit(root, scene_path, is_live)
		if not err.is_empty():
			return err

	return {&"ok": true, &"scene_path": scene_path, &"property_name": property_name,
		&"applied": applied, &"failed": failed,
		&"message": "Applied %d/%d, %d failed" % [applied.size(), node_paths.size(), failed.size()]}

# =============================================================================
# get_scene_dependencies
# =============================================================================
func get_scene_dependencies(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if not FileAccess.file_exists(scene_path):
		return {&"ok": false, &"error": "Scene does not exist: " + scene_path}

	var deps := ResourceLoader.get_dependencies(scene_path)
	var dependencies: Array = []
	for dep: String in deps:
		# get_dependencies() entries look like "<uid_or_path>::<type_hint>" or
		# just a path; split on "::" defensively.
		var parts := dep.split("::")
		var dep_path: String = parts[0]
		dependencies.append({&"path": dep_path, &"type_hint": parts[1] if parts.size() > 1 else ""})

	return {&"ok": true, &"scene_path": scene_path,
		&"dependencies": dependencies, &"count": dependencies.size()}

# =============================================================================
# rename_symbol_project_wide
# =============================================================================
## Word-boundary regex rename across .gd files (and optionally .tscn method
## references). Defaults to dry_run=true — the community's own complaint
## about automated renames is false positives, so previewing matches before
## touching anything is the safe default, not an afterthought.
const _IDENTIFIER_RE := "^[A-Za-z_][A-Za-z0-9_]*$"

func rename_symbol_project_wide(args: Dictionary) -> Dictionary:
	var old_name: String = str(args.get(&"old_name", ""))
	var new_name: String = str(args.get(&"new_name", ""))
	var dry_run: bool = bool(args.get(&"dry_run", true))
	var include_scenes: bool = bool(args.get(&"include_scenes", false))
	var root_path: String = _ensure_res_path(str(args.get(&"root", "res://")))

	if old_name.strip_edges().is_empty() or new_name.strip_edges().is_empty():
		return {&"ok": false, &"error": "Missing 'old_name' or 'new_name'"}
	if PathGuard.is_bad(root_path):
		return PathGuard.error_for(root_path, "root")

	var ident_check := RegEx.new()
	ident_check.compile(_IDENTIFIER_RE)
	if not ident_check.search(old_name) or not ident_check.search(new_name):
		return {&"ok": false, &"error": "'old_name'/'new_name' must be valid identifiers ([A-Za-z_][A-Za-z0-9_]*)"}

	var regex := RegEx.new()
	regex.compile("\\b" + old_name + "\\b")

	var extensions: Array = [".gd"]
	if include_scenes:
		extensions.append(".tscn")

	var files: PackedStringArray = []
	_collect_files_recursive(root_path, extensions, files)

	var file_results: Array = []
	var total_matches := 0
	var changes: Dictionary = {}
	var open_scenes: PackedStringArray = []
	if not dry_run and _editor_plugin:
		open_scenes = _editor_plugin.get_editor_interface().get_open_scenes()

	for file_path: String in files:
		var f := FileAccess.open(file_path, FileAccess.READ)
		if not f:
			return {&"ok": false, &"error": "Cannot preflight file: " + file_path}
		var content := f.get_as_text()
		var read_error := f.get_error()
		f.close()
		if read_error != OK:
			return {&"ok": false, &"error": "Failed to read file: " + file_path}

		var matches := regex.search_all(content)
		if matches.is_empty():
			continue

		var lines := content.split("\n")
		var line_hits: Array = []
		for i in range(lines.size()):
			if regex.search(lines[i]):
				line_hits.append({&"line": i + 1, &"content": lines[i].strip_edges()})

		total_matches += matches.size()
		file_results.append({&"file": file_path, &"match_count": matches.size(), &"lines": line_hits})

		if not dry_run:
			var new_content := regex.sub(content, new_name, true)
			if new_content == content:
				continue
			if Array(open_scenes).any(func(open_path: String) -> bool: return _same_scene_path(open_path, file_path)):
				return {&"ok": false, &"error": "Refusing to refactor an open scene: %s. Close its scene tab first; no files changed." % file_path}
			changes[file_path] = new_content

	# All candidates must pass preflight before the first disk write.
	var written: Array = []
	for file_path: String in changes:
		var wf := FileAccess.open(file_path, FileAccess.WRITE)
		if not wf:
			return {&"ok": false, &"error": "Failed to write file: " + file_path, &"written_files": written}
		wf.store_string(changes[file_path])
		var write_error := wf.get_error()
		wf.close()
		if write_error != OK:
			return {&"ok": false, &"error": "Failed to write file: " + file_path, &"written_files": written}
		written.append(file_path)

	if not dry_run and _editor_plugin:
		_editor_plugin.get_editor_interface().get_resource_filesystem().scan()

	return {&"ok": true, &"old_name": old_name, &"new_name": new_name,
		&"dry_run": dry_run, &"files": file_results,
		&"file_count": file_results.size(), &"total_matches": total_matches,
		&"message": ("Preview: %d matches in %d files. Call again with dry_run=false to apply." % [total_matches, file_results.size()]) if dry_run
			else ("Renamed %d matches in %d files." % [total_matches, file_results.size()])}

func _collect_files_recursive(path: String, extensions: Array, out: PackedStringArray, depth: int = 0) -> void:
	if depth >= MAX_TRAVERSAL_DEPTH:
		return
	var dir := DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if name.begins_with("."):
			name = dir.get_next()
			continue
		var full_path := path.path_join(name)
		if dir.current_is_dir():
			_collect_files_recursive(full_path, extensions, out, depth + 1)
		else:
			var ext := "." + name.get_extension().to_lower()
			if extensions.has(ext) and not _SKIP_EXTENSIONS.has(ext):
				out.append(full_path)
		name = dir.get_next()
