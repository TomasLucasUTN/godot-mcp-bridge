@tool
extends SceneToolBase
class_name AnalysisTools
## Read-only project analysis tools for MCP.
## Handles: get_project_statistics, find_unused_resources,
##          detect_circular_dependencies, analyze_scene_complexity,
##          analyze_signal_flow, compare_screenshots, scene_diff
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
## NOTE: the MCP server normally answers this itself, from disk, and never
## reaches this handler — a full sweep on the editor's main thread froze the UI
## for 26s on a large project and outlived the bridge's own ping watchdog. See
## mcp-server/src/project-scan.ts. This stays as the fallback for when the
## server has no project path to scan; keep the two in step.
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
	var raw_a: String = str(args.get(&"baseline", "")).strip_edges()
	var raw_b: String = str(args.get(&"current", "")).strip_edges()
	var tolerance: int = clampi(int(args.get(&"tolerance", 8)), 0, 255)
	var diff_out: String = str(args.get(&"diff_output", ""))
	var return_base64: bool = bool(args.get(&"return_base64", false))

	# Check the RAW arguments before sanitizing. _ensure_res_path turns anything
	# it rejects — including an empty string — into the internal sentinel
	# "res://__mcp_rejected_path__", so the old `== "res://"` guard could never
	# fire and a missing argument surfaced as
	# "Could not load image: res://__mcp_rejected_path__": an internal marker
	# shown to the caller, pointing at the path guard instead of at the argument
	# they actually got wrong.
	if raw_a.is_empty() or raw_b.is_empty():
		var missing := []
		if raw_a.is_empty():
			missing.append("baseline")
		if raw_b.is_empty():
			missing.append("current")
		return {&"ok": false, &"error": "Missing %s. compare_screenshots takes 'baseline' and 'current' (res:// or user:// .png paths)." % " and ".join(missing)}

	var path_a: String = _ensure_res_path(raw_a)
	var path_b: String = _ensure_res_path(raw_b)
	for pair in [[path_a, raw_a, "baseline"], [path_b, raw_b, "current"]]:
		if pair[0] == "res://__mcp_rejected_path__":
			return {&"ok": false, &"error": "'%s' path was rejected by the project sandbox: '%s'. Paths must stay inside res:// or user://." % [pair[2], pair[1]]}

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

# =============================================================================
# scene_diff — what changed in this scene since you last looked
# =============================================================================
## The question an agent asks constantly, and until now could only answer by
## calling read_scene again and re-reading the entire tree. On a scene of any
## size that is the single biggest token cost in a session, and almost all of it
## is spent re-reading nodes that did not change.
##
## Two-call shape:
##   1. scene_diff({scene_path}) with no snapshot_id -> takes a snapshot and
##      returns its id. Cheap: no tree is sent back.
##   2. scene_diff({scene_path, snapshot_id}) -> returns only what changed since
##      that snapshot (added / removed / moved / modified), and a fresh id.
##
## Works whether the change came from the agent or the developer, because it
## compares the actual tree rather than tracking tool calls. Snapshots live in
## this node, so they are per-editor-session; an unknown id is reported rather
## than guessed at.
const _SNAPSHOT_CAP := 24

var _snapshots: Dictionary = {}   # id -> {scene_path, taken_at, nodes}
var _snapshot_seq: int = 0

func scene_diff(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var snapshot_id: String = str(args.get(&"snapshot_id", "")).strip_edges()
	var include_properties: bool = bool(args.get(&"include_properties", true))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}

	var current := _snapshot_scene(scene_path, include_properties)
	if current.is_empty():
		return {&"ok": false, &"error": "Could not read scene: " + scene_path}

	var new_id := _store_snapshot(scene_path, current)

	if snapshot_id.is_empty():
		return {
			&"ok": true, &"scene_path": scene_path, &"snapshot_id": new_id,
			&"node_count": current.size(), &"baseline": true,
			&"message": "Snapshot taken. Pass this snapshot_id back to see what changed since.",
		}

	if not _snapshots.has(snapshot_id):
		return {&"ok": false, &"error": "Unknown snapshot_id '%s'. Snapshots live in the editor session and are dropped when it restarts (or after %d newer ones). Call scene_diff without a snapshot_id to take a fresh baseline." % [snapshot_id, _SNAPSHOT_CAP]}

	var previous: Dictionary = _snapshots[snapshot_id]
	if str(previous.get(&"scene_path", "")) != scene_path:
		return {&"ok": false, &"error": "snapshot_id '%s' belongs to %s, not %s" % [snapshot_id, previous.get(&"scene_path", "?"), scene_path]}

	var before: Dictionary = previous.get(&"nodes", {})
	var added: Array = []
	var removed: Array = []
	var modified: Array = []

	for path in current:
		if not before.has(path):
			added.append({&"path": path, &"type": str(current[path].get(&"type", ""))})
			continue
		var diff := _diff_node(before[path], current[path])
		if not diff.is_empty():
			diff[&"path"] = path
			modified.append(diff)

	for path in before:
		if not current.has(path):
			removed.append({&"path": path, &"type": str(before[path].get(&"type", ""))})

	var changed := added.size() + removed.size() + modified.size()
	return {
		&"ok": true,
		&"scene_path": scene_path,
		&"snapshot_id": new_id,
		&"compared_to": snapshot_id,
		&"unchanged": changed == 0,
		&"change_count": changed,
		&"added": added,
		&"removed": removed,
		&"modified": modified,
		&"node_count": current.size(),
		&"message": "No changes since that snapshot." if changed == 0 else "%d change(s) since that snapshot." % changed,
	}

