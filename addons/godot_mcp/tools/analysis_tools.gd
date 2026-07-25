@tool
extends SceneToolBase
class_name AnalysisTools
## Read-only project analysis tools for MCP.
## Handles: get_project_statistics, find_unused_resources,
##          detect_circular_dependencies, analyze_scene_complexity,
##          analyze_signal_flow
##
## Everything here only reads: no tool in this file writes to the project.
## The shared scan walks res:// once and is reused by several tools, since a
## full-project text scan is the expensive part (a mid-size project has
## hundreds of files and each analysis would otherwise re-read all of them).

const _ASSET_EXTS := ["png", "jpg", "jpeg", "svg", "webp", "bmp", "ogg", "wav", "mp3",
	"tres", "res", "tscn", "scn", "ttf", "otf", "fnt", "glb", "gltf", "obj", "gdshader"]
const _TEXT_EXTS := ["gd", "tscn", "tres", "cfg", "godot", "gdshader", "cs"]
const _SKIP_DIRS := [".godot", ".git", "addons"]

# =============================================================================
# Shared scanning
# =============================================================================

## Walk res:// and return every file path, skipping engine/VCS dirs.
## `include_addons` lets analysis cover plugin code when explicitly asked.
func _walk(path: String, out: Array, include_addons: bool, depth: int = 0) -> void:
	if depth > 12:
		return
	var dir := DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if entry.begins_with("."):
			entry = dir.get_next()
			continue
		var full := path.path_join(entry)
		if dir.current_is_dir():
			var skip := entry in _SKIP_DIRS and not (entry == "addons" and include_addons)
			if not skip:
				_walk(full, out, include_addons, depth + 1)
		else:
			out.append(full)
		entry = dir.get_next()
	dir.list_dir_end()

func _read_text(path: String) -> String:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return ""
	var s := f.get_as_text()
	f.close()
	return s

## res:// paths referenced by a text file (ext_resource paths, preload/load calls,
## and any bare "res://..." string). Deliberately regex-based rather than loading
## the resource: loading a .tscn pulls in its whole dependency chain, which is far
## too slow for a project-wide sweep and fails on broken scenes.
func _referenced_paths(text: String) -> Array:
	var found: Array = []
	var re := RegEx.new()
	re.compile("res://[^\"'\\)\\]\\s]+")
	for m in re.search_all(text):
		found.append(m.get_string())
	return found

## uid:// references, so a scene that points at a resource by UID (Godot 4's
## default for ext_resource) still counts that resource as used.
func _referenced_uids(text: String) -> Array:
	var found: Array = []
	var re := RegEx.new()
	re.compile("uid://[a-z0-9]+")
	for m in re.search_all(text):
		found.append(m.get_string())
	return found

# =============================================================================
# get_project_statistics
# =============================================================================
func get_project_statistics(args: Dictionary) -> Dictionary:
	var include_addons: bool = bool(args.get(&"include_addons", false))

	var files: Array = []
	_walk("res://", files, include_addons)

	var by_ext: Dictionary = {}
	var script_count := 0
	var scene_count := 0
	var resource_count := 0
	var total_lines := 0
	var total_bytes := 0
	var func_count := 0
	var class_name_count := 0
	var signal_decl_count := 0
	var todo_count := 0

	var re_func := RegEx.new()
	re_func.compile("(?m)^\\s*(static\\s+)?func\\s+")
	var re_signal := RegEx.new()
	re_signal.compile("(?m)^\\s*signal\\s+")
	var re_todo := RegEx.new()
	re_todo.compile("(?i)(TODO|FIXME|HACK|XXX)")

	for p in files:
		var ext := str(p).get_extension().to_lower()
		by_ext[ext] = int(by_ext.get(ext, 0)) + 1
		var fa := FileAccess.open(p, FileAccess.READ)
		if fa != null:
			total_bytes += fa.get_length()
			fa.close()
		if ext == "gd":
			script_count += 1
			var src := _read_text(p)
			total_lines += src.split("\n").size()
			func_count += re_func.search_all(src).size()
			signal_decl_count += re_signal.search_all(src).size()
			todo_count += re_todo.search_all(src).size()
			if src.contains("class_name "):
				class_name_count += 1
		elif ext in ["tscn", "scn"]:
			scene_count += 1
		elif ext in ["tres", "res"]:
			resource_count += 1

	# Node totals across every text scene, counted from the packed state (cheap,
	# no instantiation).
	var node_total := 0
	var scenes_scanned := 0
	for p in files:
		if str(p).get_extension().to_lower() != "tscn":
			continue
		var packed := ResourceLoader.load(p, "PackedScene", ResourceLoader.CACHE_MODE_REUSE) as PackedScene
		if packed == null:
			continue
		node_total += packed.get_state().get_node_count()
		scenes_scanned += 1

	return {
		&"ok": true,
		&"include_addons": include_addons,
		&"files_total": files.size(),
		&"files_by_extension": by_ext,
		&"scripts": script_count,
		&"scenes": scene_count,
		&"resources": resource_count,
		&"script_lines": total_lines,
		&"script_functions": func_count,
		&"scripts_with_class_name": class_name_count,
		&"signal_declarations": signal_decl_count,
		&"todo_markers": todo_count,
		&"nodes_in_scenes": node_total,
		&"scenes_scanned": scenes_scanned,
		&"project_bytes": total_bytes,
	}

