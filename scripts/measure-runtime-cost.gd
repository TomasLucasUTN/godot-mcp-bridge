extends SceneTree
## Time and size every read-only tool against a real project.
##
## Both numbers are failure modes this project has actually shipped:
##
##  - TIME is the editor freezing. @tool code runs on the editor's main thread,
##    so a slow tool blocks the UI and used to outlive the bridge's own ping
##    watchdog. get_project_statistics spent 120,685 ms per call on a
##    24,880-file project before anyone measured it.
##  - SIZE is the agent's context. map_project answered with 149,978 characters
##    — about a fifth of a 200k window — before anyone measured that either.
##
## Neither is visible from reading the code, and both grow with the project
## rather than with the change that introduced them. Run this against the
## biggest project you have.
##
##   godot --headless --path <project> --script res://measure-runtime-cost.gd
##
## Copy this file and tests/tool-contract.json (written by `npm run build`)
## into the project first. Reports a table, then the offenders.

const SLOW_MS := 1000
const BIG_CHARS := 8000

func _init() -> void:
	var contract := _load_contract()
	if contract.is_empty():
		printerr("No tool-contract.json next to this script. Run `npm run build` in mcp-server and copy it in.")
		quit(1)
		return

	var Executor = load("res://addons/godot_mcp/tool_executor.gd")
	var ex = Executor.new()
	root.add_child(ex)
	ex._init_tools()

	# One argument set for the whole sweep. Anything needing something this
	# cannot invent is reported as skipped rather than quietly missing.
	var defaults := {
		"root": "res://",
		"path": _first_script(),
		"file_path": _first_script(),
		"script_path": _first_script(),
		"scene_path": _first_scene(),
		"query": "func",
		"paths": [_first_script()],
	}

	var rows: Array = []
	var skipped: Array = []
	for entry in contract:
		var tool_name := str(entry["name"])
		if not bool(entry["read_only"]):
			continue
		if tool_name.begins_with("debug_") or tool_name.begins_with("gd_"):
			continue
		if not (ex._tool_map.has(StringName(tool_name)) or ex._tool_map.has(tool_name)):
			continue

		var args := {}
		var known := true
		for req in entry["required"]:
			if defaults.has(str(req)) and defaults[str(req)] != "":
				args[req] = defaults[str(req)]
			else:
				known = false
		if not known:
			skipped.append(tool_name)
			continue

		var t0 := Time.get_ticks_msec()
		var res = ex.execute_tool(tool_name, args)
		var ms := Time.get_ticks_msec() - t0
		rows.append({"tool": tool_name, "ms": ms, "chars": JSON.stringify(res).length()})

	rows.sort_custom(func(a, b): return a["ms"] > b["ms"])
	print("\ntool                                   ms      chars")
	print("-----------------------------------------------------")
	for row in rows:
		print("%-36s %5d %10d" % [row["tool"], row["ms"], row["chars"]])

	print("\nslower than %dms (the editor is frozen for this long):" % SLOW_MS)
	var slow := 0
	for row in rows:
		if int(row["ms"]) > SLOW_MS:
			slow += 1
			print("  %-34s %d ms" % [row["tool"], row["ms"]])
	if slow == 0:
		print("  none")

	rows.sort_custom(func(a, b): return a["chars"] > b["chars"])
	print("\nbigger than %d chars (roughly %d tokens of context per call):" % [BIG_CHARS, BIG_CHARS / 4])
	var big := 0
	for row in rows:
		if int(row["chars"]) > BIG_CHARS:
			big += 1
			print("  %-34s %d chars (~%d tokens)" % [row["tool"], row["chars"], int(row["chars"]) / 4])
	if big == 0:
		print("  none")

	print("\nmeasured %d tools, skipped %d for want of an argument: %s" % [rows.size(), skipped.size(), ", ".join(skipped)])
	quit()

func _load_contract() -> Array:
	for candidate in ["res://tool-contract.json", "res://tests/tool-contract.json"]:
		var f := FileAccess.open(candidate, FileAccess.READ)
		if f == null:
			continue
		var data = JSON.parse_string(f.get_as_text())
		f.close()
		if data is Array:
			return data
	return []

func _first_scene() -> String:
	return _first_with_extension("tscn")

func _first_script() -> String:
	return _first_with_extension("gd")

## Any real file of that type, so the sweep measures this project rather than
## an empty answer.
func _first_with_extension(ext: String, dir_path: String = "res://", depth: int = 0) -> String:
	if depth > 6:
		return ""
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return ""
	dir.list_dir_begin()
	var entry := dir.get_next()
	var subdirs: Array = []
	while entry != "":
		if not entry.begins_with("."):
			var full := dir_path.path_join(entry)
			if dir.current_is_dir():
				if entry != "addons":
					subdirs.append(full)
			elif entry.get_extension().to_lower() == ext:
				dir.list_dir_end()
				return full
		entry = dir.get_next()
	dir.list_dir_end()
	for sub in subdirs:
		var found := _first_with_extension(ext, sub, depth + 1)
		if found != "":
			return found
	return ""
