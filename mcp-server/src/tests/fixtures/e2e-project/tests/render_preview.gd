extends SceneTree
## render_scene_preview has to produce a real image of a real scene, without a
## running game. Runs as -s (a SceneTree HAS frames to await), so it also proves
## the tool does not secretly need the editor.
##
## Exit 0 = pass.

var _failures: Array[String] = []

func _init() -> void:
	_run()

func _run() -> void:
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()
	root.add_child(pt)
	# add_child during _init does not put the node in the tree until the tree
	# actually steps — the tool needs a tree to render into, so wait for one.
	await process_frame
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()

	# A scene with content deliberately far from the origin: framing it is the
	# part most likely to be wrong, and a level's nodes are never at 0,0.
	var scene := "res://__render_probe.tscn"
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root",
		"nodes": [
			{"name": "Left", "type": "ColorRect", "properties": {
				"position": {"type": "Vector2", "x": 2000, "y": 1000},
				"size": {"type": "Vector2", "x": 200, "y": 100},
				"color": {"type": "Color", "r": 1, "g": 0, "b": 0, "a": 1}}},
			{"name": "Right", "type": "ColorRect", "properties": {
				"position": {"type": "Vector2", "x": 2600, "y": 1000},
				"size": {"type": "Vector2", "x": 200, "y": 100},
				"color": {"type": "Color", "r": 0, "g": 0, "b": 1, "a": 1}}},
		]})

	var out := "res://__render_probe.png"
	var r: Dictionary = await pt.render_scene_preview({"scene_path": scene, "save_to": out,
		"width": 400, "height": 300})

	if not r.get("ok", false):
		print("  render error: ", r.get("error", "<none>"))
	_expect("render reports ok", r.get("ok", false))
	_expect("the PNG exists on disk", FileAccess.file_exists(out))
	_expect("reports the size it rendered", int(r.get("width", 0)) == 400)

	# The framing has to have FOUND the content, not defaulted to the origin.
	var bounds: Dictionary = r.get("content_bounds", {})
	_expect("content bounds found the off-origin nodes", float(bounds.get("x", 0.0)) > 1000.0)
	_expect("bounds span both nodes", float(bounds.get("width", 0.0)) >= 800.0)

	# And the image must not be blank — that is the failure this would otherwise
	# hide, since a black PNG still "renders ok".
	var img := Image.load_from_file(ProjectSettings.globalize_path(out))
	var distinct := {}
	if img != null:
		for x in range(0, img.get_width(), 7):
			for y in range(0, img.get_height(), 7):
				distinct[img.get_pixel(x, y).to_rgba32()] = true
	_expect("the image has more than one colour (it is not blank)", distinct.size() > 1)

	# A missing scene must fail cleanly rather than crash.
	var bad: Dictionary = await pt.render_scene_preview({"scene_path": "res://__no_such_scene.tscn"})
	_expect("a missing scene is rejected", not bad.get("ok", true))

	DirAccess.remove_absolute(ProjectSettings.globalize_path(scene))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(out))
	st.free()

	print("=== RENDER: %d failure(s) ===" % _failures.size())
	for f in _failures:
		printerr("FAIL ", f)
	quit(1 if _failures.size() > 0 else 0)

func _expect(what: String, condition: bool) -> void:
	if condition:
		print("  ok   ", what)
	else:
		_failures.append(what)