# =============================================================================
# find_unused_resources
# =============================================================================
func find_unused_resources(args: Dictionary) -> Dictionary:
	var include_addons: bool = bool(args.get(&"include_addons", false))
	var include_scripts: bool = bool(args.get(&"include_scripts", false))
	var limit: int = int(args.get(&"limit", 200))

	var files: Array = []
	_walk("res://", files, include_addons)

	# One pass: build the reference set from every text file in the project.
	var referenced_paths: Dictionary = {}
	var referenced_uids: Dictionary = {}
	for p in files:
		var ext := str(p).get_extension().to_lower()
		if ext not in _TEXT_EXTS:
			continue
		var text := _read_text(p)
		for r in _referenced_paths(text):
			referenced_paths[r] = true
		for u in _referenced_uids(text):
			referenced_uids[u] = true

	# project.godot lives outside the walk's text set in some layouts; make sure
	# main_scene / autoloads / input events never count as unused.
	var pg := _read_text("res://project.godot")
	for r in _referenced_paths(pg):
		referenced_paths[r] = true
	for u in _referenced_uids(pg):
		referenced_uids[u] = true

	var main_scene := str(ProjectSettings.get_setting("application/run/main_scene", ""))
	if not main_scene.is_empty():
		referenced_paths[main_scene] = true

	var candidates: Array = []
	for p in files:
		var ext := str(p).get_extension().to_lower()
		var is_asset := ext in _ASSET_EXTS
		if include_scripts and ext == "gd":
			is_asset = true
		if not is_asset:
			continue
		if referenced_paths.has(p):
			continue
		# A .tscn/.gd may be referenced by UID instead of path.
		var uid_id := ResourceLoader.get_resource_uid(p)
		if uid_id != ResourceUID.INVALID_ID:
			var uid_str := ResourceUID.id_to_text(uid_id)
			if referenced_uids.has(uid_str):
				continue
		candidates.append(p)

	candidates.sort()
	var truncated := candidates.size() > limit
	if truncated:
		candidates = candidates.slice(0, limit)

	return {
		&"ok": true,
		&"unused": candidates,
		&"unused_count": candidates.size(),
		&"truncated": truncated,
		&"files_scanned": files.size(),
		&"include_addons": include_addons,
		&"include_scripts": include_scripts,
		&"note": "A file is reported unused when no .gd/.tscn/.tres/project.godot references its res:// path or its UID. Resources loaded from a runtime-built string path cannot be detected - review before deleting.",
	}