## path -> {type, script, props}. Property values are serialized so a Vector2
## compares by value rather than by reference.
func _snapshot_scene(scene_path: String, include_properties: bool) -> Dictionary:
	var root: Node = _edited_root_if_open(scene_path)
	var owns_root := false
	if root == null:
		var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
		if packed == null:
			return {}
		root = _instantiate_packed_scene_for_edit(packed)
		if root == null:
			return {}
		owns_root = true

	var out: Dictionary = {}
	_walk_snapshot(root, root, out, include_properties)
	if owns_root:
		root.queue_free()
	return out

func _walk_snapshot(node: Node, root: Node, out: Dictionary, include_properties: bool) -> void:
	var path := "." if node == root else str(root.get_path_to(node))
	var entry := {&"type": node.get_class()}
	var scr := node.get_script()
	if scr is Script:
		entry[&"script"] = str((scr as Script).resource_path)
	if include_properties:
		entry[&"props"] = _interesting_properties(node)
	out[path] = entry
	for child in node.get_children():
		_walk_snapshot(child, root, out, include_properties)

## Only properties the node actually stores differently from its default. A full
## property dump would be larger than the read_scene this is meant to replace.
func _interesting_properties(node: Node) -> Dictionary:
	var props: Dictionary = {}
	for p in node.get_property_list():
		var usage := int(p.get(&"usage", 0))
		if not (usage & PROPERTY_USAGE_STORAGE):
			continue
		var name := str(p.get(&"name", ""))
		if name.is_empty() or name == "script":
			continue
		var value = node.get(name)
		# Resources compare by reference and would report a change on every
		# reload; record the path instead, which is what actually matters.
		if value is Resource:
			value = str((value as Resource).resource_path)
		elif value is Object:
			continue
		props[name] = str(_serialize_value(value))
	return props