# =============================================================================
# detect_circular_dependencies
# =============================================================================
func detect_circular_dependencies(args: Dictionary) -> Dictionary:
	var include_addons: bool = bool(args.get(&"include_addons", false))

	var files: Array = []
	_walk("res://", files, include_addons)

	# file -> [files it depends on]. Only project-internal .gd/.tscn/.tres edges;
	# a dependency on an image or font can never form a cycle.
	var graph: Dictionary = {}
	var uid_to_path: Dictionary = {}
	for p in files:
		var uid_id := ResourceLoader.get_resource_uid(p)
		if uid_id != ResourceUID.INVALID_ID:
			uid_to_path[ResourceUID.id_to_text(uid_id)] = p

	for p in files:
		var ext := str(p).get_extension().to_lower()
		if ext not in ["gd", "tscn", "tres"]:
			continue
		var text := _read_text(p)
		var deps: Array = []
		for r in _referenced_paths(text):
			if r == p:
				continue
			var rext := str(r).get_extension().to_lower()
			if rext in ["gd", "tscn", "tres"] and not deps.has(r):
				deps.append(r)
		for u in _referenced_uids(text):
			if uid_to_path.has(u):
				var rp: String = uid_to_path[u]
				if rp != p and not deps.has(rp):
					var rpext := str(rp).get_extension().to_lower()
					if rpext in ["gd", "tscn", "tres"]:
						deps.append(rp)
		graph[p] = deps

	# Iterative DFS with an on-stack set; every back-edge is reported once as the
	# path slice from the first occurrence of the revisited node.
	var cycles: Array = []
	var seen_cycle_keys: Dictionary = {}
	var color: Dictionary = {}  # 0/absent = unvisited, 1 = on stack, 2 = done

	for start in graph.keys():
		if color.get(start, 0) != 0:
			continue
		var stack: Array = [[start, 0]]
		var path: Array = [start]
		color[start] = 1
		while not stack.is_empty():
			var top: Array = stack[-1]
			var node: String = top[0]
			var idx: int = top[1]
			var deps: Array = graph.get(node, [])
			if idx >= deps.size():
				color[node] = 2
				stack.pop_back()
				path.pop_back()
				continue
			stack[-1][1] = idx + 1
			var nxt: String = deps[idx]
			if not graph.has(nxt):
				continue
			var c: int = color.get(nxt, 0)
			if c == 1:
				var at := path.find(nxt)
				if at >= 0:
					var cyc: Array = path.slice(at)
					cyc.append(nxt)
					var key: Array = cyc.slice(0, cyc.size() - 1).duplicate()
					key.sort()
					var kstr := "|".join(key)
					if not seen_cycle_keys.has(kstr):
						seen_cycle_keys[kstr] = true
						cycles.append(cyc)
			elif c == 0:
				color[nxt] = 1
				path.append(nxt)
				stack.append([nxt, 0])

	return {
		&"ok": true,
		&"cycles": cycles,
		&"cycle_count": cycles.size(),
		&"nodes_in_graph": graph.size(),
		&"include_addons": include_addons,
		&"note": "Edges come from res:// / uid:// references between .gd, .tscn and .tres files. A GDScript cycle is legal at runtime when it uses load() lazily, but a preload() cycle is a parse error - check which kind each reported cycle is.",
	}

# =============================================================================
# analyze_scene_complexity
# =============================================================================
func analyze_scene_complexity(args: Dictionary) -> Dictionary:
	var scene_path: String = str(args.get(&"scene_path", ""))
	var include_addons: bool = bool(args.get(&"include_addons", false))
	var limit: int = int(args.get(&"limit", 40))

	var targets: Array = []
	if not scene_path.strip_edges().is_empty():
		targets.append(_ensure_res_path(scene_path))
	else:
		var files: Array = []
		_walk("res://", files, include_addons)
		for p in files:
			if str(p).get_extension().to_lower() == "tscn":
				targets.append(p)

	var reports: Array = []
	for p in targets:
		var packed := ResourceLoader.load(p, "PackedScene", ResourceLoader.CACHE_MODE_REUSE) as PackedScene
		if packed == null:
			reports.append({&"scene_path": p, &"error": "could not load as PackedScene"})
			continue
		var st := packed.get_state()
		var count := st.get_node_count()
		var max_depth := 0
		var scripted := 0
		var instances := 0
		var type_counts: Dictionary = {}
		for i in range(count):
			var np: NodePath = st.get_node_path(i)
			var d := np.get_name_count()
			if d > max_depth:
				max_depth = d
			var t := str(st.get_node_type(i))
			if t.is_empty():
				# Empty type means the node comes from an instanced scene.
				instances += 1
			else:
				type_counts[t] = int(type_counts.get(t, 0)) + 1
			for pi in range(st.get_node_property_count(i)):
				if str(st.get_node_property_name(i, pi)) == "script":
					scripted += 1
					break

		var warnings: Array = []
		if count > 200:
			warnings.append("high node count (%d) - consider splitting into sub-scenes" % count)
		if max_depth > 8:
			warnings.append("deep nesting (%d levels) - deep trees are slow to traverse and hard to refactor" % max_depth)
		if st.get_connection_count() > 40:
			warnings.append("many signal connections (%d) - signal flow may be hard to follow" % st.get_connection_count())
		if scripted > 20:
			warnings.append("%d scripted nodes - logic is spread thin across the scene" % scripted)

		reports.append({
			&"scene_path": p,
			&"node_count": count,
			&"max_depth": max_depth,
			&"scripted_nodes": scripted,
			&"instanced_children": instances,
			&"connections": st.get_connection_count(),
			&"distinct_types": type_counts.size(),
			&"warnings": warnings,
			&"complexity_score": count + max_depth * 5 + st.get_connection_count() * 2,
		})

	# Heaviest first: the caller almost always wants the worst offenders.
	reports.sort_custom(func(a, b): return int(a.get(&"complexity_score", 0)) > int(b.get(&"complexity_score", 0)))
	var truncated := reports.size() > limit
	if truncated:
		reports = reports.slice(0, limit)

	return {
		&"ok": true,
		&"scenes": reports,
		&"scene_count": reports.size(),
		&"truncated": truncated,
		&"note": "complexity_score = node_count + max_depth*5 + connections*2 (a heuristic for ranking, not an absolute quality measure).",
	}