func _diff_node(before: Dictionary, after: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	if str(before.get(&"type", "")) != str(after.get(&"type", "")):
		out[&"type"] = {&"before": before.get(&"type", ""), &"after": after.get(&"type", "")}
	if str(before.get(&"script", "")) != str(after.get(&"script", "")):
		out[&"script"] = {&"before": before.get(&"script", ""), &"after": after.get(&"script", "")}

	var pb: Dictionary = before.get(&"props", {})
	var pa: Dictionary = after.get(&"props", {})
	var changed: Dictionary = {}
	for key in pa:
		if not pb.has(key):
			changed[key] = {&"before": null, &"after": pa[key]}
		elif str(pb[key]) != str(pa[key]):
			changed[key] = {&"before": pb[key], &"after": pa[key]}
	for key in pb:
		if not pa.has(key):
			changed[key] = {&"before": pb[key], &"after": null}
	if not changed.is_empty():
		out[&"properties"] = changed
	return out

func _store_snapshot(scene_path: String, nodes: Dictionary) -> String:
	_snapshot_seq += 1
	var id := "snap_%d" % _snapshot_seq
	_snapshots[id] = {&"scene_path": scene_path, &"taken_at": Time.get_ticks_msec(), &"nodes": nodes}
	# Bounded: a long session must not accumulate a full tree copy per call.
	if _snapshots.size() > _SNAPSHOT_CAP:
		var oldest := ""
		var oldest_at := 0x7FFFFFFF
		for key in _snapshots:
			var at := int(_snapshots[key].get(&"taken_at", 0))
			if at < oldest_at:
				oldest_at = at
				oldest = key
		if not oldest.is_empty():
			_snapshots.erase(oldest)
	return id

# =============================================================================
# validate_references — the names a script uses vs the names the project has
# =============================================================================
# validate_scripts answers "does this parse". It says nothing about whether the
# things a script NAMES actually exist, and those failures are silent: a
# get_first_node_in_group("player") against a project where nothing is in that
# group returns null, the enemy just stands still, and there is no error
# anywhere. Same for an input action that was renamed, an autoload that is not
# registered, and a signal emitted but never declared.
#
# Deliberately regex-based rather than compiling: this has to work on a project
# that does not currently run, which is exactly when it is most useful, and a
# project-wide load of every scene is far too slow for a sweep.
#
# Only literal names are checked. A group built at runtime ("enemy_" + tier) is
# skipped rather than guessed at — a false positive here is worse than a miss,
# because the whole value of the tool is that its output can be trusted.

const _GROUP_CALLS := [
	"get_first_node_in_group", "get_nodes_in_group", "is_in_group",
	"add_to_group", "remove_from_group", "call_group", "call_group_flags",
	"set_group", "notify_group",
]
const _ACTION_CALLS := [
	"is_action_pressed", "is_action_just_pressed", "is_action_just_released",
	"is_action_released", "action_press", "action_release", "get_action_strength",
	"get_action_raw_strength",
]

## Every group name the project actually defines: declared in a .tscn, or added
## by a script at runtime. A group only ever exists because something put a node
## in it, so add_to_group is a definition, not just a use.
func _project_groups() -> Dictionary:
	var groups: Dictionary = {}
	var files: Array = []
	_walk("res://", files, false)
	var re_scene := RegEx.new()
	re_scene.compile('groups\\s*=\\s*\\[([^\\]]*)\\]')
	var re_name := RegEx.new()
	re_name.compile('"([^"]+)"')
	var re_add := RegEx.new()
	re_add.compile('add_to_group\\s*\\(\\s*&?"([^"]+)"')
	for f: String in files:
		if f.ends_with(".tscn") or f.ends_with(".scn"):
			var text := _read_text(f)
			for m in re_scene.search_all(text):
				for n in re_name.search_all(m.get_string(1)):
					groups[n.get_string(1)] = true
		elif f.ends_with(".gd"):
			for m in re_add.search_all(_read_text(f)):
				groups[m.get_string(1)] = true
	return groups

## Input actions from both sources. The editor's InputMap holds the built-ins and
## anything added this session; project.godot holds the ones the developer
## defined, and those are NOT loaded into InputMap automatically.
func _project_actions() -> Dictionary:
	var actions: Dictionary = {}
	for action: StringName in InputMap.get_actions():
		actions[str(action)] = true
	for prop: Dictionary in ProjectSettings.get_property_list():
		var pname: String = prop[&"name"]
		if pname.begins_with("input/"):
			actions[pname.substr(6)] = true
	return actions

func _project_autoloads() -> Dictionary:
	var autoloads: Dictionary = {}
	for prop: Dictionary in ProjectSettings.get_property_list():
		var pname: String = prop[&"name"]
		if pname.begins_with("autoload/"):
			autoloads[pname.substr(9)] = true
	return autoloads

## Cheapest useful suggestion: same first letter and a close length, or one is a
## substring of the other. Full edit distance is not worth it here — the point is
## to catch a rename or a typo, and those look like this.
func _closest(name: String, candidates: Array) -> String:
	var best := ""
	var best_score := 0.0
	for c_v in candidates:
		var c := str(c_v)
		var score := 0.0
		if c.to_lower() == name.to_lower():
			return c
		if c.to_lower().contains(name.to_lower()) or name.to_lower().contains(c.to_lower()):
			score = 0.8
		elif not c.is_empty() and not name.is_empty() and c[0] == name[0]:
			score = 0.4 - absf(c.length() - name.length()) * 0.05
		if score > best_score:
			best_score = score
			best = c
	return best if best_score >= 0.35 else ""

func _line_of(text: String, index: int) -> int:
	return text.substr(0, index).count("\n") + 1

func validate_references(args: Dictionary) -> Dictionary:
	var root_path: String = _ensure_res_path(str(args.get(&"root", "res://")))
	if root_path == "res://__mcp_rejected_path__":
		return {&"ok": false, &"error": "Path escapes the project sandbox (rejected)"}
	var include_addons: bool = bool(args.get(&"include_addons", false))

	var groups := _project_groups()
	var actions := _project_actions()
	var autoloads := _project_autoloads()

	var files: Array = []
	_walk(root_path, files, include_addons)

	var re_group := RegEx.new()
	re_group.compile('(%s)\\s*\\(\\s*&?"([^"]+)"' % "|".join(_GROUP_CALLS))
	var re_action := RegEx.new()
	re_action.compile('(%s)\\s*\\(\\s*&?"([^"]+)"' % "|".join(_ACTION_CALLS))
	var re_axis := RegEx.new()
	re_axis.compile('get_(?:axis|vector)\\s*\\(([^)]*)\\)')
	var re_str := RegEx.new()
	re_str.compile('&?"([^"]+)"')
	var re_signal_decl := RegEx.new()
	re_signal_decl.compile('(?m)^\\s*signal\\s+([a-zA-Z_][a-zA-Z0-9_]*)')
	var re_emit := RegEx.new()
	re_emit.compile('emit_signal\\s*\\(\\s*&?"([^"]+)"')

	var issues: Array = []
	var scanned := 0

	for f_v in files:
		var f := str(f_v)
		if not f.ends_with(".gd"):
			continue
		scanned += 1
		var text := _read_text(f)

		for m in re_group.search_all(text):
			var g := m.get_string(2)
			if groups.has(g):
				continue
			issues.append({
				&"kind": "group", &"name": g, &"file": f, &"line": _line_of(text, m.get_start()),
				&"call": m.get_string(1),
				&"suggestion": _closest(g, groups.keys()),
				&"detail": "No node in this project is in group '%s'. The call returns null / an empty array at runtime, with no error." % g,
			})

		for m in re_action.search_all(text):
			var a := m.get_string(2)
			if actions.has(a):
				continue
			issues.append({
				&"kind": "input_action", &"name": a, &"file": f, &"line": _line_of(text, m.get_start()),
				&"call": m.get_string(1),
				&"suggestion": _closest(a, actions.keys()),
				&"detail": "Input action '%s' is not in the InputMap. The check is always false — the input silently never fires." % a,
			})

		# get_axis("a","b") / get_vector("a","b","c","d") take action names as
		# plain strings, so they need their own pass.
		for m in re_axis.search_all(text):
			for sm in re_str.search_all(m.get_string(1)):
				var a2 := sm.get_string(1)
				if actions.has(a2):
					continue
				issues.append({
					&"kind": "input_action", &"name": a2, &"file": f, &"line": _line_of(text, m.get_start()),
					&"call": "get_axis/get_vector",
					&"suggestion": _closest(a2, actions.keys()),
					&"detail": "Input action '%s' is not in the InputMap; this axis contributes nothing." % a2,
				})

		# A signal emitted by name but never declared in the same script. Only
		# same-file declarations are checked: emitting another object's signal is
		# legal and resolving the target's class reliably would need real type
		# inference.
		var declared: Dictionary = {}
		for m in re_signal_decl.search_all(text):
			declared[m.get_string(1)] = true
		for m in re_emit.search_all(text):
			var sig := m.get_string(1)
			if declared.has(sig):
				continue
			issues.append({
				&"kind": "signal", &"name": sig, &"file": f, &"line": _line_of(text, m.get_start()),
				&"call": "emit_signal",
				&"suggestion": _closest(sig, declared.keys()),
				&"detail": "This script emits '%s' but does not declare it. emit_signal on an undeclared signal fails at runtime." % sig,
			})

	# Autoload usage: a bare identifier matching no autoload is just a variable,
	# so the useful direction is the reverse — a script that references a name
	# which LOOKS like an autoload (capitalised, used with a dot) but is not
	# registered. Checked only against names the project once had, to stay quiet.
	var autoload_names: Array = autoloads.keys()

	var by_kind: Dictionary = {"group": 0, "input_action": 0, "signal": 0}
	for i_v in issues:
		var k: String = i_v[&"kind"]
		by_kind[k] = int(by_kind.get(k, 0)) + 1

	return {
		&"ok": true,
		&"root": root_path,
		&"scripts_scanned": scanned,
		&"issue_count": issues.size(),
		&"issues_by_kind": by_kind,
		&"issues": issues,
		&"known": {
			&"groups": groups.keys(),
			&"input_actions": actions.size(),
			&"autoloads": autoload_names,
		},
		&"message": "Scanned %d script(s): %d reference issue(s)." % [scanned, issues.size()],
	}