# =============================================================================
# analyze_signal_flow
# =============================================================================
func analyze_signal_flow(args: Dictionary) -> Dictionary:
	var scene_path: String = str(args.get(&"scene_path", ""))
	var include_addons: bool = bool(args.get(&"include_addons", false))
	var only_problems: bool = bool(args.get(&"only_problems", false))

	var targets: Array = []
	if not scene_path.strip_edges().is_empty():
		targets.append(_ensure_res_path(scene_path))
	else:
		var files: Array = []
		_walk("res://", files, include_addons)
		for p in files:
			if str(p).get_extension().to_lower() == "tscn":
				targets.append(p)

	var connections: Array = []
	var orphans: Array = []
	var emitter_counts: Dictionary = {}
	var receiver_counts: Dictionary = {}

	for p in targets:
		var packed := ResourceLoader.load(p, "PackedScene", ResourceLoader.CACHE_MODE_REUSE) as PackedScene
		if packed == null:
			continue
		var st := packed.get_state()
		# NodePath -> script source for the nodes in this scene, so a missing
		# handler can be detected without instantiating anything.
		var scripts_by_path: Dictionary = {}
		for i in range(st.get_node_count()):
			for pi in range(st.get_node_property_count(i)):
				if str(st.get_node_property_name(i, pi)) != "script":
					continue
				var v = st.get_node_property_value(i, pi)
				if v is Script:
					scripts_by_path[str(st.get_node_path(i))] = str((v as Script).resource_path)

		for c in range(st.get_connection_count()):
			var from_p := str(st.get_connection_source(c))
			var to_p := str(st.get_connection_target(c))
			var sig := str(st.get_connection_signal(c))
			var mth := str(st.get_connection_method(c))
			var entry := {
				&"scene_path": p, &"from": from_p, &"signal": sig,
				&"to": to_p, &"method": mth,
			}
			emitter_counts[from_p] = int(emitter_counts.get(from_p, 0)) + 1
			receiver_counts[to_p] = int(receiver_counts.get(to_p, 0)) + 1

			# Orphan check: the receiver has no script, or its script never
			# declares the handler. This is the silent-failure case the editor
			# only surfaces at runtime.
			var script_path: String = str(scripts_by_path.get(to_p, ""))
			if script_path.is_empty():
				entry[&"problem"] = "receiver has no script"
				orphans.append(entry)
			else:
				var src := _read_text(script_path)
				var re := RegEx.new()
				re.compile("(?m)^\\s*func\\s+" + mth + "\\s*\\(")
				if src.is_empty() or re.search(src) == null:
					entry[&"problem"] = "handler '%s' not found in %s" % [mth, script_path]
					orphans.append(entry)
			connections.append(entry)

	var result := {
		&"ok": true,
		&"scenes_scanned": targets.size(),
		&"connection_count": connections.size(),
		&"orphan_count": orphans.size(),
		&"orphans": orphans,
		&"note": "An orphan is a persisted connection whose receiver has no script or no matching `func`. Handlers inherited from a base class or provided by a C# script are not detected and may be false positives.",
	}
	if not only_problems:
		result[&"connections"] = connections
	return result

# =============================================================================
# compare_screenshots - pixel diff between two PNGs (visual regression).
# Editor-side on purpose: it reads files, so it works whether or not the game is
# running, and a baseline captured in an earlier session can be compared later.
# =============================================================================
func compare_screenshots(args: Dictionary) -> Dictionary:
	var path_a: String = _ensure_res_path(str(args.get(&"baseline", "")))
	var path_b: String = _ensure_res_path(str(args.get(&"current", "")))
	var tolerance: int = clampi(int(args.get(&"tolerance", 8)), 0, 255)
	var diff_out: String = str(args.get(&"diff_output", ""))
	var return_base64: bool = bool(args.get(&"return_base64", false))

	if path_a.strip_edges() == "res://" or path_b.strip_edges() == "res://":
		return {&"ok": false, &"error": "Both 'baseline' and 'current' are required"}

	var img_a := _load_image(path_a)
	if img_a == null:
		return {&"ok": false, &"error": "Could not load image: " + path_a}
	var img_b := _load_image(path_b)
	if img_b == null:
		return {&"ok": false, &"error": "Could not load image: " + path_b}

	if img_a.get_width() != img_b.get_width() or img_a.get_height() != img_b.get_height():
		return {
			&"ok": false,
			&"error": "Size mismatch: baseline is %dx%d, current is %dx%d. Capture both at the same window size." % [
				img_a.get_width(), img_a.get_height(), img_b.get_width(), img_b.get_height()],
		}

	# Compare on raw RGBA8 bytes rather than get_pixel(): a 1080p frame is ~2M
	# pixels and per-pixel Color churn is an order of magnitude slower.
	img_a.convert(Image.FORMAT_RGBA8)
	img_b.convert(Image.FORMAT_RGBA8)
	var da := img_a.get_data()
	var db := img_b.get_data()
	var w := img_a.get_width()
	var h := img_a.get_height()
	var total := w * h

	if da == db:
		return {
			&"ok": true, &"identical": true, &"diff_percentage": 0.0, &"changed_pixels": 0,
			&"total_pixels": total, &"width": w, &"height": h, &"tolerance": tolerance,
			&"baseline": path_a, &"current": path_b,
			&"message": "Images are byte-identical",
		}

	var changed := 0
	var min_x := w
	var min_y := h
	var max_x := -1
	var max_y := -1
	var diff_img: Image = null
	var want_diff := not diff_out.strip_edges().is_empty() or return_base64
	if want_diff:
		diff_img = Image.create(w, h, false, Image.FORMAT_RGBA8)

	for i in range(total):
		var o := i * 4
		var dr: int = absi(da[o] - db[o])
		var dg: int = absi(da[o + 1] - db[o + 1])
		var dbb: int = absi(da[o + 2] - db[o + 2])
		var dal: int = absi(da[o + 3] - db[o + 3])
		var differs := dr > tolerance or dg > tolerance or dbb > tolerance or dal > tolerance
		if differs:
			changed += 1
			var x := i % w
			var y := i / w
			if x < min_x: min_x = x
			if y < min_y: min_y = y
			if x > max_x: max_x = x
			if y > max_y: max_y = y
			if diff_img != null:
				diff_img.set_pixel(x, y, Color(1, 0, 0, 1))
		elif diff_img != null:
			# Keep unchanged areas as a dim grayscale backdrop so the red diff
			# is readable in context instead of floating on black.
			var g := float(da[o] + da[o + 1] + da[o + 2]) / (3.0 * 255.0) * 0.25
			diff_img.set_pixel(i % w, i / w, Color(g, g, g, 1))

	var pct := (float(changed) / float(total)) * 100.0
	var out := {
		&"ok": true,
		&"identical": changed == 0,
		&"diff_percentage": snappedf(pct, 0.0001),
		&"changed_pixels": changed,
		&"total_pixels": total,
		&"width": w, &"height": h,
		&"tolerance": tolerance,
		&"baseline": path_a, &"current": path_b,
	}
	if changed > 0:
		out[&"changed_region"] = {&"x": min_x, &"y": min_y, &"width": max_x - min_x + 1, &"height": max_y - min_y + 1}

	if diff_img != null and not diff_out.strip_edges().is_empty():
		var guarded := _ensure_res_path(diff_out)
		var abs_path := ProjectSettings.globalize_path(guarded)
		var base_dir := abs_path.get_base_dir()
		if not DirAccess.dir_exists_absolute(base_dir):
			DirAccess.make_dir_recursive_absolute(base_dir)
		var serr := diff_img.save_png(abs_path)
		if serr != OK:
			out[&"diff_output_error"] = "save_png failed: %d (%s)" % [serr, error_string(serr)]
		else:
			out[&"diff_output"] = guarded
			if return_base64:
				out[&"diff_base64_png"] = Marshalls.raw_to_base64(FileAccess.get_file_as_bytes(guarded))
	return out

## Load a PNG whether it lives in res:// (possibly imported) or was written to a
## path the resource system doesn't track (e.g. a screenshot cache dir).
func _load_image(path: String) -> Image:
	var img := Image.new()
	var abs_path := ProjectSettings.globalize_path(path)
	if FileAccess.file_exists(path):
		if img.load(abs_path) == OK:
			return img
	var tex := ResourceLoader.load(path, "Texture2D", ResourceLoader.CACHE_MODE_REUSE) as Texture2D
	if tex != null:
		return tex.get_image()
	return null
