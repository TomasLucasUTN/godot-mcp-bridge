extends SceneTree
## Headless GDScript logic tests for the godot_mcp tool handlers.
##
## Run: godot --headless --path <this-project> -s res://tests/run_tests.gd
## Exit code 0 = all passed, 1 = a failure (so CI / a wrapper script can gate on it).
##
## These exercise the tool handlers' DISK path directly — no editor, no WebSocket,
## no port 6505. Without an EditorPlugin set, `_edited_root_if_open` returns null so
## the tools take the on-disk load→mutate→save path, which is exactly what needs a
## regression net (a refactor like the SceneToolBase centralization could silently
## break it and nothing else would catch it). Editor-only behaviour (live tree, undo)
## is covered separately by live testing.

var _pass := 0
var _fail := 0

func _initialize() -> void:
	print("=== godot_mcp GDScript logic tests ===")
	_test_scene_roundtrip()
	_test_scene_tool_base_inheritance()
	_test_validate_scripts()
	_test_batch_scene_edit()
	_test_create_csharp_script()
	_test_set_main_scene()
	_test_debugger_error_tree_identification()
	_test_analyze_2d_layout()
	_test_every_advertised_tool_is_dispatchable()
	_test_tools_do_not_claim_work_they_did_not_do()
	await _test_dry_run_writes_nothing()
	await _test_dry_run_on_file_writes()
	_test_runtime_batch()
	_test_failed_results_keep_their_payload()
	_test_detached_pid_bookkeeping()
	_test_path_guard_holds_against_traversal()
	_test_read_scene_subtree()
	_test_read_scene_depth()
	_test_duplicate_and_groups()
	_test_move_and_rename()
	_test_attach_detach_script()
	_test_instance_scene()
	_test_arg_coercion()
	_test_file_ops()
	_test_wire_signal()
	_test_generate_onready_refs()
	_test_collision_by_name()
	_test_scaffold_entity()
	_test_scaffold_state_machine()
	_test_analysis_tools()
	_test_compare_screenshots()
	_test_activity_digest()
	_test_sync_localization()
	_test_netcode_scaffolding()
	_test_csharp_status()
	_test_port_resolution()
	_test_validate_addon_scripts()
	_test_validate_script_sees_project_context()
	_test_properties_apply_after_script_attaches()
	_test_set_node_reference()
	_test_validate_scripts_sweep()
	_test_property_readback_reports_clamping()
	_test_tilemap_cells()
	_test_animation_authoring()
	_test_script_rewrites()
	_test_project_config()
	_test_bulk_and_rename()
	_test_3d_authoring()
	_test_physics_presets()
	_test_particles_and_audio()
	_test_theme_and_shader_resources()
	_test_state_machine_authoring()
	_test_navigation_authoring()
	_test_tilemap_bulk()
	_test_input_map_and_autoloads()
	_test_property_forwarder()
	_test_mp_diagnose()
	_test_particle_material_and_gradient()
	_test_theme_constant_and_stylebox()
	_test_audio_bus()
	_test_gridmap_and_node_property()
	_test_save_resource_to_file()
	_test_generate_2d_asset()
	_test_scene_diff()
	_test_tilemap_terrain_and_autotile()
	_test_bake_navigation_mesh()
	_test_export_and_peer_contracts()
	_test_every_tool_node_gets_the_plugin()
	_test_debugger_watch_is_passive()
	_test_coroutine_tools_are_registered()
	_test_debugger_error_severity_is_language_independent()
	_test_deterministic_runtime_tools()
	_test_unknown_tool_error_is_cheap()
	_test_instanced_child_keeps_its_script()
	_test_integrity_flags_an_instance_that_lost_its_script()
	_test_node_not_found_suggests_real_paths()
	_test_resource_paths_load_on_every_entry_point()
	_test_collision_sits_on_the_origin()
	_test_numeric_value_match()
	_test_shape_type_error()
	_test_read_scene_properties()
	_test_validate_references()
	_test_collision_reuse_and_track_order()
	_test_sprite_animation()
	_test_skeleton_tools()
	_test_mp_authority()
	_test_root_name_resolves_as_root()
	_test_shape_and_vector_forms()
	_test_missing_path_is_not_an_escape()
	_test_dimension_follows_the_parent()
	_test_navigation_info_points_somewhere()
	_test_validate_meshes_names_what_it_dropped()
	_test_search_skips_addons()
	_test_input_map_round_trips()
	_test_export_log_is_readable()
	_test_map_counts_only_drawable_edges()
	print("\n=== RESULT: %d passed, %d failed ===" % [_pass, _fail])
	quit(1 if _fail > 0 else 0)

func _check(cond: bool, msg: String) -> void:
	if cond:
		_pass += 1
		print("  ok   ", msg)
	else:
		_fail += 1
		printerr("  FAIL ", msg)

func _write_text(res_path: String, contents: String) -> void:
	var f := FileAccess.open(res_path, FileAccess.WRITE)
	f.store_string(contents)
	f.close()

func _rm(res_path: String) -> void:
	var abs := ProjectSettings.globalize_path(res_path)
	if FileAccess.file_exists(res_path):
		DirAccess.remove_absolute(abs)

# create_scene → add_node → set_node_properties → remove_node, all on disk.
func _test_scene_roundtrip() -> void:
	print("\n[scene mutation round-trip]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_scene.tscn"
	_rm(scene)

	var cr = st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	_check(cr.get("ok", false), "create_scene returns ok")
	_check(FileAccess.file_exists(scene), "scene file written to disk")

	var ar = st.add_node({"scene_path": scene, "node_name": "Foo", "node_type": "Sprite2D", "parent_path": "."})
	_check(ar.get("ok", false), "add_node returns ok")
	_check(not ar.get("live_editor_scene", false), "add_node took the disk path (no editor plugin)")

	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("Foo") and txt.contains("Sprite2D"), "scene file contains the added node")

	var pr = st.set_node_properties({"scene_path": scene, "node_path": "Foo", "properties": {"position": {"x": 10, "y": 20}}})
	_check(pr.get("ok", false), "set_node_properties returns ok")

	var rr = st.remove_node({"scene_path": scene, "node_path": "Foo"})
	_check(rr.get("ok", false), "remove_node returns ok")
	txt = FileAccess.get_file_as_string(scene)
	_check(not txt.contains("Foo"), "node gone from scene file after remove")

	_rm(scene)
	st.free()

# A non-scene_tools file (PhysicsTools) must inherit the scene helpers from
# SceneToolBase and run its Phase-2 disk path (add_raycast via _acquire_scene /
# _finish_scene_edit). This is the direct regression net for today's refactor.
func _test_scene_tool_base_inheritance() -> void:
	print("\n[SceneToolBase inheritance — physics on disk]")
	var scene := "res://__gdtest_phys.tscn"
	_rm(scene)
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.free()

	var ph = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var rr = ph.add_raycast({"scene_path": scene, "parent_path": ".", "node_name": "Ray", "dimension": "2D"})
	_check(rr.get("ok", false), "physics.add_raycast ok (inherited _acquire_scene/_finish_scene_edit)")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("RayCast2D"), "raycast persisted to the scene file")
	ph.free()
	_rm(scene)

# validate_script must accept a script that declares class_name (the collision
# false-positive fix) and reject one with a real syntax error.
func _test_validate_scripts() -> void:
	print("\n[validate_script]")
	var scr = preload("res://addons/godot_mcp/tools/script_tools.gd").new()

	var good := "res://__gdtest_good.gd"
	var f := FileAccess.open(good, FileAccess.WRITE)
	f.store_string("extends Node\nclass_name GdTestGoodClass\n\nfunc foo() -> int:\n\treturn 1\n")
	f.close()
	var vg = scr.validate_script({"path": good})
	_check(vg.get("valid", false), "class_name script validates as valid (class_name strip)")

	var bad := "res://__gdtest_bad.gd"
	f = FileAccess.open(bad, FileAccess.WRITE)
	f.store_string("extends Node\nfunc bad():\n\tvar x = = 5\n")
	f.close()
	var vb = scr.validate_script({"path": bad})
	_check(not vb.get("valid", true), "broken script validates as invalid")

	_rm(good)
	_rm(bad)

	# validate_eval_snippet: the same compile, but for a game_eval snippet, and
	# done HERE so the running game never sees code that does not parse (a parse
	# error in the game breaks the attached debugger and freezes it).
	var ok_snip = scr.validate_eval_snippet({"code": "return 1 + 1"})
	_check(ok_snip.get("valid", false), "a compiling snippet validates")
	var bad_snip = scr.validate_eval_snippet({"code": "var x = = 5"})
	_check(not bad_snip.get("valid", true), "a broken snippet is rejected")
	_check(bad_snip.get("error_code", 0) != 0, "and reports the compile error code")
	# The snippet is a function BODY, so a bare statement must compile without
	# the caller having to indent it — the wrapper does that.
	_check(scr.validate_eval_snippet({"code": "var v = 2\nreturn v"}).get("valid", false),
		"a multi-line body compiles unindented")
	_check(not scr.validate_eval_snippet({"code": ""}).get("ok", true), "empty code is an error")
	# The throwaway compile must not leave a script behind in the project.
	_check(not FileAccess.file_exists("res://addons/godot_mcp/__mcp_snippet_1.gd"),
		"validation leaves no script behind")

	scr.free()

# batch_scene_edit applies N ops with one load + one save, and stop_on_error
# discards the whole batch (nothing persisted).
func _test_batch_scene_edit() -> void:
	print("\n[batch_scene_edit]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_batch.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})

	var r = st.batch_scene_edit({"scene_path": scene, "operations": [
		{"op": "add_node", "node_name": "A", "node_type": "Node2D", "parent_path": "."},
		{"op": "add_node", "node_name": "B", "node_type": "Sprite2D", "parent_path": "A"},
		{"op": "set_properties", "node_path": "A", "properties": {"position": {"x": 5, "y": 5}}},
	]})
	_check(r.get("ok", false), "batch_scene_edit returns ok")
	_check(int(r.get("applied", 0)) == 3, "all 3 ops applied")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("\"A\"") and txt.contains("\"B\""), "both added nodes persisted in one save")

	var r2 = st.batch_scene_edit({"scene_path": scene, "operations": [
		{"op": "rename_node", "node_path": "A", "new_name": "Renamed"},
		{"op": "remove_node", "node_path": "Renamed/B"},
	]})
	_check(r2.get("ok", false), "second batch (rename + remove) ok")
	txt = FileAccess.get_file_as_string(scene)
	_check(txt.contains("Renamed") and not txt.contains("\"B\""), "rename applied and B removed")

	var r3 = st.batch_scene_edit({"scene_path": scene, "operations": [
		{"op": "add_node", "node_name": "ShouldNotPersist", "node_type": "Node2D", "parent_path": "."},
		{"op": "remove_node", "node_path": "DoesNotExist"},
	], "stop_on_error": true})
	_check(not r3.get("ok", true), "batch with a failing op returns not-ok")
	txt = FileAccess.get_file_as_string(scene)
	_check(not txt.contains("ShouldNotPersist"), "stop_on_error discarded the partial batch (nothing saved)")

	_rm(scene)
	st.free()

# create_csharp_script writes a valid Godot C# partial-class template.
func _test_create_csharp_script() -> void:
	print("\n[create_csharp_script]")
	var ft = preload("res://addons/godot_mcp/tools/file_tools.gd").new()
	var path := "res://__gdtest_cs.cs"
	_rm(path)
	var r = ft.create_csharp_script({"path": path, "class_name": "PlayerController", "base_type": "CharacterBody2D"})
	_check(r.get("ok", false), "create_csharp_script returns ok")
	_check(str(r.get("class_name", "")) == "PlayerController", "class name preserved")
	var txt := FileAccess.get_file_as_string(path)
	_check(txt.contains("using Godot;"), "has 'using Godot;'")
	_check(txt.contains("public partial class PlayerController : CharacterBody2D"), "correct class + base type")
	_check(txt.contains("public override void _Ready()"), "has _Ready override")
	var bad = ft.create_csharp_script({"path": "res://__gdtest_bad_cs.cs", "base_type": "NotARealGodotClass"})
	_check(not bad.get("ok", true), "invalid base_type rejected")
	_rm(path)
	_rm("res://__gdtest_bad_cs.cs")
	ft.free()

# set_main_scene validates the scene exists + is a .tscn, then writes the setting.
func _test_set_main_scene() -> void:
	print("\n[set_main_scene]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()
	_check(not pt.set_main_scene({"scene_path": "res://__does_not_exist.tscn"}).get("ok", true), "rejects a non-existent scene")
	_check(not pt.set_main_scene({"scene_path": "res://project.godot"}).get("ok", true), "rejects a non-.tscn path")

	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_main.tscn"
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.free()
	var original := str(ProjectSettings.get_setting("application/run/main_scene", ""))
	var r = pt.set_main_scene({"scene_path": scene})
	_check(r.get("ok", false), "set_main_scene ok for a real .tscn")
	_check(str(ProjectSettings.get_setting("application/run/main_scene", "")) == scene, "main_scene setting applied")

	# restore so the fixture's project.godot is left as it was
	ProjectSettings.set_setting("application/run/main_scene", original)
	ProjectSettings.save()
	_rm(scene)
	pt.free()

# A preview that writes is not a preview. dry_run is honoured centrally in
# SceneToolBase rather than in each tool, so this checks the guarantee where it
# actually matters: the file's bytes.
#
# The last case is the one that makes the rest mean anything — the same tool
# without dry_run MUST change the hash. A test that cannot detect a write would
# pass just as happily against a save path that was silently broken.
func _test_dry_run_writes_nothing() -> void:
	print("
[dry run]")
	var scene := "res://__gdtest_dryrun.tscn"
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	root.add_child(st)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Child", "node_type": "Node2D", "parent_path": "."})

	# preload, not load: by this point in the run other tests have driven the
	# resource cache hard enough that a runtime load of this script has come
	# back as an uninstantiable GDScript. preload resolves at parse time.
	var ex = preload("res://addons/godot_mcp/tool_executor.gd").new()
	root.add_child(ex)
	ex._init_tools()

	var before := FileAccess.get_md5(scene)
	_check(before != "", "the scene to preview against exists")

	var cases := [
		["add_node", {"scene_path": scene, "node_name": "Ghost", "node_type": "Sprite2D", "parent_path": "."}],
		["remove_node", {"scene_path": scene, "node_path": "Child"}],
		["rename_node", {"scene_path": scene, "node_path": "Child", "new_name": "Renamed"}],
		["duplicate_node", {"scene_path": scene, "node_path": "Child"}],
		["modify_node_property", {"scene_path": scene, "node_path": "Child", "property_name": "position", "value": {"type": "Vector2", "x": 99, "y": 99}}],
		["set_node_properties", {"scene_path": scene, "node_path": "Child", "properties": {"visible": false}}],
		["set_node_groups", {"scene_path": scene, "node_path": "Child", "groups": ["ghosts"]}],
	]

	for case in cases:
		var name: String = str(case[0])
		# Rebuild the scene per case: these are real edits, and remove_node
		# would otherwise delete the node the next case needs.
		_rm(scene)
		st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
		st.add_node({"scene_path": scene, "node_name": "Child", "node_type": "Node2D", "parent_path": "."})

		var args: Dictionary = (case[1] as Dictionary).duplicate(true)
		args["dry_run"] = true
		var hash_before := FileAccess.get_md5(scene)
		var preview = await ex.execute_tool(name, args)
		_check(FileAccess.get_md5(scene) == hash_before, "%s dry run leaves the file byte-for-byte unchanged" % name)
		_check(preview.get("ok", false), "%s dry run answers ok" % name)
		_check(preview.get("dry_run", false) == true, "%s dry run says so" % name)
		_check(preview.get("written", true) == false, "%s dry run reports nothing written" % name)

		# And the same call for real still works, so the preview did not just
		# fail its way to leaving the file alone.
		var real = await ex.execute_tool(name, (case[1] as Dictionary).duplicate(true))
		_check(real.get("ok", false), "%s still applies when not previewing" % name)

	# Every preview above ran against a file that keeps changing (the non-preview
	# calls are real edits), so compare a preview against the hash right before
	# it rather than against the start.
	var settled := FileAccess.get_md5(scene)
	var preview_only = await ex.execute_tool("add_node", {"scene_path": scene, "node_name": "NeverWritten", "node_type": "Node2D", "parent_path": ".", "dry_run": true})
	_check(preview_only.get("ok", false), "a preview on a settled file answers ok")
	_check(FileAccess.get_md5(scene) == settled, "and the scene file is byte-for-byte unchanged")

	# The control: the identical call without dry_run must change the file, or
	# this whole test proves nothing.
	await ex.execute_tool("add_node", {"scene_path": scene, "node_name": "NeverWritten", "node_type": "Node2D", "parent_path": "."})
	_check(FileAccess.get_md5(scene) != settled, "the same call without dry_run does change it")

	ex.queue_free()
	st.free()
	_rm(scene)

# run_scene(attach_debugger=false) runs the game as its own process, which the
# editor knows nothing about: it is not "playing", so stop_scene has to end it
# by pid or it outlives the session in the background. The process spawning
# itself is not testable headlessly; the bookkeeping that leaks a game if it is
# wrong is.
func _test_detached_pid_bookkeeping() -> void:
	print("
[detached pid]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()
	root.add_child(pt)

	_check(pt._detached_pid == -1, "no detached game is tracked to begin with")

	# A pid that is certainly not running: stop_scene must report it and, above
	# all, forget it. Leaving it set would make the next run_scene refuse with
	# "a detached game is already running" forever.
	pt._detached_pid = 999999
	var res = pt.stop_scene({})
	_check(res.get("ok", false), "stop_scene answers ok for a game that already exited")
	_check(res.get("detached", false) == true, "and says it was the detached one")
	_check(pt._detached_pid == -1, "and stops tracking it, so the next launch is not blocked")

	pt.free()

# PathGuard is the only thing between a tool argument and the user's disk, and
# every filesystem tool in this addon routes through it. The failure mode is
# silent: a weakened guard does not throw, it just starts returning ok for a
# path that resolves somewhere it should not.
#
# So this asserts the property rather than the messages: whatever comes back
# ok must globalize to somewhere inside the project or user://. 26 inputs,
# run 2026-09-03, zero escapes.
func _test_path_guard_holds_against_traversal() -> void:
	print("
[path guard]")
	var PG = load("res://addons/godot_mcp/utils/path_guard.gd")
	var project_abs := ProjectSettings.globalize_path("res://").simplify_path()
	var user_abs := ProjectSettings.globalize_path("user://").simplify_path()
	var bs := char(92)

	var must_reject := [
		"res://../../../Windows/System32/drivers/etc/hosts",
		"res://..",
		"res://../",
		"res://a/../../b",
		"res://a/../..",
		"res://./../secret.txt",
		"../outside.txt",
		".." + bs + "outside.txt",
		"res://a//../../b",
		"res://a/./../../b",
		"res://....//....//x",
		"res://sub/../../../..",
		"   res://../x   ",
		"res://a/b/../../../c",
		"res://" + bs + ".." + bs + "x",
		"",
	]
	var rejected := 0
	for path in must_reject:
		if not PG.sanitize(path).get("ok", false):
			rejected += 1
	_check(rejected == must_reject.size(), "every traversal attempt is refused (%d/%d)" % [rejected, must_reject.size()])

	# These are accepted, and must be: they are odd but they land inside the
	# project. What matters is where they RESOLVE, not how strange they look —
	# an absolute Windows path becomes a nonsense filename under res://, not a
	# door out.
	var accepted_but_contained := [
		"res://foo/..%2f..%2fbar",
		"res://foo/%2e%2e/%2e%2e/bar",
		"res:/../x",
		"res:" + bs + ".." + bs + "x",
		"user://../../etc/passwd",
		"C:/Windows/System32/config",
		"C:" + bs + "Windows" + bs + "System32",
		bs + bs + "server" + bs + "share",
		"//server/share/x",
		"/etc/passwd",
		"file:///C:/Windows/x",
	]
	var escaped: Array = []
	for path in accepted_but_contained:
		var r = PG.sanitize(path)
		if not r.get("ok", false):
			continue
		var abs := ProjectSettings.globalize_path(str(r["path"])).simplify_path()
		if not (abs.begins_with(project_abs) or abs.begins_with(user_abs)):
			escaped.append("%s -> %s" % [path, abs])
	_check(escaped.is_empty(), "nothing accepted resolves outside the sandbox: %s" % str(escaped))

	# URL encoding is deliberately NOT decoded: decoding it would turn %2e%2e
	# back into "..", which is the traversal this guard exists to stop.
	var enc = PG.sanitize("res://foo/%2e%2e/bar")
	_check(enc.get("ok", false) and "%2e%2e" in str(enc.get("path", "")), "percent-encoding is left as a literal name, not decoded into ..")

# read_scene could only start at the root, so "what is under Player?" cost the
# whole scene. max_depth cuts a big tree off at the top; node_path starts lower.
func _test_read_scene_subtree() -> void:
	print("
[read_scene subtree]")
	var scene := "res://__gdtest_subtree.tscn"
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	root.add_child(st)

	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Player", "node_type": "Node2D", "parent_path": "."})
	st.add_node({"scene_path": scene, "node_name": "Sprite", "node_type": "Sprite2D", "parent_path": "Player"})
	st.add_node({"scene_path": scene, "node_name": "Elsewhere", "node_type": "Node2D", "parent_path": "."})

	var whole = st.read_scene({"scene_path": scene})
	var whole_json := JSON.stringify(whole)
	_check(whole.get("ok", false) and "Elsewhere" in whole_json, "a full read still sees the whole scene")
	_check(not whole.has("read_from"), "and does not claim to have read a branch")

	var branch = st.read_scene({"scene_path": scene, "node_path": "Player"})
	var branch_json := JSON.stringify(branch)
	_check(branch.get("ok", false), "reading a branch answers ok")
	_check(str(branch.get("read_from", "")) == "Player", "and says which branch it read")
	_check("Sprite" in branch_json, "the branch contains its own child")
	_check(not ("Elsewhere" in branch_json), "and nothing from the rest of the scene")
	_check(branch_json.length() < whole_json.length(), "which is the point: %d chars vs %d" % [branch_json.length(), whole_json.length()])

	var missing = st.read_scene({"scene_path": scene, "node_path": "Playr"})
	_check(not missing.get("ok", true), "a wrong branch path is refused")
	_check("Player" in str(missing.get("error", "")), "with the near-miss named")

	st.free()
	_rm(scene)

# The scene tools preview through SceneToolBase. These write FILES — the more
# irreversible half of the surface, and the half that had no preview at all.
# Same proof as the scene one: the bytes must not move, and the control case
# (the same call without dry_run) must move them.
func _test_dry_run_on_file_writes() -> void:
	print("
[dry run: files]")
	var ex = preload("res://addons/godot_mcp/tool_executor.gd").new()
	root.add_child(ex)
	ex._init_tools()

	var path := "res://__gdtest_dryrun.gd"
	_write_text(path, "extends Node

func _ready():
	print(\"before\")
")
	var before := FileAccess.get_md5(path)

	var edit_args := {"edit": {"file": path, "type": "snippet_replace",
		"old_snippet": "print(\"before\")", "new_snippet": "print(\"after\")"}}
	var preview = await ex.execute_tool("edit_script", edit_args.duplicate(true))
	_check(preview.get("ok", false), "edit_script previews ok")
	_check(FileAccess.get_md5(path) != before, "control: a real edit does change the file")

	# Back to a known state, then preview.
	_write_text(path, "extends Node

func _ready():
	print(\"before\")
")
	var settled := FileAccess.get_md5(path)
	var dry_args := edit_args.duplicate(true)
	dry_args["dry_run"] = true
	var dry = await ex.execute_tool("edit_script", dry_args)
	_check(dry.get("ok", false), "edit_script dry run answers ok")
	_check(dry.get("written", true) == false, "and reports nothing written")
	_check(FileAccess.get_md5(path) == settled, "and the file is byte-for-byte unchanged")
	_check("Would apply" in str(dry.get("message", "")), "and does not claim it applied the edit")

	# rename: the file must still be where it was.
	var moved := "res://__gdtest_dryrun_moved.gd"
	var rename_preview = await ex.execute_tool("rename_file", {"old_path": path, "new_path": moved, "dry_run": true})
	_check(rename_preview.get("ok", false), "rename_file dry run answers ok")
	_check(FileAccess.file_exists(path) and not FileAccess.file_exists(moved), "and nothing moved")

	# delete: the file must survive.
	var delete_preview = await ex.execute_tool("delete_file", {"path": path, "confirm": true, "dry_run": true})
	_check(delete_preview.get("ok", false), "delete_file dry run answers ok")
	_check(FileAccess.file_exists(path), "and the file is still there")

	# create: nothing appears.
	var fresh := "res://__gdtest_dryrun_new.gd"
	var create_preview = await ex.execute_tool("create_script", {"path": fresh, "content": "extends Node
"})
	_check(create_preview.get("ok", false), "control: create_script really creates")
	_check(FileAccess.file_exists(fresh), "and the file exists")
	_rm(fresh)
	var create_dry = await ex.execute_tool("create_script", {"path": fresh, "content": "extends Node
", "dry_run": true})
	_check(create_dry.get("ok", false), "create_script dry run answers ok")
	_check(not FileAccess.file_exists(fresh), "and no file appears")

	ex.queue_free()
	_rm(path)
	_rm(moved)
	_rm(fresh)

# batch_runtime runs several runtime tools in one round trip. Driving a game is
# press-look-press-look and each call is a WebSocket round trip while the game
# keeps running underneath; measured on a live game, six calls went from 43ms
# one at a time to 6ms batched.
#
# The part that needs a test is what it REFUSES. Half the runtime surface
# answers later through job queues, and one request id cannot fan out into
# several deferred answers — running those inside a batch would return "ok"
# for work that had not happened.
func _test_runtime_batch() -> void:
	print("
[batch_runtime]")
	var rt = preload("res://addons/godot_mcp/runtime/mcp_runtime.gd").new()
	# Not added to the tree: _ready() would open a WebSocket, and none of what
	# is checked here needs one.

	var empty = rt._batch_runtime({})
	_check(not empty.get("ok", true), "an empty batch is refused")

	var too_many: Array = []
	for i in range(51):
		too_many.append({"tool": "seed_rng", "args": {"seed": i}})
	_check(not rt._batch_runtime({"operations": too_many}).get("ok", true), "and so is one over the cap")

	# Every async tool by name, because forgetting one is how a caller gets a
	# silent lie rather than an error.
	for tool_name in ["step_frames", "await_condition", "await_signal_runtime",
			"monitor_properties", "replay_input_sequence", "wait"]:
		var r = rt._batch_runtime({"operations": [{"tool": tool_name, "args": {}}]})
		var first: Dictionary = (r.get("results", []) as Array)[0]
		_check(not first.get("ok", true), "%s is refused inside a batch" % tool_name)
		_check("cannot be batched" in str(first.get("error", "")), "and says why, by name")

	var nested = rt._batch_runtime({"operations": [{"tool": "batch_runtime", "args": {"operations": []}}]})
	_check("cannot be nested" in str(((nested.get("results", []) as Array)[0] as Dictionary).get("error", "")), "a batch cannot nest")

	# Order and positional results: three ops in, three results out, in order.
	var ran = rt._batch_runtime({"operations": [
		{"tool": "seed_rng", "args": {"seed": 1}},
		{"tool": "definitely_not_a_tool", "args": {}},
		{"tool": "seed_rng", "args": {"seed": 2}},
	]})
	_check(int(ran.get("count", 0)) == 3, "every operation gets a result")
	_check(not ran.get("all_ok", true), "and one failure makes the batch not ok")
	var results: Array = ran.get("results", [])
	_check((results[0] as Dictionary).get("ok", false), "the first succeeded")
	_check(not (results[1] as Dictionary).get("ok", true), "the second is the one that failed")
	_check((results[2] as Dictionary).get("ok", false), "and it kept going")

	var stopped = rt._batch_runtime({"operations": [
		{"tool": "definitely_not_a_tool", "args": {}},
		{"tool": "seed_rng", "args": {"seed": 3}},
	], "stop_on_error": true})
	_check(int(stopped.get("count", 0)) == 1, "stop_on_error stops at the first failure")
	_check(int(stopped.get("requested", 0)) == 2, "and still says how many were asked for")

	rt.free()

# A failing tool says more than its error string, and the runtime side threw
# all of it away: it sent `result: null` on failure, so the caller got a bare
# "Tool execution failed". The editor side has always sent the payload.
#
# It matters most for the async jobs, which carry the work they DID manage —
# monitor_properties reports the samples it collected before the node was
# freed — and for a batch, where the payload is the only thing that says which
# operation broke.
func _test_failed_results_keep_their_payload() -> void:
	print("
[failure payloads]")
	var src := FileAccess.get_file_as_string("res://addons/godot_mcp/runtime/mcp_runtime.gd")
	_check(not src.is_empty(), "read the runtime handler")
	_check(not ("if success else null" in src),
		"neither result path drops the payload when a tool fails")
	# Both senders must pass it through, not just one of them.
	_check(src.count("\"result\": result,") >= 1, "the synchronous path sends it")
	_check(src.count("\"result\": payload,") >= 1, "and so does the async one")

# The contract the TypeScript side declares, written by
# scripts/export-tool-contract.mjs at build time. It is the join between the two
# halves of this project: the registry test only sees the schemas, this suite
# only sees the Godot handlers, and a tool is dark unless BOTH exist.
func _load_tool_contract() -> Array:
	var f := FileAccess.open("res://tests/tool-contract.json", FileAccess.READ)
	if f == null:
		return []
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	return data if data is Array else []

# Every advertised tool must be dispatchable somewhere. CLAUDE.md's "wired in
# three places" rule was enforced by remembering it; a tool that gets a schema
# and no dispatch entry answers "Unknown tool" to a user and nothing to the test
# suite.
#
# Three homes, and the check knows all three because writing it found the second
# one the hard way: the editor's tool_executor map, the in-game MCPRuntime
# autoload (every runtime tool lives there and has no editor entry), and the
# server itself for debug_* / gd_*, which are answered over DAP and LSP and
# deliberately have no GDScript handler at all.
func _test_every_advertised_tool_is_dispatchable() -> void:
	print("
[tool wiring]")
	var contract := _load_tool_contract()
	if contract.is_empty():
		_check(false, "tool-contract.json is present (run `npm run build` in mcp-server)")
		return

	var Executor = load("res://addons/godot_mcp/tool_executor.gd")
	var ex = Executor.new()
	root.add_child(ex)
	ex._init_tools()

	# The runtime handler dispatches from a match on the tool name, so its source
	# is the list. Read as text rather than instantiated: MCPRuntime is an
	# autoload that opens a WebSocket, which a test has no business starting.
	var runtime_src := ""
	var rf := FileAccess.open("res://addons/godot_mcp/runtime/mcp_runtime.gd", FileAccess.READ)
	if rf != null:
		runtime_src = rf.get_as_text()
		rf.close()
	_check(not runtime_src.is_empty(), "found the runtime handler to check against")

	var executor_src := ""
	var ef := FileAccess.open("res://addons/godot_mcp/tool_executor.gd", FileAccess.READ)
	if ef != null:
		executor_src = ef.get_as_text()
		ef.close()

	var undispatchable: Array = []
	for entry in contract:
		var tool_name := str(entry["name"])
		if tool_name.begins_with("debug_") or tool_name.begins_with("gd_"):
			continue
		if ex._tool_map.has(StringName(tool_name)) or ex._tool_map.has(tool_name):
			continue
		if runtime_src.contains('"%s"' % tool_name):
			continue
		# A few tools are special-cased inside execute_tool before the map is
		# consulted, because they dispatch OTHER tools (batch_execute) and would
		# recurse through it. Handled, just not via the map.
		if executor_src.contains('"%s"' % tool_name):
			continue
		undispatchable.append(tool_name)

	_check(contract.size() > 200, "read the contract for %d tools" % contract.size())
	_check(undispatchable.is_empty(), "every advertised tool has a dispatch entry: %s" % str(undispatchable))

	# The other direction: something dispatchable that no schema advertises is
	# unreachable through MCP. One is deliberate — the visualizer edits node
	# properties inline through its own channel, not as a tool — and naming it
	# here is what keeps the next one from hiding behind it.
	var advertised := {}
	for entry in contract:
		advertised[str(entry["name"])] = true
	# Deliberately internal, each for a reason recorded in
	# mcp-server/src/tests/tool-registry.test.ts (INTENTIONALLY_INTERNAL); that
	# list is the source of truth and this mirrors it. Writing this check found
	# that two of them were recommended BY NAME in the guides, so an agent
	# following the documentation got "Unknown tool" — the guides were what was
	# wrong, not the decision to keep the tools internal.
	var internal_only := {
		"set_scene_node_property": "visualizer inline editing",
		"get_scene_hierarchy": "superseded by read_scene / scene_tree_dump",
		"get_scene_node_properties": "superseded by read_scene; ignores its filter and dumps ~8k tokens",
		"map_scenes": "backs the visualizer; map_project is the tool",
		"validate_eval_snippet": "the server's own pre-check for game_eval",
	}
	var unadvertised: Array = []
	for tool_name in ex._tool_map.keys():
		var name := str(tool_name)
		if advertised.has(name) or internal_only.has(name):
			continue
		unadvertised.append(name)
	_check(unadvertised.is_empty(), "nothing is dispatchable but unreachable: %s" % str(unadvertised))
	ex.queue_free()

# Point every MUTATING tool at a scene that cannot exist, and check it admits
# the work did not happen.
#
# "ok" for work that never occurred is the worst failure this surface can have:
# the agent believes it, moves on, and the wrongness turns up later somewhere
# unrelated. This project has shipped that bug before ("Stop the tools
# reporting success for work they did not do"), which is why it is a sweep now
# rather than a habit.
#
# A unique ghost path per tool matters: the first version of this reused one
# path, the first tool in the list CREATED it, and every tool after that was
# legitimately editing a real scene — three of them looked like bugs and were
# not.
func _test_tools_do_not_claim_work_they_did_not_do() -> void:
	print("
[no false success]")
	var contract := _load_tool_contract()
	if contract.is_empty():
		return

	var Executor = load("res://addons/godot_mcp/tool_executor.gd")
	var ex = Executor.new()
	root.add_child(ex)
	ex._init_tools()

	# Tools whose job is to CREATE the thing, so a path that does not exist yet
	# is the normal case rather than a failure.
	var creators := ["create_scene", "scaffold_entity", "scaffold_state_machine",
		"create_script", "create_csharp_script", "create_folder", "create_resource",
		"mp_scaffold_lobby"]

	var liars: Array = []
	var checked := 0
	var i := 0
	for entry in contract:
		i += 1
		var tool_name := str(entry["name"])
		if bool(entry["read_only"]) or tool_name in creators:
			continue
		var required: Array = entry["required"]
		if not ("scene_path" in required or "node_path" in required):
			continue
		if not (ex._tool_map.has(StringName(tool_name)) or ex._tool_map.has(tool_name)):
			continue

		var args := {"scene_path": "res://__ghost_%d.tscn" % i, "node_path": "NoSuchNode/Deeper"}
		for r in required:
			if args.has(r):
				continue
			match str(r):
				"path", "file_path", "script_path": args[r] = "res://__nope.gd"
				"property", "property_path": args[r] = "position"
				"value": args[r] = 0
				"type", "node_type": args[r] = "Node2D"
				"signal", "signal_name": args[r] = "pressed"
				_: args[r] = "probe"

		var res = ex.execute_tool(tool_name, args)
		if not (res is Dictionary):
			continue
		checked += 1
		if res.get("ok", res.get(&"ok", null)) == true:
			liars.append("%s -> %s" % [tool_name, JSON.stringify(res).substr(0, 90)])

	_check(checked > 50, "swept a meaningful number of mutating tools (%d)" % checked)
	_check(liars.is_empty(), "no mutating tool reports ok for a scene that does not exist: %s" % str(liars))
	ex.queue_free()

# analyze_2d_layout answers geometry questions that cost a whole session by hand:
# decoration hanging in the air, decoration standing over a hole, decoration
# fused into a platform, and how wide the floor gaps are. Built with exact
# numbers so each verdict can be checked against the arithmetic rather than
# eyeballed.
#
#   floor A  x 0..200   top y=100      floor B  x 300..400  top y=100
#   platform x 120..180 top y=46
#   grounded  x 10..42   base y=100  (resting)
#   floating  x 50..82   base y=92   (8px of air)
#   over gap  x 230..262 base y=100  (nothing under it)
#   fused     x 130..162 y 30..62    (runs 32x8 into the platform)
func _test_analyze_2d_layout() -> void:
	print("\n[analyze_2d_layout]")
	var scene_path := "res://__gdtest_layout.tscn"

	var root := Node2D.new()
	root.name = "Layout"

	_add_solid(root, "FloorA", Vector2(100, 110), Vector2(200, 20))
	_add_solid(root, "FloorB", Vector2(350, 110), Vector2(100, 20))
	_add_solid(root, "Platform", Vector2(150, 50), Vector2(60, 8))
	_add_decor(root, "Grounded", Vector2(10, 68))
	_add_decor(root, "Floating", Vector2(50, 60))
	_add_decor(root, "OverGap", Vector2(230, 68))
	_add_decor(root, "Fused", Vector2(130, 30))

	var packed := PackedScene.new()
	packed.pack(root)
	ResourceSaver.save(packed, scene_path)
	root.free()

	var at = preload("res://addons/godot_mcp/tools/analysis_tools.gd").new()
	var r = at.analyze_2d_layout({"scene_path": scene_path})
	_check(r.get("ok", false), "analyze_2d_layout ok")
	# Headless there is no editor, so the disk copy is the only one — but the
	# answer must always say which it measured, or a caller cannot tell an
	# analysis of unsaved edits from one of the last save.
	_check(str(r.get("read_from", "")) == "disk", "says which copy of the scene it measured")
	_check(int(r.get("solids_checked", 0)) == 3, "found the three collision shapes")
	_check(int(r.get("decorations_checked", 0)) == 4, "found the four drawn nodes")

	var floating_paths := _paths_in(r.get("floating", []), "path")
	_check("Floating" in floating_paths, "reports the piece sitting 8px above the floor")
	_check(not ("Grounded" in floating_paths), "does not report the piece resting on it")
	for entry in r.get("floating", []):
		if str(entry.get("path", "")) == "Floating":
			_check(absf(float(entry.get("gap_px", 0.0)) - 8.0) < 0.01, "and reports the gap as 8px")

	var nothing_paths := _paths_in(r.get("over_nothing", []), "path")
	_check("OverGap" in nothing_paths, "reports the piece standing over the hole")
	_check(not ("Grounded" in nothing_paths), "and not one standing on real floor")

	var fused := false
	for entry in r.get("overlaps", []):
		if str(entry.get("decoration", "")) == "Fused" and str(entry.get("solid", "")) == "Platform":
			fused = true
	_check(fused, "reports the piece whose silhouette runs into the platform")

	var gaps: Array = r.get("floor_gaps", [])
	_check(gaps.size() == 1, "reports exactly one floor gap")
	if gaps.size() == 1:
		_check(absf(float(gaps[0].get("width_px", 0.0)) - 100.0) < 0.01, "and measures it at 100px")
		_check(not gaps[0].has("clearable"), "says nothing about clearing it until told the jump reach")

	# Given the reach, "can the player get past this" is arithmetic rather than
	# something you find out by playing it. The 100px gap against a 120px jump
	# clears with 20px to spare; against an 80px jump it does not, by 20px.
	var far = at.analyze_2d_layout({"scene_path": scene_path, "jump_reach_px": 120})
	var far_gap: Dictionary = far.get("floor_gaps", [{}])[0]
	_check(far_gap.get("clearable", false) == true, "a 100px gap clears a 120px jump")
	_check(absf(float(far_gap.get("margin_px", 0.0)) - 20.0) < 0.01, "with 20px of margin")

	var short_jump = at.analyze_2d_layout({"scene_path": scene_path, "jump_reach_px": 80})
	var short_gap: Dictionary = short_jump.get("floor_gaps", [{}])[0]
	_check(short_gap.get("clearable", true) == false, "and does not clear an 80px one")
	_check(absf(float(short_gap.get("margin_px", 0.0)) + 20.0) < 0.01, "reporting how far short, as a negative margin")
	_check("wider than a 80px jump" in str(short_jump.get("summary", "")), "and says so in the summary")

	at.free()
	_rm(scene_path)

# Callers write node paths the way a scene dump prints them — rooted at the root's
# own name. Godot's get_node_or_null resolves neither "Root" nor "Root/Child", so
# _find_node accepts both, without letting the alias shadow a real child.
func _test_root_name_resolves_as_root() -> void:
	print("
[root name resolves as root]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_rootname.tscn"
	_rm(scene)
	_check(st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"}).get("ok", false), "scene created")

	var by_name = st.add_node({"scene_path": scene, "node_name": "Child", "node_type": "Node2D", "parent_path": "Root"})
	_check(by_name.get("ok", false), "parent_path 'Root' resolves to the root")

	var prefixed = st.add_node({"scene_path": scene, "node_name": "Grand", "node_type": "Marker2D", "parent_path": "Root/Child"})
	_check(prefixed.get("ok", false), "parent_path 'Root/Child' resolves through the root prefix")

	var grand_paths := _all_paths(st.read_scene({"scene_path": scene}).get("root", {}))
	_check(grand_paths.has("Child/Grand"), "Grand landed under Child, not the root")

	# A child that shares the root's name must still win the literal lookup.
	_check(st.add_node({"scene_path": scene, "node_name": "Root", "node_type": "Node2D", "parent_path": "."}).get("ok", false), "homonym child added")
	_check(st.add_node({"scene_path": scene, "node_name": "Mine", "node_type": "Marker2D", "parent_path": "Root"}).get("ok", false), "homonym parent accepted")
	var paths2 := _all_paths(st.read_scene({"scene_path": scene}).get("root", {}))
	_check(paths2.has("Root/Mine"), "alias does not shadow a child of the same name")

	_check(not st.add_node({"scene_path": scene, "node_name": "Nope", "node_type": "Node2D", "parent_path": "Absent/Deep"}).get("ok", true), "a genuinely missing path still fails")
	_rm(scene)

# Forms a caller reasonably writes and the tools used to refuse: a capsule body,
# a vector as [x, y], and a lowercase player_type.
func _test_shape_and_vector_forms() -> void:
	print("
[shape and vector argument forms]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var pt = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var at = preload("res://addons/godot_mcp/tools/audio_tools.gd").new()
	var scene := "res://__gdtest_forms.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Body", "node_type": "CharacterBody2D", "parent_path": "."})

	_check(pt.setup_collision({"scene_path": scene, "node_path": "Body", "shape_type": "capsule", "size": [16, 32]}).get("ok", false), "setup_collision accepts a 2D capsule")
	var info = pt.get_collision_info({"scene_path": scene, "node_path": "Body"})
	var shapes: Array = info.get("collision_shapes", [])
	_check(shapes.size() == 1 and str(shapes[0].get("shape_type", "")) == "CapsuleShape2D", "and builds a CapsuleShape2D")

	_check(pt.add_raycast({"scene_path": scene, "parent_path": "Body", "node_name": "Ray", "target_position": [0, 20]}).get("ok", false), "add_raycast accepts target_position as [x, y]")
	var ray_paths := _all_paths(st.read_scene({"scene_path": scene}).get("root", {}))
	_check(ray_paths.has("Body/Ray"), "and the raycast lands under the body")

	_check(at.add_audio_player({"scene_path": scene, "parent_path": ".", "node_name": "Sfx", "player_type": "2d"}).get("ok", false), "add_audio_player accepts a lowercase player_type")

	var tt = preload("res://addons/godot_mcp/tools/theme_tools.gd").new()
	var theme_path := "res://__gdtest_theme.tres"
	_rm(theme_path)
	tt.create_theme({"theme_path": theme_path})
	_check(tt.set_theme_color({"theme_path": theme_path, "control_type": "Button", "color_name": "font_color", "color": "#ff0000"}).get("ok", false), "set_theme_color accepts a hex string")
	var loaded := ResourceLoader.load(theme_path, "Theme", ResourceLoader.CACHE_MODE_REPLACE) as Theme
	_check(loaded != null and loaded.get_color("font_color", "Button") == Color.RED, "and stores the colour it names")
	_check(not tt.set_theme_color({"theme_path": theme_path, "control_type": "Button", "color_name": "font_color", "color": "not a colour"}).get("ok", true), "a string that is not a colour is still refused")
	_rm(theme_path)
	_check(not pt.setup_collision({"scene_path": scene, "node_path": "Body", "shape_type": "triangle"}).get("ok", true), "an unsupported shape is still refused")
	_rm(scene)

# An empty path argument is a missing argument. Answering it with "Path escapes
# the project sandbox" sent callers hunting a traversal bug in a call whose real
# problem was that the path was never passed.
func _test_missing_path_is_not_an_escape() -> void:
	print("
[missing path reads as missing]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var bt = preload("res://addons/godot_mcp/tools/batch_tools.gd").new()
	var tt = preload("res://addons/godot_mcp/tools/theme_tools.gd").new()

	var empty = st.read_scene({"scene_path": ""})
	_check(not empty.get("ok", true), "an empty scene_path is refused")
	_check("Missing 'scene_path'" in str(empty.get("error", "")), "and names the argument that was missing")

	var escaped = st.read_scene({"scene_path": "res://../../../windows/system32/x.tscn"})
	_check(not escaped.get("ok", true), "a traversal is still refused")
	_check("escapes the project sandbox" in str(escaped.get("error", "")), "and still reads as an escape")

	_check("Missing 'scene_path'" in str(bt.find_nodes_by_type({"node_type": "Node2D"}).get("error", "")), "batch tools report a missing scene_path the same way")
	_check("Missing 'theme_path'" in str(tt.get_theme_info({"theme_path": ""}).get("error", "")), "theme tools too")

# A NavigationRegion2D under a Node3D does nothing, and the tools used to build
# exactly that: dimension defaulted to "2D" whatever it was being added to, and
# the call still answered ok.
func _test_dimension_follows_the_parent() -> void:
	print("
[dimension follows the parent]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var nt = preload("res://addons/godot_mcp/tools/navigation_tools.gd").new()
	var pt = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var scene := "res://__gdtest_dimension.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node3D", "root_node_name": "World"})

	_check(nt.setup_navigation_region({"scene_path": scene, "parent_path": "."}).get("ok", false), "navigation region added to a 3D scene")
	_check(nt.setup_navigation_agent({"scene_path": scene, "parent_path": "."}).get("ok", false), "navigation agent added to a 3D scene")
	_check(pt.add_raycast({"scene_path": scene, "parent_path": ".", "node_name": "Ray"}).get("ok", false), "raycast added to a 3D scene")

	var types: Array = []
	for child in st.read_scene({"scene_path": scene}).get("root", {}).get("children", []):
		types.append(str(child.get("type", "")))
	_check(types.has("NavigationRegion3D"), "the region is 3D, not 2D")
	_check(types.has("NavigationAgent3D"), "the agent is 3D, not 2D")
	_check(types.has("RayCast3D"), "the raycast is 3D, not 2D")

	# An explicit dimension still wins over the parent.
	_check(pt.add_raycast({"scene_path": scene, "parent_path": ".", "node_name": "Flat", "dimension": "2D"}).get("ok", false), "an explicit dimension is accepted")
	var flat := ""
	for child in st.read_scene({"scene_path": scene}).get("root", {}).get("children", []):
		if str(child.get("name", "")) == "Flat":
			flat = str(child.get("type", ""))
	_check(flat == "RayCast2D", "and overrides what the parent implies")
	_check(not pt.add_raycast({"scene_path": scene, "parent_path": ".", "dimension": "4D"}).get("ok", true), "a nonsense dimension is still refused")
	_rm(scene)

# Pointed at the root (its default), get_navigation_info answered with the
# root's class and nothing else — no sign it had been aimed at the wrong node.
func _test_navigation_info_points_somewhere() -> void:
	print("
[navigation info points somewhere]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var nt = preload("res://addons/godot_mcp/tools/navigation_tools.gd").new()
	var scene := "res://__gdtest_nav.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node3D", "root_node_name": "World"})

	var bare = nt.get_navigation_info({"scene_path": scene, "node_path": "."})
	_check(bare.get("ok", false), "a scene with no navigation still answers ok")
	_check("no navigation nodes" in str(bare.get("note", "")), "and says the scene has none")

	nt.setup_navigation_region({"scene_path": scene, "parent_path": "."})
	var pointed = nt.get_navigation_info({"scene_path": scene, "node_path": "."})
	_check(pointed.get("navigation_nodes", []).has("NavigationRegion3D"), "once one exists it is named")

	var real = nt.get_navigation_info({"scene_path": scene, "node_path": "NavigationRegion3D"})
	_check(real.has("has_baked_data"), "and the region itself still reports its own settings")
	_check(not real.has("note"), "with no note, because there was something to report")
	_rm(scene)

# A path handed to validate_meshes that is not a mesh file used to vanish: the
# answer read "Validated 0 mesh(es)" with nothing saying the file was dropped.
func _test_validate_meshes_names_what_it_dropped() -> void:
	print("\n[validate_meshes names what it dropped]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var tt = preload("res://addons/godot_mcp/tools/testing_tools.gd").new()
	var scene := "res://__gdtest_meshes.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node3D", "root_node_name": "World"})

	var r = tt.validate_meshes({"paths": [scene]})
	_check(r.get("ok", false), "a non-mesh path still answers ok")
	_check(int(r.get("total", -1)) == 0, "and validates nothing")
	var skipped: Array = r.get("skipped", [])
	_check(skipped.size() == 1 and str(skipped[0].get("path", "")) == scene, "but names the file it dropped")
	_rm(scene)

# Addon source answers almost every common identifier, and none of those hits
# are what the caller meant — they crowd out the project own code and cost
# context to read.
func _test_search_skips_addons() -> void:
	print("\n[search skips addon source]")
	var ft = preload("res://addons/godot_mcp/tools/file_tools.gd").new()
	# A string only the addon contains — built by hand so this file does not
	# contain it whole and match itself.
	var query := "_collect_" + "mesh_files"

	var default_run = ft.search_project({"query": query})
	_check(default_run.get("ok", false), "search answers ok")
	_check(int(default_run.get("returned", -1)) == 0, "and finds nothing outside addons")
	_check(int(default_run.get("skipped_addon_files", 0)) > 0, "while saying how many addon files it skipped")

	var opted_in = ft.search_project({"query": query, "include_addons": true})
	_check(int(opted_in.get("returned", 0)) > 0, "include_addons brings them back")
	_check(not opted_in.has("skipped_addon_files"), "and then nothing is reported as skipped")

# get_input_map reports key events as {"keycode": 83}; handing one straight back
# to configure_input_map was rejected, and the action was created bound to
# nothing while the call still answered ok.
func _test_input_map_round_trips() -> void:
	print("\n[input map round-trips its own output]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()

	var numeric = pt.configure_input_map({"operation": "set", "action": "__gdtest_jump", "events": [{"type": "key", "keycode": 32}]})
	_check(numeric.get("ok", false), "a numeric keycode is accepted")
	_check(numeric.get("events", []).size() == 1, "and binds one event")

	var named = pt.configure_input_map({"operation": "set", "action": "__gdtest_jump", "events": [{"type": "key", "key": "Space"}]})
	_check(named.get("ok", false), "a key name still works")

	var reported = pt.get_input_map({}).get("actions", {}).get("__gdtest_jump", {})
	_check(reported.get("events", []).size() == 1, "and get_input_map reports the binding back")

	var broken = pt.configure_input_map({"operation": "set", "action": "__gdtest_broken", "events": [{"type": "key"}]})
	_check(not broken.get("ok", true), "an action whose every event failed is not reported as ok")
	_check(broken.get("event_errors", []).size() == 1, "and says what went wrong")

	pt.configure_input_map({"operation": "remove", "action": "__gdtest_jump"})
	pt.configure_input_map({"operation": "remove", "action": "__gdtest_broken"})

# The sanitizer dropped the escape byte and left the rest of the colour sequence
# behind as literal text, so a log line read "[90m[1msavepack[22m | ..." — noise
# baked into the payload for good. And a successful export spent most of its
# lines naming each packed file.
func _test_export_log_is_readable() -> void:
	print("\n[export log is readable]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()

	var coloured := "\u001b[90m\u001b[1msavepack\u001b[22m | Storing File: res://a.gd\u001b[0m"
	var clean: String = pt._sanitize_log_text(coloured)
	_check(not ("[90m" in clean), "the colour sequence is gone, not just its escape byte")
	_check(not ("[0m" in clean), "including the reset at the end")
	_check("savepack | Storing File: res://a.gd" in clean, "and the text it wrapped survives")

	var noisy := "Storing File: res://a.gd\nStoring File: res://b.gd\nERROR: something broke\nDone"
	var condensed: String = pt._condense_export_log(noisy)
	_check("ERROR: something broke" in condensed, "an error line is kept")
	_check("Done" in condensed, "and so is the outcome")
	_check(not ("res://a.gd" in condensed), "while per-file progress is dropped")
	_check("2 per-file progress line(s) omitted" in condensed, "and the count is reported, not hidden")

# The map excludes addon scripts from its nodes by default, but emitted a preload
# edge for any .gd reference — so every preload into res://addons/ became an edge
# with no node at the far end. The header then advertised connections the graph
# could not draw a single one of.
func _test_map_counts_only_drawable_edges() -> void:
	print("\n[map counts only drawable edges]")
	var vt = preload("res://addons/godot_mcp/tools/visualizer_tools.gd").new()
	var a := "res://__gdtest_map_a.gd"
	var b := "res://__gdtest_map_b.gd"
	_rm(a)
	_rm(b)
	# a preloads b (both project scripts) and an addon script (excluded by default).
	_write_text(a, "extends Node\n\nconst B = preload(\"" + b + "\")\nconst Guard = preload(\"res://addons/godot_mcp/utils/path_guard.gd\")\n")
	_write_text(b, "extends Node\n")

	var r = vt.map_project({"root": "res://"})
	_check(r.get("ok", false), "map_project answers ok")
	var map: Dictionary = r.get("project_map", {})
	var node_paths: Array = []
	for n in map.get("nodes", []):
		node_paths.append(str(n.get("path", "")))
	_check(node_paths.has(a) and node_paths.has(b), "both project scripts are nodes")
	_check(not node_paths.has("res://addons/godot_mcp/utils/path_guard.gd"), "the addon script is not a node")

	var edge_targets: Array = []
	for e in map.get("edges", []):
		edge_targets.append(str(e.get("to", "")))
	_check(edge_targets.has(b), "the edge to a script in the map is kept")
	_check(not edge_targets.has("res://addons/godot_mcp/utils/path_guard.gd"), "the edge to a script outside it is not")

	# Every edge must land on a node, or the count is advertising nothing.
	var dangling := 0
	for e in map.get("edges", []):
		if not node_paths.has(str(e.get("to", ""))) or not node_paths.has(str(e.get("from", ""))):
			dangling += 1
	_check(dangling == 0, "no edge points outside the map (%d dangling)" % dangling)
	_check(int(map.get("total_connections", -1)) == map.get("edges", []).size(), "total_connections counts the edges it returns")
	_rm(a)
	_rm(b)

# Every node path in a read_scene tree, flattened.
func _all_paths(node: Dictionary) -> Array:
	var out: Array = [str(node.get("path", ""))]
	for child in node.get("children", []):
		out.append_array(_all_paths(child))
	return out

func _add_solid(root: Node2D, node_name: String, centre: Vector2, size: Vector2) -> void:
	var body := StaticBody2D.new()
	body.name = node_name
	root.add_child(body)
	body.owner = root
	var cs := CollisionShape2D.new()
	cs.name = "Shape"
	var shape := RectangleShape2D.new()
	shape.size = size
	cs.shape = shape
	cs.position = centre
	body.add_child(cs)
	cs.owner = root

func _add_decor(root: Node2D, node_name: String, top_left: Vector2) -> void:
	var sprite := Sprite2D.new()
	sprite.name = node_name
	var tex := PlaceholderTexture2D.new()
	tex.size = Vector2(32, 32)
	sprite.texture = tex
	sprite.centered = false
	sprite.position = top_left
	root.add_child(sprite)
	sprite.owner = root

func _paths_in(entries: Array, key: String) -> Array:
	var out: Array = []
	for e in entries:
		out.append(str(e.get(key, "")))
	return out

# get_errors used to pick the Debugger > Errors tree by ancestor name and, when
# that missed, took whichever Tree came first under the debugger — the profiler's
# or the monitors' would do — then cached it forever, so error_count stayed 0
# with a panel full of errors (issue #4). Rows Godot builds in that panel carry
# _is_error / _is_warning meta; nothing else in the debugger does. This proves
# the identifier tells the two apart.
func _test_debugger_error_tree_identification() -> void:
	print("\n[debugger error tree]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()

	var errors_tree := Tree.new()
	var errors_root := errors_tree.create_item()
	var err_row := errors_tree.create_item(errors_root)
	err_row.set_meta(&"_is_error", true)
	var warn_row := errors_tree.create_item(errors_root)
	warn_row.set_meta(&"_is_warning", true)
	# A stack-trace child, which is not a top-level entry and must not be counted.
	errors_tree.create_item(err_row)

	var other_tree := Tree.new()
	var other_root := other_tree.create_item()
	other_tree.create_item(other_root)
	other_tree.create_item(other_root)
	other_tree.create_item(other_root)

	var empty_tree := Tree.new()

	_check(pt._tree_error_rows(errors_tree) == 2, "counts the two meta-stamped rows, not the stack child")
	_check(pt._tree_error_rows(other_tree) == 0, "a debugger tree with more rows but no meta scores 0")
	_check(pt._tree_error_rows(empty_tree) == 0, "a tree with no root scores 0")

	errors_tree.free()
	other_tree.free()
	empty_tree.free()
	pt.free()

# read_scene max_depth caps recursion; a depth-limited node reports children_truncated.
func _test_read_scene_depth() -> void:
	print("\n[read_scene max_depth]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_depth.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.batch_scene_edit({"scene_path": scene, "operations": [
		{"op": "add_node", "node_name": "A", "node_type": "Node2D", "parent_path": "."},
		{"op": "add_node", "node_name": "B", "node_type": "Node2D", "parent_path": "A"},
	]})

	var full = st.read_scene({"scene_path": scene})
	var a_full: Dictionary = full["root"]["children"][0]
	_check(a_full["children"].size() == 1, "full read: A has its child B expanded")
	_check(not a_full.has("children_truncated"), "full read: no truncation")

	var shallow = st.read_scene({"scene_path": scene, "max_depth": 1})
	var a_shallow: Dictionary = shallow["root"]["children"][0]
	_check(a_shallow.get("children", []).is_empty(), "max_depth=1: A not expanded")
	_check(int(a_shallow.get("children_truncated", 0)) == 1, "max_depth=1: A reports children_truncated=1")

	_rm(scene)
	st.free()

# duplicate_node and set_node_groups on the disk path.
func _test_duplicate_and_groups() -> void:
	print("\n[duplicate_node + set_node_groups]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_dg.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Orig", "node_type": "Sprite2D", "parent_path": "."})

	var d = st.duplicate_node({"scene_path": scene, "node_path": "Orig", "new_name": "Copy"})
	_check(d.get("ok", false), "duplicate_node ok")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("Orig") and txt.contains("Copy"), "both original and duplicate persisted")

	var g = st.set_node_groups({"scene_path": scene, "node_path": "Orig", "groups": ["enemies", "spawnable"], "mode": "replace"})
	_check(g.get("ok", false), "set_node_groups ok")
	txt = FileAccess.get_file_as_string(scene)
	_check(txt.contains("enemies") and txt.contains("spawnable"), "groups written to the scene file")

	_rm(scene)
	st.free()

# move_node reparents; rename_node renames — both on the disk path.
func _test_move_and_rename() -> void:
	print("\n[move_node + rename_node]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_mr.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.batch_scene_edit({"scene_path": scene, "operations": [
		{"op": "add_node", "node_name": "Parent", "node_type": "Node2D", "parent_path": "."},
		{"op": "add_node", "node_name": "Kid", "node_type": "Node2D", "parent_path": "."},
	]})

	var m = st.move_node({"scene_path": scene, "node_path": "Kid", "new_parent_path": "Parent"})
	_check(m.get("ok", false), "move_node ok")
	var rr = st.read_scene({"scene_path": scene})
	var parent: Dictionary = rr["root"]["children"][0]
	_check(str(parent["name"]) == "Parent" and parent["children"].size() == 1, "Kid is now under Parent")

	var rn = st.rename_node({"scene_path": scene, "node_path": "Parent/Kid", "new_name": "Renamed"})
	_check(rn.get("ok", false), "rename_node ok")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("Renamed") and not txt.contains("\"Kid\""), "node renamed in the scene file")

	_rm(scene)
	st.free()

# attach_script wires a script onto a node; detach_script removes it.
func _test_attach_detach_script() -> void:
	print("\n[attach_script + detach_script]")
	var ft = preload("res://addons/godot_mcp/tools/file_tools.gd").new()
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_as.tscn"
	var script := "res://__gdtest_as.gd"
	_rm(scene)
	_rm(script)
	ft.create_script({"path": script, "content": "extends Node2D\nfunc _ready(): pass\n"})
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "N", "node_type": "Node2D", "parent_path": "."})

	var a = st.attach_script({"scene_path": scene, "node_path": "N", "script_path": script})
	_check(a.get("ok", false), "attach_script ok")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("__gdtest_as.gd"), "script reference written to the scene")

	var d = st.detach_script({"scene_path": scene, "node_path": "N"})
	_check(d.get("ok", false), "detach_script ok")
	txt = FileAccess.get_file_as_string(scene)
	_check(not txt.contains("__gdtest_as.gd"), "script reference removed after detach")

	_rm(scene)
	_rm(script)
	ft.free()
	st.free()

# instance_scene embeds one saved scene as an instance inside another.
func _test_instance_scene() -> void:
	print("\n[instance_scene]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var inner := "res://__gdtest_inner.tscn"
	var outer := "res://__gdtest_outer.tscn"
	_rm(inner)
	_rm(outer)
	st.create_scene({"scene_path": inner, "root_node_type": "Node2D", "root_node_name": "Inner"})
	st.create_scene({"scene_path": outer, "root_node_type": "Node2D", "root_node_name": "Outer"})

	var r = st.instance_scene({"scene_path": outer, "instance_path": inner, "node_name": "InnerInst", "parent_path": "."})
	_check(r.get("ok", false), "instance_scene ok")
	var txt := FileAccess.get_file_as_string(outer)
	_check(txt.contains("__gdtest_inner.tscn") and txt.contains("InnerInst"), "outer scene references the instanced scene")

	_rm(inner)
	_rm(outer)
	st.free()

# _parse_stringified_args: bool + JSON-container coercion for any key, but numbers
# only for the polymorphic value-fields whitelist (not for string-typed fields).
func _test_arg_coercion() -> void:
	print("\n[arg coercion]")
	var te = preload("res://addons/godot_mcp/tool_executor.gd").new()
	var d := {"flag": "true", "off": "false", "value": "42", "expected": "3.5", "node_path": "5", "name": "42"}
	te._parse_stringified_args(d)
	_check(d["flag"] == true and d["off"] == false, "true/false strings become bools")
	_check(typeof(d["value"]) == TYPE_INT and d["value"] == 42, "'value' numeric string becomes int")
	_check(typeof(d["expected"]) == TYPE_FLOAT and abs(d["expected"] - 3.5) < 0.001, "'expected' numeric string becomes float")
	_check(typeof(d["node_path"]) == TYPE_STRING and d["node_path"] == "5", "string-typed 'node_path' NOT coerced (a node named '5' survives)")
	_check(typeof(d["name"]) == TYPE_STRING, "'name' not in the numeric whitelist, stays string")

	# Free-form text keys must survive the words "true"/"false" verbatim. The
	# coercion used to hit every key, so a node named "true" became a boolean.
	var t := {"node_name": "true", "content": "false", "method": "true",
		"property_name": "false", "group": "true", "dry_run": "true"}
	te._parse_stringified_args(t)
	_check(t["node_name"] == "true" and typeof(t["node_name"]) == TYPE_STRING,
		"a node named 'true' stays a String")
	_check(t["content"] == "false" and typeof(t["content"]) == TYPE_STRING,
		"script content 'false' stays a String")
	_check(typeof(t["method"]) == TYPE_STRING and typeof(t["property_name"]) == TYPE_STRING,
		"method/property_name stay Strings")
	_check(typeof(t["group"]) == TYPE_STRING, "group name stays a String")
	_check(t["dry_run"] == true, "an actual flag is still coerced to bool")
	te.free()

# create_folder + delete_file (both live in script_tools).
func _test_file_ops() -> void:
	print("\n[file ops]")
	var sc = preload("res://addons/godot_mcp/tools/script_tools.gd").new()
	var folder := "res://__gdtest_dir"
	var f := "res://__gdtest_dir/note.txt"
	var cf = sc.create_folder({"path": folder})
	_check(cf.get("ok", false), "create_folder ok")
	_check(DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(folder)), "folder exists on disk")
	var w := FileAccess.open(f, FileAccess.WRITE); w.store_string("x"); w.close()
	var df = sc.delete_file({"path": f, "confirm": true, "create_backup": false})
	_check(df.get("ok", false), "delete_file ok")
	_check(not FileAccess.file_exists(f), "file removed")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(folder))
	sc.free()

# wire_signal: connect a signal AND scaffold a typed handler into the receiver's
# script, then persist the connection — all on the disk path.
func _test_wire_signal() -> void:
	print("\n[wire_signal]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_wire.tscn"
	var script := "res://__gdtest_wire.gd"
	_rm(scene)
	_rm(script)
	var w := FileAccess.open(script, FileAccess.WRITE); w.store_string("extends Node2D\n"); w.close()
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.attach_script({"scene_path": scene, "node_path": ".", "script_path": script})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "Area2D", "node_name": "Zone"})

	var r = st.wire_signal({"scene_path": scene, "from_node": "Zone", "signal": "body_entered", "to_node": "."})
	_check(r.get("ok", false), "wire_signal ok")
	_check(r.get("stub_added", false), "handler stub added")
	_check(r.get("handler", "") == "_on_zone_body_entered", "default handler name follows _on_<node>_<signal>")
	_check(r.get("handler_params", "") == "body: Node2D", "handler typed from the signal's args")
	var body := FileAccess.get_file_as_string(script)
	_check(body.contains("func _on_zone_body_entered(body: Node2D)"), "typed stub written into the script")
	# Re-run must not duplicate the handler.
	var r2 = st.wire_signal({"scene_path": scene, "from_node": "Zone", "signal": "body_entered", "to_node": "."})
	_check(not r2.get("stub_added", true), "re-run does not re-add an existing handler")

	st.free()
	_rm(scene)
	_rm(script)
	_rm(script + ".uid")

# generate_onready_refs: typed @onready block for named children, and idempotent
# insertion into the target's script.
func _test_generate_onready_refs() -> void:
	print("\n[generate_onready_refs]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_onready.tscn"
	var script := "res://__gdtest_onready.gd"
	_rm(scene)
	_rm(script)
	var w := FileAccess.open(script, FileAccess.WRITE); w.store_string("extends Node2D\n"); w.close()
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.attach_script({"scene_path": scene, "node_path": ".", "script_path": script})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "Sprite2D", "node_name": "Body"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "Camera2D", "node_name": "Cam"})

	var r = st.generate_onready_refs({"scene_path": scene, "target_node": "."})
	_check(r.get("ok", false), "generate_onready_refs ok")
	_check(r.get("refs_count", 0) == 2, "one ref per direct named child")
	_check(str(r.get("block", "")).contains("@onready var body: Sprite2D = $Body"), "typed ref with $ path")

	var ins = st.generate_onready_refs({"scene_path": scene, "target_node": ".", "insert": true})
	_check(ins.get("inserted", false), "insert writes the block into the script")
	var body := FileAccess.get_file_as_string(script)
	_check(body.contains("@onready var cam: Camera2D = $Cam"), "block spliced into the script")
	var again = st.generate_onready_refs({"scene_path": scene, "target_node": ".", "insert": true})
	_check(not again.get("inserted", true), "re-insert is idempotent (all vars already declared)")

	st.free()
	_rm(scene)
	_rm(script)
	_rm(script + ".uid")

# set_physics_layers accepts layer NAMES from Project Settings, not just indices.
func _test_collision_by_name() -> void:
	print("\n[set_physics_layers by name]")
	ProjectSettings.set_setting("layer_names/2d_physics/layer_1", "world")
	ProjectSettings.set_setting("layer_names/2d_physics/layer_3", "enemy")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var ph = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var scene := "res://__gdtest_layers.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Area2D", "root_node_name": "Root"})

	var r = ph.set_physics_layers({"scene_path": scene, "node_path": ".", "collision_layer": ["enemy"], "collision_mask": ["world"]})
	_check(r.get("ok", false), "set_physics_layers by name ok")
	var info = ph.get_collision_info({"scene_path": scene, "node_path": "."})
	_check(info.get("collision_layer", 0) == 4, "'enemy' (layer 3) -> bit value 4")
	_check(info.get("collision_mask", 0) == 1, "'world' (layer 1) -> bit value 1")
	var bad = ph.set_physics_layers({"scene_path": scene, "node_path": ".", "collision_layer": ["ghost"]})
	_check(not bad.get("ok", true), "unknown layer name is rejected")

	st.free()
	ph.free()
	_rm(scene)

## Remove a directory and everything in it (test scaffolds write whole folders).
func _rmdir(res_dir: String) -> void:
	var abs := ProjectSettings.globalize_path(res_dir)
	var d := DirAccess.open(res_dir)
	if d == null:
		return
	d.list_dir_begin()
	var e := d.get_next()
	while e != "":
		if not e.begins_with("."):
			var child := res_dir.path_join(e)
			if d.current_is_dir():
				_rmdir(child)
			else:
				DirAccess.remove_absolute(ProjectSettings.globalize_path(child))
		e = d.get_next()
	d.list_dir_end()
	DirAccess.remove_absolute(abs)

# scaffold_entity builds the whole character subtree AND attaches a real shape
# resource — the "CollisionShape2D has no shape" warning is the bug this guards.
func _test_scaffold_entity() -> void:
	print("\n[scaffold_entity]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var dir := "res://__gdtest_scaffold"
	_rmdir(dir)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir))
	var scene := dir + "/enemy.tscn"

	var r = st.scaffold_entity({
		"scene_path": scene, "body_type": "CharacterBody2D",
		"collision_shape": "capsule", "shape_params": {"radius": 12, "height": 40},
		"movement": "platformer", "groups": ["enemies"],
	})
	_check(r.get("ok", false), "scaffold_entity ok")
	_check(r.get("entity_name", "") == "Enemy", "entity name derived from the file name")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("CharacterBody2D"), "physics body root written")
	_check(txt.contains("CollisionShape2D"), "collision node written")
	_check(txt.contains("CapsuleShape2D"), "a real shape resource is attached (no empty-shape warning)")
	_check(txt.contains("Sprite2D"), "sprite written")
	var script_src := FileAccess.get_file_as_string(dir + "/enemy.gd")
	_check(script_src.contains("move_and_slide"), "platformer movement script written")
	var sc = preload("res://addons/godot_mcp/tools/script_tools.gd").new()
	_check(sc.validate_script({"path": dir + "/enemy.gd"}).get("valid", false), "generated movement script compiles")
	sc.free()

	# A 3D body must refuse the 2D-only movement template rather than emit a
	# script that cannot compile.
	var bad = st.scaffold_entity({"scene_path": dir + "/x.tscn", "body_type": "CharacterBody3D", "movement": "platformer"})
	_check(not bad.get("ok", true), "3D body + 2D movement template is rejected")

	st.free()
	_rmdir(dir)

# scaffold_state_machine writes the base/machine/state scripts and nests the
# state nodes under the machine, with the first state selected.
func _test_scaffold_state_machine() -> void:
	print("\n[scaffold_state_machine]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var dir := "res://__gdtest_fsm"
	_rmdir(dir)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir))
	var scene := dir + "/host.tscn"
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Host"})

	var r = st.scaffold_state_machine({"scene_path": scene, "states": ["idle", "chase"]})
	_check(r.get("ok", false), "scaffold_state_machine ok")
	_check(r.get("initial_state", "") == "Idle", "first state becomes the initial state")
	_check(FileAccess.file_exists(dir + "/states/state.gd"), "State base class written")
	_check(FileAccess.file_exists(dir + "/states/state_machine.gd"), "StateMachine script written")
	_check(FileAccess.file_exists(dir + "/states/idle_state.gd"), "per-state script written")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("parent=\"StateMachine\""), "state nodes nested under the machine")
	_check(txt.contains("initial_state = NodePath(\"Idle\")"), "initial_state persisted")

	var empty = st.scaffold_state_machine({"scene_path": scene, "states": []})
	_check(not empty.get("ok", true), "empty state list is rejected")

	# The generated scripts must actually COMPILE. A template that only looks
	# right (e.g. typing a var by a const preload, which GDScript rejects unless
	# the base declares class_name) would otherwise ship broken.
	var sc = preload("res://addons/godot_mcp/tools/script_tools.gd").new()
	for gen in ["state.gd", "state_machine.gd", "idle_state.gd"]:
		var v = sc.validate_script({"path": dir + "/states/" + gen})
		_check(v.get("valid", false), "generated %s compiles" % gen)
	sc.free()

	st.free()
	_rmdir(dir)

# The read-only analysis suite: statistics, unused resources, cycle detection,
# scene complexity and signal-flow orphans.
func _test_analysis_tools() -> void:
	print("\n[analysis suite]")
	var an = preload("res://addons/godot_mcp/tools/analysis_tools.gd").new()
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()

	var stats = an.get_project_statistics({})
	_check(stats.get("ok", false), "get_project_statistics ok")
	_check(int(stats.get("files_total", 0)) > 0, "statistics counted project files")

	var unused = an.find_unused_resources({})
	_check(unused.get("ok", false), "find_unused_resources ok")
	_check(unused.has("unused"), "unused list returned")

	# Two scripts that preload each other must show up as a cycle.
	var a_path := "res://__gdtest_cyc_a.gd"
	var b_path := "res://__gdtest_cyc_b.gd"
	var fa := FileAccess.open(a_path, FileAccess.WRITE)
	fa.store_string("extends Node\nconst B = preload(\"res://__gdtest_cyc_b.gd\")\n")
	fa.close()
	var fb := FileAccess.open(b_path, FileAccess.WRITE)
	fb.store_string("extends Node\nconst A = preload(\"res://__gdtest_cyc_a.gd\")\n")
	fb.close()
	var cyc = an.detect_circular_dependencies({})
	_check(cyc.get("ok", false), "detect_circular_dependencies ok")
	_check(int(cyc.get("cycle_count", 0)) >= 1, "mutual preload is reported as a cycle")
	_rm(a_path)
	_rm(b_path)
	_rm(a_path + ".uid")
	_rm(b_path + ".uid")

	# A connection whose handler does not exist must be flagged as an orphan.
	var scene := "res://__gdtest_orphan.tscn"
	var script := "res://__gdtest_orphan.gd"
	_rm(scene)
	_rm(script)
	var sf := FileAccess.open(script, FileAccess.WRITE)
	sf.store_string("extends Node2D\n\nfunc _on_real() -> void:\n\tpass\n")
	sf.close()
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.attach_script({"scene_path": scene, "node_path": ".", "script_path": script})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "Area2D", "node_name": "Zone"})
	st.connect_signal({"scene_path": scene, "from_node": "Zone", "signal": "body_entered",
		"to_node": ".", "method": "_on_missing", "_skip_method_check": true})

	var flow = an.analyze_signal_flow({"scene_path": scene})
	_check(flow.get("ok", false), "analyze_signal_flow ok")
	_check(int(flow.get("orphan_count", 0)) >= 1, "connection with no matching func is flagged as orphan")

	var cx = an.analyze_scene_complexity({"scene_path": scene})
	_check(cx.get("ok", false), "analyze_scene_complexity ok")
	var scenes: Array = cx.get("scenes", [])
	_check(scenes.size() == 1 and int(scenes[0].get("node_count", 0)) == 2, "complexity counted the scene's nodes")

	an.free()
	st.free()
	_rm(scene)
	_rm(script)
	_rm(script + ".uid")

# compare_screenshots: identical images, a real difference, and a size mismatch.
func _test_compare_screenshots() -> void:
	print("\n[compare_screenshots]")
	var an = preload("res://addons/godot_mcp/tools/analysis_tools.gd").new()
	var a := "res://__gdtest_img_a.png"
	var b := "res://__gdtest_img_b.png"
	var c := "res://__gdtest_img_c.png"
	var img_a := Image.create(16, 16, false, Image.FORMAT_RGBA8)
	img_a.fill(Color.BLACK)
	img_a.save_png(ProjectSettings.globalize_path(a))
	var img_b := Image.create(16, 16, false, Image.FORMAT_RGBA8)
	img_b.fill(Color.BLACK)
	# 4 white pixels out of 256 = 1.5625%.
	for i in range(4):
		img_b.set_pixel(i, 0, Color.WHITE)
	img_b.save_png(ProjectSettings.globalize_path(b))
	var img_c := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	img_c.fill(Color.BLACK)
	img_c.save_png(ProjectSettings.globalize_path(c))

	var same = an.compare_screenshots({"baseline": a, "current": a})
	_check(same.get("identical", false), "identical images report identical")
	_check(float(same.get("diff_percentage", -1.0)) == 0.0, "identical images are 0% different")

	var diff = an.compare_screenshots({"baseline": a, "current": b})
	_check(not diff.get("identical", true), "changed image is not identical")
	_check(int(diff.get("changed_pixels", 0)) == 4, "counted exactly the changed pixels")
	_check(abs(float(diff.get("diff_percentage", 0.0)) - 1.5625) < 0.001, "diff percentage is correct")

	var mismatch = an.compare_screenshots({"baseline": a, "current": c})
	_check(not mismatch.get("ok", true), "size mismatch is rejected")

	an.free()
	_rm(a)
	_rm(b)
	_rm(c)

# The human-activity digest attached to every tool response. Exercised directly
# on the plugin object: the recording/filtering logic is plain GDScript, and the
# alternative (a real human clicking in a running editor) is not automatable.
func _test_activity_digest() -> void:
	print("\n[editor activity digest]")
	var log = preload("res://addons/godot_mcp/utils/activity_log.gd").new()

	# No tool call is in flight, so these record as human.
	log.record("selection", ["Player"])
	log.record("scene_saved", "res://x.tscn")
	var d1: Dictionary = log.human_digest()
	_check(int(d1.get("human_events_since_last_call", 0)) == 2, "digest reports the human events")
	var recent: Array = d1.get("recent", [])
	_check(recent.size() == 2 and str(recent[1].get("type", "")) == "scene_saved", "digest carries type + detail")

	# Cursor advanced: the same events must not be reported twice.
	_check(log.human_digest().is_empty(), "digest is empty when nothing new happened")

	# Events caused by the agent's own tool call must not be reported back to it.
	log.begin_agent_call()
	log.record("selection", ["Enemy"])
	_check(log.human_digest().is_empty(), "agent-caused activity is not reported as human")
	_check(int(log.query(0, 50, "agent").get("count", 0)) == 1, "agent event is still queryable by source")

	# Overlapping calls: the inner one finishing must not un-tag the outer one,
	# which is still running.
	log.begin_agent_call()
	log.end_agent_call()
	log.record("selection", ["Enemy2"])
	_check(int(log.query(0, 50, "agent").get("count", 0)) == 2, "an inner call ending leaves the outer call's window open")
	log.end_agent_call()

	# A handler that dies mid-coroutine never reaches end_agent_call. The window
	# has to lapse on its own, or every later human action is mis-tagged agent
	# and the activity feed goes silent for the rest of the editor session.
	log._agent_depth = 0
	log._agent_deadline_ms = 0
	log.begin_agent_call()  # deliberately unmatched: the abort case
	_check(log._agent_deadline_ms - Time.get_ticks_msec() <= log.AGENT_MAX_CALL_MS, "an abandoned agent window is bounded, not open-ended")

	# The digest stays small even after a burst.
	log._agent_depth = 0
	log._agent_deadline_ms = 0
	for i in range(20):
		log.record("selection", ["N%d" % i])
	var d2: Dictionary = log.human_digest()
	_check(int(d2.get("human_events_since_last_call", 0)) == 20, "counts every human event")
	_check(Array(d2.get("recent", [])).size() == 5, "but only ships the last few (token cap)")

	# One event's DETAIL must be bounded too, not just the number of events.
	# Godot hands resources_reimported an array of every path it imported, and
	# this digest rides on every tool response: dropping an asset pack into the
	# project made an unrelated tool call return 1.5 MB (~390,000 tokens).
	var many: Array = []
	for i in range(3000):
		many.append("res://Sprites/some_quite_long_asset_name_%04d.png" % i)
	log._agent_depth = 0
	log._agent_deadline_ms = 0
	log.record("resources_reimported", many)
	var recorded: Array = log.query(0, 1).get("events", [])
	var stored: Array = recorded[0]["detail"]
	_check(stored.size() <= McpActivityLog.DETAIL_MAX_ITEMS + 1, "a huge detail array is clamped (%d entries)" % stored.size())
	_check(str(stored[stored.size() - 1]).contains("3000"), "and says how many there really were, instead of lying by omission")
	_check(JSON.stringify(recorded[0]).length() < 1000, "so one event cannot blow up a tool response")

	log.record("script_focus", "x".repeat(5000))
	var long_one: Array = log.query(0, 1).get("events", [])
	_check(str(long_one[0]["detail"]).length() < 400, "an absurdly long string detail is clamped too")

	# The ring must not grow without bound.
	for i in range(300):
		log.record("selection", ["flood"])
	_check(int(log.query(0, 9999).get("count", 0)) <= 200, "ring buffer is capped")

# sync_localization: CSV auditing (missing cells, duplicate keys) and registering
# the generated .translation files. Headless has no editor importer, so the
# .translation files are faked on disk to exercise the registration half.
func _test_sync_localization() -> void:
	print("\n[sync_localization]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()
	var dir := "res://__gdtest_i18n"
	var csv := dir + "/strings.csv"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir))
	var f := FileAccess.open(csv, FileAccess.WRITE)
	f.store_string("keys,en,es\nHELLO,Hello,Hola\nEXIT,Exit,\nHELLO,Hi,Hola2\n")
	f.close()

	var before = ProjectSettings.get_setting("internationalization/locale/translations", PackedStringArray())

	# Nothing imported yet: it must say so instead of silently registering nothing.
	var pre = pt.sync_localization({"csv_path": csv})
	_check(pre.get("ok", false), "sync_localization ok")
	_check(Array(pre.get("locales", [])) == ["en", "es"], "locales read from the header")
	_check(int(pre.get("key_count", 0)) == 3, "counted the rows")
	_check(Array(pre.get("duplicate_keys", [])).has("HELLO"), "duplicate key reported")
	var missing: Dictionary = pre.get("missing_translations", {})
	_check(missing.has("es") and Array(missing["es"]).has("EXIT"), "empty cell reported as a missing translation")
	_check(Array(pre.get("not_imported", [])).size() == 2, "un-imported locales reported")

	# With the .translation files present, they get registered — once.
	for loc in ["en", "es"]:
		var t := FileAccess.open("%s/strings.%s.translation" % [dir, loc], FileAccess.WRITE)
		t.store_string("")
		t.close()
	var dry = pt.sync_localization({"csv_path": csv, "dry_run": true})
	_check(Array(dry.get("registered", [])).is_empty(), "dry_run registers nothing")
	_check(Array(dry.get("would_register", [])).size() == 2, "dry_run reports what it would register")

	var run1 = pt.sync_localization({"csv_path": csv})
	_check(Array(run1.get("registered", [])).size() == 2, "registers both translations")
	var run2 = pt.sync_localization({"csv_path": csv})
	_check(Array(run2.get("registered", [])).is_empty(), "re-run registers nothing (idempotent)")
	_check(int(run2.get("already_registered", 0)) == 2, "re-run sees them as already registered")

	# Leave project settings as they were: this fixture is committed.
	ProjectSettings.set_setting("internationalization/locale/translations", before)
	ProjectSettings.save()
	pt.free()
	_rmdir(dir)

# Multiplayer scaffolding: spawner, synchronizer, @rpc wiring, lobby generation.
# The synchronizer case is the one that matters — its replicated property list
# lives in a SceneReplicationConfig sub-resource, so "it saved without error" is
# not enough; the config has to survive the round-trip to disk.
func _test_netcode_scaffolding() -> void:
	print("
[netcode scaffolding]")
	var nt = preload("res://addons/godot_mcp/tools/netcode_tools.gd").new()
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var dir := "res://__gdtest_net"
	_rmdir(dir)
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir))

	var player := dir + "/player.tscn"
	st.create_scene({"scene_path": player, "root_node_type": "CharacterBody2D", "root_node_name": "NetPlayer"})
	var game := dir + "/game.tscn"
	st.create_scene({"scene_path": game, "root_node_type": "Node2D", "root_node_name": "Game",
		"nodes": [{"name": "Players", "type": "Node2D"}]})

	# --- spawner ---
	var sp = nt.mp_add_spawner({"scene_path": game, "parent_path": ".",
		"spawn_path": "../Players", "spawnable_scenes": [player]})
	_check(sp.get("ok", false), "mp_add_spawner returns ok")

	# A spawnable scene that does not exist must be rejected BEFORE the node is
	# added, otherwise a failed call still mutates an open scene.
	var bad = nt.mp_add_spawner({"scene_path": game, "parent_path": ".", "node_name": "BadSpawner",
		"spawn_path": "../Players", "spawnable_scenes": ["res://__nope_does_not_exist.tscn"]})
	_check(not bad.get("ok", true), "mp_add_spawner rejects a missing spawnable scene")
	var after_bad := FileAccess.open(game, FileAccess.READ)
	var game_text := after_bad.get_as_text()
	after_bad.close()
	_check(not game_text.contains("BadSpawner"), "rejected spawner left nothing behind")

	# --- synchronizer ---
	var sy = nt.mp_add_synchronizer({"scene_path": player, "parent_path": ".",
		"properties": [".:position", {"path": "velocity", "spawn": false}]})
	_check(sy.get("ok", false), "mp_add_synchronizer returns ok")
	# A bare "velocity" should have been normalised to ".:velocity".
	var props: Array = sy.get("properties", [])
	_check(props.has(".:velocity"), "bare property name normalised to '.:velocity'")

	var packed = ResourceLoader.load(player, "", ResourceLoader.CACHE_MODE_IGNORE)
	var inst = packed.instantiate() if packed else null
	var sync_node = inst.get_node_or_null("MultiplayerSynchronizer") if inst else null
	_check(sync_node != null, "synchronizer node persisted to disk")
	if sync_node:
		var cfg = sync_node.replication_config
		_check(cfg != null, "replication_config resource persisted")
		if cfg:
			_check(cfg.has_property(NodePath(".:position")), "replicated property survives the round-trip")
	if inst:
		inst.free()

	# --- rpc wiring ---
	var script_path := dir + "/net.gd"
	var f := FileAccess.open(script_path, FileAccess.WRITE)
	f.store_string("extends Node
")
	f.close()
	var rpc = nt.mp_wire_rpc({"script_path": script_path, "method": "broadcast_hit",
		"mode": "any_peer", "params": [{"name": "damage", "type": "int"}]})
	_check(rpc.get("ok", false), "mp_wire_rpc returns ok")
	var rf := FileAccess.open(script_path, FileAccess.READ)
	var rpc_text := rf.get_as_text()
	rf.close()
	_check(rpc_text.contains('@rpc("any_peer", "reliable")'), "annotation matches the requested mode")
	_check(rpc_text.contains("func broadcast_hit(damage: int)"), "typed parameter written")
	var dup = nt.mp_wire_rpc({"script_path": script_path, "method": "broadcast_hit"})
	_check(not dup.get("ok", true), "mp_wire_rpc refuses to redefine an existing method")

	# --- lobby ---
	var lobby := dir + "/lobby.gd"
	var lb = nt.mp_scaffold_lobby({"script_path": lobby, "port": 9999, "max_clients": 4})
	_check(lb.get("ok", false), "mp_scaffold_lobby returns ok")
	var lf := FileAccess.open(lobby, FileAccess.READ)
	var lobby_text := lf.get_as_text()
	lf.close()
	_check(lobby_text.contains("const PORT := 9999"), "lobby uses the requested port")
	_check(lobby_text.contains("ENetMultiplayerPeer"), "lobby wires an ENet peer")
	var again = nt.mp_scaffold_lobby({"script_path": lobby})
	_check(not again.get("ok", true), "mp_scaffold_lobby refuses to overwrite")

	nt.free()
	st.free()
	_rmdir(dir)

# C# capability detection. The headless harness runs the STANDARD Godot build,
# so this asserts the negative case: it must report C# as unusable rather than
# letting an agent write .cs files that can never load.
func _test_csharp_status() -> void:
	print("
[csharp_status]")
	var ft = preload("res://addons/godot_mcp/tools/file_tools.gd").new()
	var st = ft.csharp_status({})
	_check(st.get("ok", false), "csharp_status returns ok")
	_check(st.has("csharp_usable"), "reports csharp_usable")
	# ClassDB is the source of truth; assert the tool agrees with it either way,
	# so this passes on a .NET build too instead of hard-coding one environment.
	var expected := ClassDB.class_exists("CSharpScript")
	_check(st.get("editor_supports_csharp", not expected) == expected,
		"editor_supports_csharp matches ClassDB (%s)" % str(expected))
	if not expected:
		_check(not st.get("csharp_usable", true), "C# reported unusable on a non-.NET build")
		_check((st.get("blockers", []) as Array).size() > 0, "a blocker is explained")
		# And creating a script must carry the warning rather than a bare success.
		var path := "res://__gdtest_cs_probe.cs"
		_rm(path)
		var made = ft.create_csharp_script({"path": path, "class_name": "ProbeScript"})
		_check(made.get("ok", false), "create_csharp_script still writes the file")
		_check(made.has("warning"), "create_csharp_script warns C# cannot run here")
		_rm(path)
	ft.free()

# Port resolution for the WebSocket bridge. The addon used to hardcode 6505 with
# no override, which meant one project at a time and any editor attaching to any
# listening server. Precedence must be: env var, then project setting, then the
# default — and an out-of-range value must fall through rather than be obeyed.
func _test_port_resolution() -> void:
	print("
[port resolution]")
	var client = preload("res://addons/godot_mcp/mcp_client.gd")
	var key: String = client.PORT_SETTING
	var had_setting := ProjectSettings.has_setting(key)
	var old_setting: Variant = ProjectSettings.get_setting(key) if had_setting else null

	# Clean slate: no env, no setting.
	OS.set_environment("GODOT_MCP_PORT", "")
	if had_setting:
		ProjectSettings.set_setting(key, null)
	_check(client.resolve_port() == client.DEFAULT_PORT, "falls back to %d" % client.DEFAULT_PORT)
	_check(client.default_url() == "ws://127.0.0.1:%d" % client.DEFAULT_PORT, "default_url uses the resolved port")

	# Project setting alone.
	ProjectSettings.set_setting(key, 7100)
	_check(client.resolve_port() == 7100, "project setting is honoured")

	# Env var wins over the setting, so a headless/CI editor can be redirected
	# without dirtying project.godot.
	OS.set_environment("GODOT_MCP_PORT", "7200")
	_check(client.resolve_port() == 7200, "env var overrides the project setting")
	_check(client.default_url() == "ws://127.0.0.1:7200", "default_url follows the env var")

	# Garbage must not silently become port 0 (which would bind a random port).
	OS.set_environment("GODOT_MCP_PORT", "not-a-number")
	_check(client.resolve_port() == 7100, "non-numeric env var falls through to the setting")
	OS.set_environment("GODOT_MCP_PORT", "99999")
	_check(client.resolve_port() == 7100, "out-of-range env var falls through to the setting")

	OS.set_environment("GODOT_MCP_PORT", "")
	ProjectSettings.set_setting(key, 0)
	_check(client.resolve_port() == client.DEFAULT_PORT, "out-of-range setting falls through to the default")

	# Restore.
	if had_setting:
		ProjectSettings.set_setting(key, old_setting)
	else:
		ProjectSettings.set_setting(key, null)


# validate_script used to report every addon file that trips a promoted warning
# as a syntax error. The throwaway script it compiles had no resource_path, so it
# lost the `exclude_addons` warning exemption that the real file gets, and any
# warning the project promotes to an error (this one promotes inference_on_variant)
# failed the compile with ERR_PARSE_ERROR and an empty error list.
func _test_validate_addon_scripts() -> void:
	print("
[validate_script — addon warning exemption]")
	var scr = preload("res://addons/godot_mcp/tools/script_tools.gd").new()

	# The real regression: a large addon file that compiles fine in the editor.
	var target := "res://addons/godot_mcp/tools/scene_tools.gd"
	var r = scr.validate_script({"path": target})
	_check(r.get("valid", false), "addon script with promoted warnings validates as valid")

	# Every shipped addon script, so a new file that trips this can't slip in.
	var sweep = scr.validate_scripts({"paths": [
		"res://addons/godot_mcp/tools/scene_tool_base.gd",
		"res://addons/godot_mcp/tools/tilemap_tools.gd",
		"res://addons/godot_mcp/tools/script_tools.gd",
	]})
	_check(int(sweep.get("invalid_count", -1)) == 0, "addon sweep reports 0 invalid")

	# And it must still fail a genuinely broken file, or the fix just made the
	# validator blind.
	var bad := "res://__gdtest_validate_broken.gd"
	var f := FileAccess.open(bad, FileAccess.WRITE)
	f.store_string("extends Node
func bad():
	var x = = 5
")
	f.close()
	var rb = scr.validate_script({"path": bad})
	_check(not rb.get("valid", true), "a real syntax error is still reported invalid")
	_rm(bad)

	# The temp compile must not leave files behind next to the real ones.
	_check(not FileAccess.file_exists("res://addons/godot_mcp/tools/__mcp_validate_1.gd"),
		"no throwaway validation file written to disk")
	scr.free()


# A property can exist, accept the assignment, and still hold something else:
# Godot clamps and coerces without a word. The case that motivated this: a
# TextureRect asked for size.y = 6.667 keeps 16, because a Control's minimum size
# is its texture's. Building a level, that turned into grass strips three times
# too tall, and nothing anywhere said so.
func _test_property_readback_reports_clamping() -> void:
	print("\n[property readback]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_readback.tscn"
	_rm(scene)

	# A Control whose minimum size will fight the requested one.
	var r: Dictionary = st.create_scene({"scene_path": scene, "root_node_type": "Node2D",
		"root_node_name": "Root",
		"nodes": [{"name": "Panel", "type": "ColorRect",
			"properties": {"custom_minimum_size": {"type": "Vector2", "x": 100, "y": 100},
				"size": {"type": "Vector2", "x": 10, "y": 10}}}]})
	_check(r.has("warnings"), "a clamped size comes back as a warning")
	if r.has("warnings"):
		_check(str(r.get("warnings")).contains("size"), "and the warning names the property")

	# An int property written with the float every JSON client sends must NOT be
	# reported as a mismatch. This exact comparison shipped broken once already
	# (1.1.5: collision_layer "set had no effect"), and writing a second copy of
	# _values_match re-broke it — hence one implementation, in the base, and this
	# test standing over it.
	var ints: Dictionary = st.add_node({"scene_path": scene, "node_name": "Body",
		"node_type": "CharacterBody2D", "parent_path": ".",
		"properties": {"collision_layer": 4, "collision_mask": 1}})
	_check(not ints.has("warnings"), "an int property written from JSON is not a mismatch")

	# A value that lands exactly must stay silent, or the warning is noise.
	var clean: Dictionary = st.add_node({"scene_path": scene, "node_name": "Plain",
		"node_type": "Node2D", "parent_path": ".",
		"properties": {"position": {"type": "Vector2", "x": 40, "y": 60}}})
	_check(not clean.has("warnings"), "a value that lands exactly warns about nothing")

	_rm(scene)
	st.free()


# The plural sweep. It shares _validate_one, so the false positives are already
# covered — what is tested here is the sweep's own behaviour: what it reports for
# a broken file (a bare error_code with an empty errors array told the caller
# nothing), and that it does not walk the whole addon by default. Validation
# costs ~34ms per script on the editor's main thread, so an unbounded sweep on a
# large project can approach the bridge's 20s watchdog.
func _test_validate_scripts_sweep() -> void:
	print("\n[validate_scripts — sweep]")
	var scr = preload("res://addons/godot_mcp/tools/script_tools.gd").new()

	var bad := "res://__gdtest_sweep_broken.gd"
	_write_text(bad, "extends Node\n\nfunc hi() -> void\n\tpass\n")
	var r: Dictionary = scr.validate_scripts({"paths": [bad]})
	_check(int(r.get("invalid_count", 0)) == 1, "an explicit path list reports the broken file")
	var entry: Dictionary = r.get("invalid", [{}])[0]
	_check(entry.has("message"), "the invalid entry carries a message")
	_check(not str(entry.get("message", "")).is_empty(), "and the message is not empty")
	_check(r.has("elapsed_ms"), "the sweep reports its own cost")
	_rm(bad)

	# addons/ is the bulk of most projects and is not the caller's code.
	var own: Dictionary = scr.validate_scripts({})
	var with_addons: Dictionary = scr.validate_scripts({"include_addons": true})
	_check(int(own.get("total", 0)) < int(with_addons.get("total", 0)),
		"the default sweep skips addons/ and include_addons brings them back")
	for e in own.get("invalid", []):
		_check(not str(e.get("path", "")).begins_with("res://addons/"),
			"no addon path in the default sweep")

	scr.free()


# Wiring one node into another node's exported slot. There was no way to do this
# through the tools at all — an @export typed as a node takes an object, and
# every property tool takes a JSON value — so building a game with them meant
# rewriting the game's components to find each other at runtime instead.
func _test_set_node_reference() -> void:
	print("\n[set_node_reference]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var script_path := "res://__gdtest_ref.gd"
	var scene := "res://__gdtest_ref.tscn"
	_rm(scene)
	_write_text(script_path, "@tool\nextends Node2D\n\n@export var target: Node2D\n@export var target_path: NodePath\n")

	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root",
		"nodes": [{"name": "Holder", "type": "Node2D", "script": script_path},
			{"name": "Marker", "type": "Marker2D"}]})

	# A node-typed export gets the node itself; Godot writes it out as a NodePath.
	var r: Dictionary = st.set_node_reference({"scene_path": scene, "node_path": "Holder",
		"property": "target", "target_path": "Marker"})
	_check(r.get("ok", false), "points a node-typed export at another node")
	_check(str(r.get("stored_as", "")) == "node reference", "and reports how it was stored")
	_check(FileAccess.get_file_as_string(scene).contains("target = NodePath(\"../Marker\")"),
		"the .tscn holds the resolved NodePath")

	# A NodePath-typed export gets the path, relative to the holder.
	var rp: Dictionary = st.set_node_reference({"scene_path": scene, "node_path": "Holder",
		"property": "target_path", "target_path": "Marker"})
	_check(rp.get("ok", false), "points a NodePath-typed export at another node")
	_check(str(rp.get("stored_as", "")) == "NodePath", "and knows it stored a NodePath")

	# The failures have to be loud, or this repeats the silent-drop bug.
	var missing: Dictionary = st.set_node_reference({"scene_path": scene, "node_path": "Holder",
		"property": "no_such_export", "target_path": "Marker"})
	_check(not missing.get("ok", true), "an unknown property is rejected, not ignored")
	_check(str(missing.get("error", "")).contains("target"),
		"and the error lists the node-typed properties that DO exist")

	var no_target: Dictionary = st.set_node_reference({"scene_path": scene, "node_path": "Holder",
		"property": "target", "target_path": "NotHere"})
	_check(not no_target.get("ok", true), "a missing target node is rejected")

	_rm(scene)
	_rm(script_path)
	st.free()


# An exported property set in the SAME call that attaches the script used to be
# dropped on the floor: properties were applied before set_script, so the
# property did not exist yet, and the response still said ok. A boss scene was
# built with max_health 400 and shipped with 100.
func _test_properties_apply_after_script_attaches() -> void:
	print("\n[exported properties survive script attachment]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var script_path := "res://__gdtest_exported.gd"
	var scene := "res://__gdtest_exported.tscn"
	_rm(scene)
	_write_text(script_path, "@tool\nextends Node2D\n\n@export var max_health: int = 100\n@export var label_text: String = \"default\"\n")

	# 1. create_scene, script and properties on a CHILD in one call.
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root",
		"nodes": [{"name": "Kid", "type": "Node2D", "script": script_path,
			"properties": {"max_health": 400, "label_text": "set"}}]})
	var text := FileAccess.get_file_as_string(scene)
	_check(text.contains("max_health = 400"), "child: exported int survives the same call as its script")
	_check(text.contains("label_text = \"set\""), "child: exported String survives too")

	# 2. add_node, same thing on a node added later.
	st.add_node({"scene_path": scene, "node_name": "Second", "node_type": "Node2D",
		"parent_path": ".", "script": script_path, "properties": {"max_health": 250}})
	_check(FileAccess.get_file_as_string(scene).contains("max_health = 250"),
		"add_node: exported property survives the same call as its script")

	# 3. A property that genuinely does not exist must be REPORTED, not ignored.
	var r: Dictionary = st.add_node({"scene_path": scene, "node_name": "Third", "node_type": "Node2D",
		"parent_path": ".", "script": script_path, "properties": {"no_such_property_at_all": 1}})
	_check(r.has("warnings"), "an unknown property comes back as a warning")
	_check(str(r.get("warnings", [])).contains("no_such_property_at_all"),
		"and the warning names the property that was dropped")

	# 4. A clean call must stay clean — no warnings key when nothing was dropped.
	var clean: Dictionary = st.add_node({"scene_path": scene, "node_name": "Fourth", "node_type": "Node2D",
		"parent_path": ".", "script": script_path, "properties": {"max_health": 5}})
	_check(not clean.has("warnings"), "a call with nothing dropped carries no warnings")

	_rm(scene)
	_rm(script_path)
	st.free()


# The false positives that made this tool unusable on a real project: it called
# 4 of 4 healthy scripts broken. Both causes were the same mistake — compiling
# the file in ISOLATION, where a project's autoloads and global classes do not
# exist. Found by building a game with it, not by reading the code.
func _test_validate_script_sees_project_context() -> void:
	print("\n[validate_script — project context]")
	var scr = preload("res://addons/godot_mcp/tools/script_tools.gd").new()

	# A singleton only exists at runtime, so an isolated compile cannot resolve
	# it. This is the one that reported err 36 on every file touching GameState.
	var uses_autoload := "res://__gdtest_v_autoload.gd"
	_write_text(uses_autoload, "extends Node\n\nfunc hi() -> void:\n\tMCPRuntime.push_runtime_log(\"info\", \"x\")\n")
	_check(scr.validate_script({"path": uses_autoload}).get("valid", false),
		"a script calling an autoload validates as valid")
	_rm(uses_autoload)

	# Extending a class_name from another file — reported err 43 before.
	var extends_global := "res://__gdtest_v_global.gd"
	_write_text(extends_global, "@tool\nextends SceneToolBase\n\nfunc hi() -> void:\n\tpass\n")
	_check(scr.validate_script({"path": extends_global}).get("valid", false),
		"a script extending a registered global class validates as valid")
	_rm(extends_global)

	# Declaring a class_name is not an error either, even though the name is
	# already registered for this very file.
	var declares_name := "res://__gdtest_v_named.gd"
	_write_text(declares_name, "class_name GdTestValidateNamed\nextends Node\n\nfunc hi() -> void:\n\tpass\n")
	_check(scr.validate_script({"path": declares_name}).get("valid", false),
		"a script declaring a class_name validates as valid")
	_rm(declares_name)

	# ...and the other half: it must still catch every kind of real breakage.
	# A validator with no false positives and no true positives is just `true`.
	var broken := {
		"res://__gdtest_v_syntax.gd": "extends Node\n\nfunc hi() -> void\n\tpass\n",
		"res://__gdtest_v_undefined.gd": "extends Node\n\nfunc hi() -> void:\n\tno_such_function()\n",
		"res://__gdtest_v_badbase.gd": "extends NoSuchBaseClassAnywhere\n\nfunc hi() -> void:\n\tpass\n",
		"res://__gdtest_v_badtype.gd": "extends Node\n\nfunc hi() -> void:\n\tvar x: int = \"not an int\"\n",
	}
	for path in broken:
		_write_text(path, broken[path])
		_check(not scr.validate_script({"path": path}).get("valid", true),
			"still invalid: %s" % String(path).get_file())
		_rm(path)

	scr.free()


# TileMap cell editing. Every one of these goes through the tile_map_data
# snapshot added for undo, and none had a test — the disk path at least proves
# the calls behave and read back.
func _test_tilemap_cells() -> void:
	print("\n[tilemap cells]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var tm = preload("res://addons/godot_mcp/tools/tilemap_tools.gd").new()
	var scene := "res://__gdtest_tilemap.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Layer", "node_type": "TileMapLayer", "parent_path": "."})

	var sc = tm.tilemap_set_cell({"scene_path": scene, "node_path": "Layer",
		"coords": {"x": 1, "y": 2}, "source_id": 0})
	_check(sc.has("ok"), "tilemap_set_cell returns a status")

	var info = tm.tilemap_get_info({"scene_path": scene, "node_path": "Layer"})
	_check(info.get("ok", false), "tilemap_get_info ok")

	var got = tm.tilemap_get_cell({"scene_path": scene, "node_path": "Layer", "coords": {"x": 1, "y": 2}})
	_check(got.get("ok", false), "tilemap_get_cell ok")
	_check(got.has("is_empty"), "tilemap_get_cell reports emptiness")

	var cleared = tm.tilemap_clear({"scene_path": scene, "node_path": "Layer"})
	_check(cleared.get("ok", false), "tilemap_clear ok")

	var used = tm.tilemap_get_used_cells({"scene_path": scene, "node_path": "Layer"})
	_check(used.get("ok", false), "tilemap_get_used_cells ok")
	_check(int(used.get("cell_count", -1)) == 0, "no used cells after clear")

	# Wrong node type must be refused, not silently ignored.
	var bad = tm.tilemap_set_cell({"scene_path": scene, "node_path": ".", "coords": {"x": 0, "y": 0}})
	_check(not bad.get("ok", true), "tilemap_set_cell refuses a non-TileMapLayer")

	tm.free()
	st.free()
	_rm(scene)

# AnimationPlayer authoring: create, track, keyframe, remove.
func _test_animation_authoring() -> void:
	print("\n[animation authoring]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var an = preload("res://addons/godot_mcp/tools/animation_tools.gd").new()
	var scene := "res://__gdtest_anim.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Anim", "node_type": "AnimationPlayer", "parent_path": "."})
	st.add_node({"scene_path": scene, "node_name": "Spr", "node_type": "Sprite2D", "parent_path": "."})

	var cr = an.create_animation({"scene_path": scene, "node_path": "Anim",
		"animation_name": "walk", "length": 2.0, "loop": true})
	_check(cr.get("ok", false), "create_animation ok")

	var dup = an.create_animation({"scene_path": scene, "node_path": "Anim", "animation_name": "walk"})
	_check(not dup.get("ok", true), "create_animation refuses a duplicate name")

	var lst = an.list_animations({"scene_path": scene, "node_path": "Anim"})
	_check(int(lst.get("animation_count", 0)) == 1, "animation persisted to disk")

	var tr = an.add_animation_track({"scene_path": scene, "node_path": "Anim",
		"animation_name": "walk", "track_type": "value",
		"track_node_path": "Spr", "property": "position"})
	_check(tr.get("ok", false), "add_animation_track ok")
	var track_idx := int(tr.get("track_index", -1))
	_check(track_idx >= 0, "track index returned")

	var kf = an.set_animation_keyframe({"scene_path": scene, "node_path": "Anim",
		"animation_name": "walk", "track_index": track_idx, "time": 0.5,
		"value": {"x": 10, "y": 20}})
	_check(kf.get("ok", false), "set_animation_keyframe ok")

	var gi = an.get_animation_info({"scene_path": scene, "node_path": "Anim", "animation_name": "walk"})
	_check(int(gi.get("length", 0)) == 2, "length round-tripped through the file")
	_check(gi.get("loop", false), "loop flag round-tripped")

	var rm = an.remove_animation({"scene_path": scene, "node_path": "Anim", "animation_name": "walk"})
	_check(rm.get("ok", false), "remove_animation ok")
	_check(int(an.list_animations({"scene_path": scene, "node_path": "Anim"}).get("animation_count", -1)) == 0,
		"animation gone after removal")

	an.free()
	st.free()
	_rm(scene)

# edit_script and rename_file both write irreversibly and had no coverage.
func _test_script_rewrites() -> void:
	print("\n[script rewrites]")
	var sc = preload("res://addons/godot_mcp/tools/script_tools.gd").new()
	var path := "res://__gdtest_edit.gd"
	_rm(path)
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string("extends Node\n\nfunc greet() -> String:\n\treturn \"hello\"\n")
	f.close()

	var ed = sc.edit_script({"edit": {"file": path, "type": "snippet_replace",
		"old_snippet": "return \"hello\"", "new_snippet": "return \"goodbye\""}})
	_check(ed.get("ok", false), "edit_script ok")
	var body := FileAccess.get_file_as_string(path)
	_check(body.contains("goodbye"), "edit landed on disk")
	_check(not body.contains("hello"), "old text replaced")

	var miss = sc.edit_script({"edit": {"file": path, "type": "snippet_replace",
		"old_snippet": "nothing_like_this_exists", "new_snippet": "x"}})
	_check(not miss.get("ok", true), "edit_script reports a snippet it cannot find")

	var moved := "res://__gdtest_edit_renamed.gd"
	_rm(moved)
	# update_references defaults to TRUE and rewrites every file that mentions the
	# old path — including THIS ONE, which names it as a literal. Left on, the
	# suite silently edited its own source on each run and then failed on the
	# next. Turned off here so the test measures the rename, not the sweep.
	var rn = sc.rename_file({"old_path": path, "new_path": moved, "update_references": false})
	_check(rn.get("ok", false), "rename_file ok")
	_check(FileAccess.file_exists(moved) and not FileAccess.file_exists(path), "file actually moved")

	_rm(moved)
	sc.free()

# Project settings are global and carry no undo entry at all.
func _test_project_config() -> void:
	print("\n[project config]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()
	var key := "application/config/custom_gdtest_value"
	var had := ProjectSettings.has_setting(key)

	var up = pt.update_project_settings({"settings": {key: "probe"}})
	_check(up.get("ok", false), "update_project_settings ok")
	_check(str(ProjectSettings.get_setting(key, "")) == "probe", "setting applied in-process")

	var ls = pt.list_settings({"filter": "custom_gdtest"})
	_check(ls.get("ok", false), "list_settings ok")

	var res_path := "res://__gdtest_res.tres"
	_rm(res_path)
	var res = pt.create_resource({"resource_path": res_path, "resource_type": "GradientTexture1D"})
	_check(res.get("ok", false), "create_resource ok")
	_check(FileAccess.file_exists(res_path), "resource written to disk")
	_rm(res_path)

	var bad = pt.create_resource({"resource_path": "res://__gdtest_bad.tres", "resource_type": "NotARealClass"})
	_check(not bad.get("ok", true), "create_resource refuses an unknown type")

	# update_project_settings calls ProjectSettings.save(), so clearing the value
	# in memory is not enough — without saving again the probe key stays in
	# project.godot and shows up as a dirty file after every test run.
	if not had:
		ProjectSettings.set_setting(key, null)
		ProjectSettings.save()
	_check(not ProjectSettings.has_setting(key), "probe setting removed from project.godot")
	pt.free()

# Bulk edits and project-wide renames — the widest blast radius here.
func _test_bulk_and_rename() -> void:
	print("\n[bulk edits + project-wide rename]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var bt = preload("res://addons/godot_mcp/tools/batch_tools.gd").new()
	var scene := "res://__gdtest_bulk.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	for n in ["A", "B", "C"]:
		st.add_node({"scene_path": scene, "node_name": n, "node_type": "Sprite2D", "parent_path": "."})

	var found = bt.find_nodes_by_type({"scene_path": scene, "node_type": "Sprite2D"})
	_check(int(found.get("count", 0)) == 3, "find_nodes_by_type finds all three")

	var bulk = bt.batch_set_property({"scene_path": scene,
		"node_paths": ["A", "B", "C"], "property_name": "visible", "value": false})
	_check(bulk.get("ok", false), "batch_set_property ok")
	_check(FileAccess.get_file_as_string(scene).contains("visible = false"), "bulk edit persisted")

	var deps = bt.get_scene_dependencies({"scene_path": scene})
	_check(deps.get("ok", false), "get_scene_dependencies ok")

	# rename_symbol_project_wide walks the whole project, so it is scoped to a
	# throwaway subfolder via 'root'. Run unscoped it rewrites THIS FILE — which
	# is exactly what happened the first time, silently replacing the literals
	# below and corrupting the test on its next run.
	var rdir := "res://__gdtest_rename"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(rdir))
	var target := rdir + "/target.gd"
	_rm(target)
	var f := FileAccess.open(target, FileAccess.WRITE)
	f.store_string("extends Node\n\nvar zzq_probe := 1\n\nfunc use() -> int:\n\treturn zzq_probe\n")
	f.close()

	var preview = bt.rename_symbol_project_wide({"old_name": "zzq_probe", "new_name": "zzq_renamed", "root": rdir})
	_check(preview.get("ok", false), "rename preview ok")
	_check(FileAccess.get_file_as_string(target).contains("zzq_probe"),
		"dry_run preview did NOT touch the file")

	var applied = bt.rename_symbol_project_wide({"old_name": "zzq_probe", "new_name": "zzq_renamed", "root": rdir, "dry_run": false})
	_check(applied.get("ok", false), "rename applied ok")
	_check(int(applied.get("file_count", -1)) == 1, "rename stayed inside the scoped root")
	var after := FileAccess.get_file_as_string(target)
	_check(after.contains("zzq_renamed") and not after.contains("zzq_probe"), "symbol renamed on disk")

	_rm(target)
	DirAccess.remove_absolute(ProjectSettings.globalize_path(rdir))
	bt.free()
	st.free()
	_rm(scene)

# =============================================================================
# Coverage for mutating tools that had none.
#
# Every tool below writes: to a scene, a resource file, or project.godot. Each
# case creates its own target, exercises the tool's disk path, reads the result
# back from disk, and cleans up. Anything touching project.godot restores it —
# a test that leaves the fixture dirty fails the NEXT run, which is how two
# earlier tests in this file corrupted the suite.
# =============================================================================

func _test_3d_authoring() -> void:
	print("\n[3D authoring]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var s3 = preload("res://addons/godot_mcp/tools/scene3d_tools.gd").new()
	var scene := "res://__gdtest_3d.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node3D", "root_node_name": "World"})

	var mesh = s3.add_mesh_instance({"scene_path": scene, "mesh_type": "box", "node_name": "Crate"})
	_check(mesh.get("ok", false), "add_mesh_instance ok")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("MeshInstance3D") and txt.contains("BoxMesh"), "mesh node and its mesh resource persisted")

	var bad_mesh = s3.add_mesh_instance({"scene_path": scene, "mesh_type": "dodecahedron"})
	_check(not bad_mesh.get("ok", true), "unknown mesh_type is rejected")

	var light = s3.setup_lighting({"scene_path": scene, "preset": "sun"})
	_check(light.get("ok", false), "setup_lighting ok")
	_check(FileAccess.get_file_as_string(scene).contains("DirectionalLight3D"), "sun preset added a directional light")
	_check(not s3.setup_lighting({"scene_path": scene, "preset": "disco"}).get("ok", true), "unknown lighting preset is rejected")

	var cam = s3.setup_camera_3d({"scene_path": scene, "node_name": "Eye", "projection": "orthogonal"})
	_check(cam.get("ok", false), "setup_camera_3d ok")
	_check(FileAccess.get_file_as_string(scene).contains("Camera3D"), "camera persisted")

	s3.free()
	st.free()
	_rm(scene)

func _test_physics_presets() -> void:
	print("\n[physics presets]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var ph = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var scene := "res://__gdtest_physpreset.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "CharacterBody2D", "root_node_name": "Body"})

	var col = ph.setup_collision({"scene_path": scene, "node_path": ".", "shape_type": "circle", "node_name": "Hitbox"})
	_check(col.get("ok", false), "setup_collision ok")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("CollisionShape2D") and txt.contains("CircleShape2D"), "collision node has a real shape resource")

	# A named preset must round-trip: define it, then apply it by name.
	var defined = ph.set_collision_preset({"name": "gdtest_enemy", "collision_layer": [3], "collision_mask": [1, 2]})
	_check(defined.get("ok", false), "set_collision_preset ok")
	var applied = ph.apply_collision_preset({"scene_path": scene, "node_path": ".", "name": "gdtest_enemy"})
	_check(applied.get("ok", false), "apply_collision_preset ok")
	var info = ph.get_collision_info({"scene_path": scene, "node_path": "."})
	_check(int(info.get("collision_layer", 0)) == 4, "preset layer applied (layer 3 -> bit 4)")
	_check(int(info.get("collision_mask", 0)) == 3, "preset mask applied (layers 1+2 -> bits 3)")
	_check(not ph.apply_collision_preset({"scene_path": scene, "node_path": ".", "name": "nope"}).get("ok", true), "unknown preset name is rejected")

	# set_collision_preset writes the preset into project.godot; drop it again so
	# the committed fixture stays clean (a dirty fixture fails the NEXT run).
	ProjectSettings.set_setting("mcp_presets/collision/gdtest_enemy", null)
	ProjectSettings.save()
	_check(not ProjectSettings.has_setting("mcp_presets/collision/gdtest_enemy"), "test preset removed from project.godot")

	ph.free()
	st.free()
	_rm(scene)

func _test_particles_and_audio() -> void:
	print("\n[particles + audio]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var pa = preload("res://addons/godot_mcp/tools/particle_tools.gd").new()
	var au = preload("res://addons/godot_mcp/tools/audio_tools.gd").new()
	var scene := "res://__gdtest_fx.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})

	var made = pa.create_particles({"scene_path": scene, "dimension": "2D", "node_name": "Sparks", "amount": 32})
	_check(made.get("ok", false), "create_particles ok")
	_check(FileAccess.get_file_as_string(scene).contains("GPUParticles2D"), "particle node persisted")

	var preset = pa.apply_particle_preset({"scene_path": scene, "node_path": "Sparks", "preset": "fire"})
	_check(preset.get("ok", false), "apply_particle_preset ok")
	_check(not pa.apply_particle_preset({"scene_path": scene, "node_path": "Sparks", "preset": "confetti"}).get("ok", true), "unknown particle preset is rejected")

	var pinfo = pa.get_particle_info({"scene_path": scene, "node_path": "Sparks"})
	_check(pinfo.get("ok", false), "get_particle_info reads the configured node")

	var player = au.add_audio_player({"scene_path": scene, "node_name": "Music", "player_type": ""})
	_check(player.get("ok", false), "add_audio_player ok")
	_check(FileAccess.get_file_as_string(scene).contains("AudioStreamPlayer"), "audio player persisted")

	au.free()
	pa.free()
	st.free()
	_rm(scene)

func _test_theme_and_shader_resources() -> void:
	print("\n[theme + shader resources]")
	var th = preload("res://addons/godot_mcp/tools/theme_tools.gd").new()
	var sh = preload("res://addons/godot_mcp/tools/shader_tools.gd").new()
	var theme := "res://__gdtest_theme.tres"
	var shader := "res://__gdtest_shader.gdshader"
	_rm(theme)
	_rm(shader)

	var made = th.create_theme({"theme_path": theme})
	_check(made.get("ok", false), "create_theme ok")
	_check(FileAccess.file_exists(theme), "theme written to disk")

	var colored = th.set_theme_color({"theme_path": theme, "control_type": "Button", "color_name": "font_color", "color": {"r": 1, "g": 0, "b": 0, "a": 1}})
	_check(colored.get("ok", false), "set_theme_color ok")
	var sized = th.set_theme_font_size({"theme_path": theme, "control_type": "Button", "font_size_name": "font_size", "value": 24})
	_check(sized.get("ok", false), "set_theme_font_size ok")
	var tinfo = th.get_theme_info({"theme_path": theme})
	_check(tinfo.get("ok", false), "get_theme_info reads the theme back")

	var shader_made = sh.create_shader({"shader_path": shader, "shader_type": "canvas_item"})
	_check(shader_made.get("ok", false), "create_shader ok")
	_check(FileAccess.get_file_as_string(shader).contains("shader_type canvas_item"), "shader body written")

	# edit_shader is a snippet replace, not a whole-file write.
	var edited = sh.edit_shader({
		"shader_path": shader,
		"old_code_snippet": "void fragment()",
		"new_code_snippet": "uniform float amount = 0.5;\n\nvoid fragment()",
	})
	_check(edited.get("ok", false), "edit_shader ok")
	_check(FileAccess.get_file_as_string(shader).contains("uniform float amount"), "the snippet edit landed in the file")

	# get_shader_params reads a NODE's ShaderMaterial, not the .gdshader file, so
	# the shader has to be assigned to something first.
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_shaderuse.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "Sprite2D", "node_name": "Painted"})

	var assigned = sh.assign_shader_material({"scene_path": scene, "node_path": "Painted", "shader_path": shader})
	_check(assigned.get("ok", false), "assign_shader_material ok")

	var params = sh.get_shader_params({"scene_path": scene, "node_path": "Painted"})
	_check(params.get("ok", false), "get_shader_params ok")
	_check(str(params).contains("amount"), "the uniform added by the edit is discovered on the node")

	var set_param = sh.set_shader_param({"scene_path": scene, "node_path": "Painted", "param_name": "amount", "value": 0.25})
	_check(set_param.get("ok", false), "set_shader_param ok")

	st.free()
	sh.free()
	th.free()
	_rm(scene)
	_rm(theme)
	_rm(shader)

func _test_state_machine_authoring() -> void:
	print("\n[animation tree state machine]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var an = preload("res://addons/godot_mcp/tools/animation_tools.gd").new()
	var at = preload("res://addons/godot_mcp/tools/animation_tree_tools.gd").new()
	var scene := "res://__gdtest_atree.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "AnimationPlayer", "node_name": "Anim"})
	an.create_animation({"scene_path": scene, "node_path": "Anim", "animation_name": "idle", "length": 1.0})
	an.create_animation({"scene_path": scene, "node_path": "Anim", "animation_name": "run", "length": 1.0})

	var tree = at.create_animation_tree({"scene_path": scene, "anim_player_path": "Anim", "node_name": "Tree"})
	_check(tree.get("ok", false), "create_animation_tree ok")
	_check(FileAccess.get_file_as_string(scene).contains("AnimationTree"), "tree node persisted")

	var s1 = at.add_state_machine_state({"scene_path": scene, "node_path": "Tree", "state_name": "Idle", "animation_name": "idle"})
	_check(s1.get("ok", false), "add_state_machine_state ok")
	at.add_state_machine_state({"scene_path": scene, "node_path": "Tree", "state_name": "Run", "animation_name": "run"})

	var tr = at.add_state_machine_transition({"scene_path": scene, "node_path": "Tree", "from": "Idle", "to": "Run"})
	_check(tr.get("ok", false), "add_state_machine_transition ok")

	var structure = at.get_animation_tree_structure({"scene_path": scene, "node_path": "Tree"})
	_check(structure.get("ok", false), "get_animation_tree_structure ok")
	var dumped := str(structure)
	_check(dumped.contains("Idle") and dumped.contains("Run"), "both states are reported")

	var rm_tr = at.remove_state_machine_transition({"scene_path": scene, "node_path": "Tree", "from": "Idle", "to": "Run"})
	_check(rm_tr.get("ok", false), "remove_state_machine_transition ok")
	var rm_state = at.remove_state_machine_state({"scene_path": scene, "node_path": "Tree", "state_name": "Run"})
	_check(rm_state.get("ok", false), "remove_state_machine_state ok")
	_check(not str(at.get_animation_tree_structure({"scene_path": scene, "node_path": "Tree"})).contains("Run"), "removed state is gone from the structure")

	at.free()
	an.free()
	st.free()
	_rm(scene)

func _test_navigation_authoring() -> void:
	print("\n[navigation]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var nv = preload("res://addons/godot_mcp/tools/navigation_tools.gd").new()
	var scene := "res://__gdtest_nav.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Level"})

	var region = nv.setup_navigation_region({"scene_path": scene, "dimension": "2D", "node_name": "Nav"})
	_check(region.get("ok", false), "setup_navigation_region ok")
	_check(FileAccess.get_file_as_string(scene).contains("NavigationRegion2D"), "region persisted")
	_check(not nv.setup_navigation_region({"scene_path": scene, "dimension": "4D"}).get("ok", true), "invalid dimension is rejected")

	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "CharacterBody2D", "node_name": "Walker"})
	var agent = nv.setup_navigation_agent({"scene_path": scene, "parent_path": "Walker", "dimension": "2D"})
	_check(agent.get("ok", false), "setup_navigation_agent ok")
	_check(FileAccess.get_file_as_string(scene).contains("NavigationAgent2D"), "agent persisted")

	var layers = nv.set_navigation_layers({"scene_path": scene, "node_path": "Nav", "layers": [1, 2]})
	_check(layers.get("ok", false), "set_navigation_layers ok")
	var ninfo = nv.get_navigation_info({"scene_path": scene, "node_path": "Nav"})
	_check(ninfo.get("ok", false), "get_navigation_info reads it back")

	nv.free()
	st.free()
	_rm(scene)

func _test_tilemap_bulk() -> void:
	print("\n[tilemap bulk ops]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var tm = preload("res://addons/godot_mcp/tools/tilemap_tools.gd").new()
	var scene := "res://__gdtest_tmbulk.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "TileMapLayer", "node_name": "Ground"})

	# Painting on a layer with no TileSet stores the cells but nothing renders
	# them. Refusing would break the legitimate assign-the-TileSet-afterwards
	# flow, so the tool succeeds AND says so; plain success would be a silent
	# no-op, which is the shape this project treats as a bug.
	var no_tileset = tm.tilemap_fill_rect({
		"scene_path": scene, "node_path": "Ground",
		"from_coords": [0, 0], "to_coords": [2, 2], "source_id": 0,
	})
	_check(no_tileset.get("ok", false), "fill_rect works on a layer with no TileSet")
	_check(str(no_tileset.get("warning", "")).contains("no TileSet"), "but warns that the cells cannot render")
	_check(int(no_tileset.get("cells_filled", 0)) == 9, "filled the whole 3x3 rect")

	var single = tm.tilemap_set_cell({"scene_path": scene, "node_path": "Ground", "coords": [0, 0], "source_id": 0})
	_check(str(single.get("warning", "")).contains("no TileSet"), "set_cell warns too")

	var info = tm.tilemap_get_info({"scene_path": scene, "node_path": "Ground"})
	_check(info.get("ok", false), "tilemap_get_info ok on an empty layer")

	tm.free()
	st.free()
	_rm(scene)

func _test_input_map_and_autoloads() -> void:
	print("\n[input map + autoloads]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()
	var action := "gdtest_jump"

	var added = pt.configure_input_map({
		"action": action, "operation": "add",
		"events": [{"type": "key", "key": "Space"}],
	})
	_check(added.get("ok", false), "configure_input_map add ok")
	_check(InputMap.has_action(action), "action registered in the InputMap")
	_check(ProjectSettings.has_setting("input/" + action), "action persisted to project settings")

	var listed: Dictionary = pt.get_input_map({})
	_check(listed.get("ok", false), "get_input_map ok")
	_check(str(listed.get("actions", {}).get(action, {})).contains("Space"), "the bound key is reported")

	var replaced = pt.configure_input_map({
		"action": action, "operation": "set",
		"events": [{"type": "key", "key": "Enter"}],
	})
	_check(replaced.get("ok", false), "configure_input_map set ok")
	# "Space" also appears in built-in actions (ui_accept), so check THIS
	# action's events rather than the whole-map dump.
	var after_set: Dictionary = pt.get_input_map({})
	var events := str(after_set.get("actions", {}).get(action, {}))
	_check(not events.contains("Space"), "set replaced the old event instead of appending")
	_check(events.contains("Enter"), "the replacement event is bound")

	var removed = pt.configure_input_map({"action": action, "operation": "remove"})
	_check(removed.get("ok", false), "configure_input_map remove ok")
	_check(not ProjectSettings.has_setting("input/" + action), "action removed from project settings too")

	var bad_op = pt.configure_input_map({"action": action, "operation": "sideways"})
	_check(not bad_op.get("ok", true), "unknown input map operation is rejected")

	# Autoloads. The script has to exist on disk — the tool refuses a missing one.
	var auto_script := "res://__gdtest_autoload.gd"
	_rm(auto_script)
	var f := FileAccess.open(auto_script, FileAccess.WRITE)
	f.store_string("extends Node\n\nfunc ping() -> String:\n\treturn \"pong\"\n")
	f.close()

	var missing = pt.setup_autoload({"operation": "add", "name": "GdTestMissing", "path": "res://__gdtest_nope.gd"})
	_check(not missing.get("ok", true), "autoload add refuses a path that does not exist")

	var reg = pt.setup_autoload({"operation": "add", "name": "GdTestSingleton", "path": auto_script})
	_check(reg.get("ok", false), "setup_autoload add ok")
	_check(ProjectSettings.has_setting("autoload/GdTestSingleton"), "autoload registered in project settings")
	_check(str(pt.setup_autoload({"operation": "list"})).contains("GdTestSingleton"), "autoload appears in the list")

	var unreg = pt.remove_autoload({"name": "GdTestSingleton"})
	_check(unreg.get("ok", false), "remove_autoload ok")
	_check(not ProjectSettings.has_setting("autoload/GdTestSingleton"), "autoload unregistered")
	_check(not pt.remove_autoload({"name": "GdTestSingleton"}).get("ok", true), "removing a nonexistent autoload is an error")

	# Both tools call ProjectSettings.save(); make sure nothing survives into the
	# committed fixture.
	ProjectSettings.save()
	pt.free()
	_rm(auto_script)
	_rm(auto_script + ".uid")

func _test_property_forwarder() -> void:
	print("\n[generate_property_forwarder]")
	var sc = preload("res://addons/godot_mcp/tools/script_tools.gd").new()
	var target := "res://__gdtest_forward.gd"
	_rm(target)
	var f := FileAccess.open(target, FileAccess.WRITE)
	f.store_string("extends Node\n\n@onready var inner: Node = $Inner\n")
	f.close()

	var gen = sc.generate_property_forwarder({
		"script_path": target, "target_expression": "inner",
		"property_name": "speed", "target_property": "speed", "type_hint": "float",
	})
	_check(gen.get("ok", false), "generate_property_forwarder ok")
	var body := FileAccess.get_file_as_string(target)
	_check(body.contains("speed"), "forwarded property appears in the script")
	_check(sc.validate_script({"path": target}).get("valid", false), "generated forwarder compiles")

	sc.free()
	_rm(target)
	_rm(target + ".uid")

# mp_diagnose finds the multiplayer mistakes that fail silently. Each case here
# builds the broken setup on purpose and checks it is reported — a diagnostic
# that misses the bug it exists for is worse than none.
func _test_mp_diagnose() -> void:
	print("
[mp_diagnose]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var nc = preload("res://addons/godot_mcp/tools/netcode_tools.gd").new()
	var scene := "res://__gdtest_mp.tscn"
	var script := "res://__gdtest_mp_rpc.gd"
	_rm(scene)
	_rm(script)

	# A spawner with no spawnable scenes and a spawn_path that goes nowhere, and
	# a synchronizer replicating nothing.
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Arena"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "MultiplayerSpawner", "node_name": "Spawner"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "MultiplayerSynchronizer", "node_name": "Sync"})
	st.set_node_properties({"scene_path": scene, "node_path": "Spawner", "properties": {"spawn_path": NodePath("../DoesNotExist")}})

	var r = nc.mp_diagnose({"scene_path": scene})
	_check(r.get("ok", false), "mp_diagnose ok")
	var dump := str(r.get("findings", []))
	_check(dump.contains("no spawnable scenes"), "empty spawner reported")
	_check(dump.contains("does not resolve"), "unresolvable spawn_path reported")
	_check(dump.contains("replicates no properties"), "empty synchronizer reported")
	_check(int(r.get("errors", 0)) >= 3, "all three counted as errors")

	# The classic silent no-op: .rpc() on a method with no @rpc annotation.
	var f := FileAccess.open(script, FileAccess.WRITE)
	f.store_string("extends Node

func shoot() -> void:
	pass

@rpc(\"any_peer\")
func annotated() -> void:
	pass

func fire() -> void:
	rpc(\"shoot\")
	rpc(\"annotated\")
")
	f.close()

	var r2 = nc.mp_diagnose({})
	var dump2 := str(r2.get("findings", []))
	_check(dump2.contains("shoot"), "un-annotated rpc target reported")
	_check(not dump2.contains("'annotated' is called"), "correctly annotated rpc is NOT reported")

	# A correct setup must come back clean, or the tool is just noise.
	_rm(scene)
	_rm(script)
	_rm(script + ".uid")
	var clean := "res://__gdtest_mp_ok.tscn"
	_rm(clean)
	st.create_scene({"scene_path": clean, "root_node_type": "Node2D", "root_node_name": "Arena"})
	st.add_node({"scene_path": clean, "parent_path": ".", "node_type": "Node2D", "node_name": "Players"})
	nc.mp_add_spawner({"scene_path": clean, "parent_path": ".", "spawn_path": "../Players", "spawnable_scenes": [clean]})
	var r3 = nc.mp_diagnose({"scene_path": clean})
	_check(int(r3.get("errors", 0)) == 0, "a correct spawner setup reports no errors")

	nc.free()
	st.free()
	_rm(clean)

# Second coverage batch: the mutating tools left after the first pass.
#
# Six of the eighteen are deliberately NOT here — they need a live editor
# (select_nodes, clear_editor_selection, close_scene_tab), export templates
# (export_project), or spawn real processes (spawn_headless_peers,
# stop_headless_peers). Those belong in the live e2e harness, which runs against
# a real editor; asserting them from a headless SceneTree would either fail or
# pass for the wrong reason.
func _test_particle_material_and_gradient() -> void:
	print("\n[particle material + gradient]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var pa = preload("res://addons/godot_mcp/tools/particle_tools.gd").new()
	var scene := "res://__gdtest_pmat.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	pa.create_particles({"scene_path": scene, "dimension": "2D", "node_name": "Fx", "amount": 16})

	var mat = pa.set_particle_material({
		"scene_path": scene, "node_path": "Fx",
		"spread": 30.0, "initial_velocity_min": 20.0, "initial_velocity_max": 60.0,
	})
	_check(mat.get("ok", false), "set_particle_material ok")
	var txt := FileAccess.get_file_as_string(scene)
	_check(txt.contains("ParticleProcessMaterial"), "process material persisted")

	var grad = pa.set_particle_color_gradient({
		"scene_path": scene, "node_path": "Fx",
		"stops": [{"offset": 0.0, "color": {"r": 1, "g": 1, "b": 1, "a": 1}},
				  {"offset": 1.0, "color": {"r": 1, "g": 0, "b": 0, "a": 0}}],
	})
	_check(grad.get("ok", false), "set_particle_color_gradient ok")
	_check(FileAccess.get_file_as_string(scene).contains("Gradient"), "gradient persisted")

	var no_stops = pa.set_particle_color_gradient({"scene_path": scene, "node_path": "Fx", "stops": []})
	_check(not no_stops.get("ok", true), "an empty gradient is rejected")

	pa.free()
	st.free()
	_rm(scene)

func _test_theme_constant_and_stylebox() -> void:
	print("\n[theme constant + stylebox]")
	var th = preload("res://addons/godot_mcp/tools/theme_tools.gd").new()
	var theme := "res://__gdtest_theme2.tres"
	_rm(theme)
	th.create_theme({"theme_path": theme})

	var c = th.set_theme_constant({"theme_path": theme, "control_type": "BoxContainer", "constant_name": "separation", "value": 12})
	_check(c.get("ok", false), "set_theme_constant ok")

	var sb = th.set_theme_stylebox({
		"theme_path": theme, "control_type": "Button", "stylebox_name": "normal",
		"style": {"type": "flat", "bg_color": {"r": 0.2, "g": 0.2, "b": 0.2, "a": 1}, "corner_radius": 4},
	})
	_check(sb.get("ok", false), "set_theme_stylebox ok")

	# Read it back off disk: the theme is a resource, so a write that does not
	# persist looks identical to one that does until something reloads it.
	var loaded := ResourceLoader.load(theme, "Theme", ResourceLoader.CACHE_MODE_IGNORE) as Theme
	_check(loaded != null, "theme reloads from disk")
	if loaded:
		_check(loaded.get_constant("separation", "BoxContainer") == 12, "constant survived the round trip")
		_check(loaded.get_stylebox("normal", "Button") != null, "stylebox survived the round trip")

	th.free()
	_rm(theme)

func _test_audio_bus() -> void:
	print("\n[add_audio_bus]")
	var au = preload("res://addons/godot_mcp/tools/audio_tools.gd").new()
	var bus := "GdTestSfx"
	var had_layout := FileAccess.file_exists(str(ProjectSettings.get_setting("audio/buses/default_bus_layout", "res://default_bus_layout.tres")))

	var made = au.add_audio_bus({"bus_name": bus, "send_to": "Master", "volume_db": -6.0})
	_check(made.get("ok", false), "add_audio_bus ok")
	_check(AudioServer.get_bus_index(bus) >= 0, "bus exists in AudioServer")

	var dup = au.add_audio_bus({"bus_name": bus})
	_check(not dup.get("ok", true), "a duplicate bus name is rejected")

	var bad_send = au.add_audio_bus({"bus_name": "GdTestOther", "send_to": "NoSuchBus"})
	_check(not bad_send.get("ok", true), "an unknown send_to bus is rejected")

	var layout = au.get_audio_bus_layout({})
	_check(layout.get("ok", false), "get_audio_bus_layout ok")
	_check(str(layout).contains(bus), "the new bus shows up in the layout")

	# Buses are global state AND the tool saves the layout to a resource file, so
	# removing it in memory is not enough — the next run would reload the saved
	# layout, find the bus already there, and fail. Remove it and re-save.
	for name in [bus, "GdTestOther"]:
		var idx := AudioServer.get_bus_index(name)
		if idx >= 0:
			AudioServer.remove_bus(idx)
	var layout_path := str(ProjectSettings.get_setting("audio/buses/default_bus_layout", "res://default_bus_layout.tres"))
	if had_layout:
		ResourceSaver.save(AudioServer.generate_bus_layout(), layout_path)
	else:
		# The project had no layout file before this test; the tool created one.
		# Re-saving would leave it behind as untracked fixture churn.
		_rm(layout_path)
	_check(AudioServer.get_bus_index(bus) < 0, "test bus removed from the saved layout")
	_check(had_layout or not FileAccess.file_exists(layout_path), "no stray bus layout left behind")
	au.free()

func _test_gridmap_and_node_property() -> void:
	print("\n[gridmap + modify_node_property]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var s3 = preload("res://addons/godot_mcp/tools/scene3d_tools.gd").new()
	var scene := "res://__gdtest_grid.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node3D", "root_node_name": "World"})

	var grid = s3.add_gridmap({"scene_path": scene, "node_name": "Blocks", "cell_size": [2, 2, 2]})
	_check(grid.get("ok", false), "add_gridmap ok")
	_check(FileAccess.get_file_as_string(scene).contains("GridMap"), "gridmap persisted")

	# modify_node_property is the single-property sibling of set_node_properties
	# and had no coverage of its own.
	var prop = st.modify_node_property({
		"scene_path": scene, "node_path": "Blocks",
		"property_name": "cell_size", "value": [4, 4, 4],
	})
	_check(prop.get("ok", false), "modify_node_property ok")
	var reread = st.get_node_properties({"scene_path": scene, "node_path": "Blocks", "properties": ["cell_size"]})
	_check(str(reread).contains("4"), "the new value is read back from disk")

	var missing = st.modify_node_property({
		"scene_path": scene, "node_path": "Blocks",
		"property_name": "not_a_real_property", "value": 1,
	})
	_check(not missing.get("ok", true), "an unknown property is rejected")

	s3.free()
	st.free()
	_rm(scene)

func _test_save_resource_to_file() -> void:
	print("\n[save_resource_to_file]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var ph = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var scene := "res://__gdtest_saveres.tscn"
	var out := "res://__gdtest_shape.tres"
	_rm(scene)
	_rm(out)
	st.create_scene({"scene_path": scene, "root_node_type": "CharacterBody2D", "root_node_name": "Body"})
	ph.setup_collision({"scene_path": scene, "node_path": ".", "shape_type": "circle", "node_name": "Hit"})

	# Pull the sub-resource out into its own file so several scenes can share it.
	var saved = st.save_resource_to_file({
		"scene_path": scene, "node_path": "Hit",
		"resource_path": "shape", "save_to": out,
	})
	_check(saved.get("ok", false), "save_resource_to_file ok")
	_check(FileAccess.file_exists(out), "resource written to its own file")
	var loaded := ResourceLoader.load(out, "", ResourceLoader.CACHE_MODE_IGNORE)
	_check(loaded is CircleShape2D, "the extracted file holds the right resource type")
	_check(FileAccess.get_file_as_string(scene).contains(out), "the scene now points at the external file")

	ph.free()
	st.free()
	_rm(scene)
	_rm(out)

func _test_generate_2d_asset() -> void:
	print("\n[generate_2d_asset]")
	var at = preload("res://addons/godot_mcp/tools/asset_tools.gd").new()
	var dir := "res://__gdtest_assets/"
	var svg := "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\"><rect width=\"32\" height=\"32\" fill=\"#3aa\"/></svg>"

	var made = at.generate_2d_asset({"svg_code": svg, "filename": "probe", "save_path": dir})
	_check(made.get("ok", false), "generate_2d_asset ok")
	var png := dir + "probe.png"
	_check(FileAccess.file_exists(png), "PNG written to disk")
	var img := Image.new()
	_check(img.load(ProjectSettings.globalize_path(png)) == OK, "the PNG is a readable image")
	_check(img.get_width() == 32 and img.get_height() == 32, "rasterised at the SVG's size")

	var bad = at.generate_2d_asset({"svg_code": "not svg at all", "filename": "bad", "save_path": dir})
	_check(not bad.get("ok", true), "invalid SVG is rejected")

	at.free()
	_rm(png)
	_rm(dir + "probe.png.import")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(dir))

# scene_diff answers "what changed since I last looked" without re-sending the
# whole tree. The cases that matter: a baseline costs nothing, an unchanged
# scene reports unchanged, and each kind of change is actually detected.
func _test_scene_diff() -> void:
	print("
[scene_diff]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var an = preload("res://addons/godot_mcp/tools/analysis_tools.gd").new()
	var scene := "res://__gdtest_diff.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "Sprite2D", "node_name": "Hero"})

	var base = an.scene_diff({"scene_path": scene})
	_check(base.get("ok", false), "baseline snapshot ok")
	_check(base.get("baseline", false), "first call is marked as a baseline")
	var snap := str(base.get("snapshot_id", ""))
	_check(not snap.is_empty(), "a snapshot_id is returned")
	_check(not base.has("added"), "a baseline does not send a diff")

	# Nothing touched: the whole point is that this is cheap and says so.
	var same = an.scene_diff({"scene_path": scene, "snapshot_id": snap})
	_check(same.get("unchanged", false), "an untouched scene reports unchanged")
	_check(int(same.get("change_count", -1)) == 0, "no changes counted")

	# Add, modify and remove, then diff against the ORIGINAL baseline.
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "Camera2D", "node_name": "Cam"})
	st.modify_node_property({"scene_path": scene, "node_path": "Hero", "property_name": "position", "value": [40, 60]})
	var d = an.scene_diff({"scene_path": scene, "snapshot_id": snap})
	_check(d.get("ok", false), "diff ok")
	_check(not d.get("unchanged", true), "changes are reported")
	_check(str(d.get("added", [])).contains("Cam"), "the added node is listed")
	var mods := str(d.get("modified", []))
	_check(mods.contains("Hero") and mods.contains("position"), "the changed property is listed with its node")
	_check(mods.contains("before") and mods.contains("after"), "before/after values are included")

	# Removal, against a fresh baseline.
	var snap2 := str(d.get("snapshot_id", ""))
	st.remove_node({"scene_path": scene, "node_path": "Cam"})
	var d2 = an.scene_diff({"scene_path": scene, "snapshot_id": snap2})
	_check(str(d2.get("removed", [])).contains("Cam"), "the removed node is listed")

	# An id from another scene, or one that never existed, must be refused
	# rather than silently compared against the wrong thing.
	_check(not an.scene_diff({"scene_path": scene, "snapshot_id": "snap_does_not_exist"}).get("ok", true), "an unknown snapshot_id is rejected")

	an.free()
	st.free()
	_rm(scene)

# The last mutating tools without coverage. Each needs setup the earlier batches
# did not: a TileSet carrying terrain data, a navigation polygon, or a spawned
# process. Where the real work cannot happen headlessly (export needs templates,
# peer spawning needs a game), the CONTRACT is still asserted — a tool that
# refuses cleanly and says why is the behaviour that matters at that boundary.

## A TileSet with one atlas source and one terrain set, built in code. Doing
## this by hand in the editor is exactly the tedium the tilemap tools exist to
## avoid, and without it the terrain/autotile paths cannot be reached at all.
func _make_tileset_with_terrain() -> TileSet:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(16, 16)

	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.3, 0.6, 0.3, 1.0))
	var tex := ImageTexture.create_from_image(img)

	var atlas := TileSetAtlasSource.new()
	atlas.texture = tex
	atlas.texture_region_size = Vector2i(16, 16)
	for x in range(4):
		for y in range(4):
			atlas.create_tile(Vector2i(x, y))
	ts.add_source(atlas, 0)

	ts.add_terrain_set()
	ts.set_terrain_set_mode(0, TileSet.TERRAIN_MODE_MATCH_CORNERS_AND_SIDES)
	ts.add_terrain(0)
	ts.set_terrain_name(0, 0, "grass")
	return ts

func _test_tilemap_terrain_and_autotile() -> void:
	print("\n[tilemap terrain + autotile]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var tm = preload("res://addons/godot_mcp/tools/tilemap_tools.gd").new()
	var scene := "res://__gdtest_terrain.tscn"
	var tileset_path := "res://__gdtest_terrain.tres"
	_rm(scene)
	_rm(tileset_path)

	ResourceSaver.save(_make_tileset_with_terrain(), tileset_path)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "parent_path": ".", "node_type": "TileMapLayer", "node_name": "Ground"})
	st.set_node_properties({"scene_path": scene, "node_path": "Ground", "properties": {"tile_set": tileset_path}})

	# With a TileSet attached the earlier warning must be gone: the cells can
	# render now, and a warning that never clears is one nobody reads.
	var filled = tm.tilemap_fill_rect({
		"scene_path": scene, "node_path": "Ground",
		"from_coords": [0, 0], "to_coords": [2, 2], "source_id": 0, "atlas_coords": [0, 0],
	})
	_check(filled.get("ok", false), "fill_rect ok with a TileSet attached")
	_check(not filled.has("warning"), "no TileSet warning once one is assigned")

	var terrain = tm.tilemap_set_terrain_cells({
		"scene_path": scene, "node_path": "Ground",
		"terrain_set": 0, "terrain": 0,
		"cells": [[0, 0], [1, 0], [2, 0]],
	})
	_check(terrain.get("ok", false), "tilemap_set_terrain_cells ok")

	var bad_set = tm.tilemap_set_terrain_cells({
		"scene_path": scene, "node_path": "Ground",
		"terrain_set": 7, "terrain": 0, "cells": [[0, 0]],
	})
	_check(not bad_set.get("ok", true), "an out-of-range terrain_set is rejected")

	# Autotile picks an atlas tile per cell from its neighbour bitmask.
	var auto = tm.tilemap_autotile({
		"scene_path": scene, "node_path": "Ground",
		"source_id": 0, "neighbours": "4",
		"cells": [[0, 0], [1, 0], [0, 1], [1, 1]],
		"mask_to_atlas": {"0": [0, 0], "1": [1, 0], "3": [2, 0], "5": [3, 0], "7": [0, 1], "15": [1, 1]},
	})
	_check(auto.get("ok", false), "tilemap_autotile ok")
	# It reports the cells whose computed bitmask had no entry in mask_to_atlas
	# instead of quietly painting nothing — an incomplete map is the usual
	# mistake, and silence would look like the tool not working.
	_check(auto.has("cells_painted") and auto.has("unmapped_count"), "autotile reports painted and unmapped counts")
	var used = tm.tilemap_get_used_cells({"scene_path": scene, "node_path": "Ground"})
	_check(Array(used.get("cells", [])).size() >= 4, "the layer still holds the filled cells")

	# A map covering every 4-neighbour mask paints every cell, nothing unmapped.
	var full_map := {}
	for m in range(16):
		full_map[str(m)] = [m % 4, m / 4]
	var auto2 = tm.tilemap_autotile({
		"scene_path": scene, "node_path": "Ground",
		"source_id": 0, "neighbours": "4",
		"cells": [[0, 0], [1, 0], [0, 1], [1, 1]],
		"mask_to_atlas": full_map,
	})
	_check(int(auto2.get("cells_painted", 0)) == 4, "a complete mask map paints every cell")
	_check(int(auto2.get("unmapped_count", -1)) == 0, "and leaves nothing unmapped")

	_check(not tm.tilemap_autotile({"scene_path": scene, "node_path": "Ground", "cells": [[0, 0]]}).get("ok", true), "autotile without mask_to_atlas is rejected")
	_check(not tm.tilemap_autotile({"scene_path": scene, "node_path": "Ground", "cells": [], "mask_to_atlas": {"0": [0, 0]}}).get("ok", true), "autotile without cells is rejected")

	tm.free()
	st.free()
	_rm(scene)
	_rm(tileset_path)

func _test_bake_navigation_mesh() -> void:
	print("\n[bake_navigation_mesh]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var nv = preload("res://addons/godot_mcp/tools/navigation_tools.gd").new()
	var scene := "res://__gdtest_navbake.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Level"})
	nv.setup_navigation_region({"scene_path": scene, "dimension": "2D", "node_name": "Nav"})

	# An explicit outline, so the bake has real geometry to work with rather than
	# silently producing an empty polygon.
	var baked = nv.bake_navigation_mesh({
		"scene_path": scene, "node_path": "Nav",
		"outline": [[0, 0], [256, 0], [256, 256], [0, 256]],
	})
	_check(baked.get("ok", false), "bake_navigation_mesh ok")

	var info = nv.get_navigation_info({"scene_path": scene, "node_path": "Nav"})
	_check(info.get("ok", false), "get_navigation_info ok after baking")
	_check(baked.has("bounds"), "the baked area's bounds are reported")

	var missing = nv.bake_navigation_mesh({"scene_path": scene, "node_path": "NoSuchNode"})
	_check(not missing.get("ok", true), "baking a node that does not exist is rejected")

	nv.free()
	st.free()
	_rm(scene)

func _test_export_and_peer_contracts() -> void:
	print("\n[export + headless peers: contracts]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()

	# These three cannot do their real work here — exporting needs templates
	# installed, and spawning peers needs a game to connect to. What IS worth
	# asserting is that each refuses cleanly and says why, instead of hanging or
	# reporting a success that did not happen.
	var presets = pt.list_export_presets({})
	_check(presets.get("ok", false), "list_export_presets answers on a project with none configured")

	var no_preset = pt.export_project({"preset": "NoSuchPreset", "output_path": "res://__gdtest_out.exe"})
	_check(not no_preset.get("ok", true), "export_project rejects an unknown preset")
	_check(str(no_preset.get("error", "")).length() > 10, "and says why, rather than failing bare")

	var no_scene = pt.spawn_headless_peers({"count": 1})
	_check(not no_scene.get("ok", true), "spawn_headless_peers refuses without a scene to run")

	var stop_none = pt.stop_headless_peers({})
	_check(stop_none.has("ok"), "stop_headless_peers answers even with nothing running")

	pt.free()

# Every tool node the executor creates must be handed the EditorPlugin.
#
# analysis_tools was missing from that list, and nothing caught it: without the
# plugin, _edited_root_if_open can never find the live tree, so every analysis
# tool silently read the last SAVED scene. scene_diff reported "no changes" for
# an edit sitting unsaved in the editor — the same stale-read shape that eleven
# read tools were fixed for in 1.1.1, reintroduced in a new file.
func _test_every_tool_node_gets_the_plugin() -> void:
	print("\n[executor wiring]")
	var src := FileAccess.get_file_as_string("res://addons/godot_mcp/tool_executor.gd")

	# The node fields the executor declares, and the ones it wires up.
	var declared: Array = []
	var re_decl := RegEx.new()
	re_decl.compile("(?m)^var (_[a-z0-9_]+_tools): Node")
	for m in re_decl.search_all(src):
		declared.append(m.get_string(1))

	var wired: Array = []
	var re_wire := RegEx.new()
	re_wire.compile("(_[a-z0-9_]+_tools)\\.set_editor_plugin\\(plugin\\)")
	for m in re_wire.search_all(src):
		if not wired.has(m.get_string(1)):
			wired.append(m.get_string(1))

	_check(declared.size() > 10, "found the executor's tool node fields (%d)" % declared.size())
	var missing: Array = []
	for name in declared:
		if not wired.has(name):
			missing.append(name)
	_check(missing.is_empty(), "every tool node is given the editor plugin (missing: %s)" % str(missing))

# The debugger watch must only LISTEN. An EditorDebuggerPlugin that claims a
# capture prefix takes those messages away from the debugger that would
# otherwise handle them, so a stray `_has_capture` returning true would break the
# developer's own debugger UI while looking like it works from our side.
#
# Source inspection, not behaviour: EditorDebuggerPlugin is a virtual class, so
# it cannot even be instantiated outside a real editor — and the session signals
# it hangs off only fire with a real game running under one. This checks the
# contract the two sides agree on, which is what a rename would break.
func _test_debugger_watch_is_passive() -> void:
	print("\n[debugger watch]")
	var src := FileAccess.get_file_as_string("res://addons/godot_mcp/utils/debugger_watch.gd")
	_check(not src.is_empty(), "debugger_watch.gd is present")
	_check(src.contains("func _has_capture") and src.contains("return false"), "captures nothing, so the editor's debugger keeps its messages")
	_check(src.contains("signal game_event"), "exposes the game_event signal plugin.gd connects to")

	# plugin.gd records these as activity and the server's summary switches on
	# the exact strings, so a rename here has to be a deliberate two-sided change.
	for type in ["game_running", "game_stopped", "game_resumed", "game_paused", "game_crashed"]:
		_check(src.contains('"%s"' % type), "still emits %s" % type)

	var plug := FileAccess.get_file_as_string("res://addons/godot_mcp/plugin.gd")
	_check(plug.contains("add_debugger_plugin(") and plug.contains("remove_debugger_plugin("), "the plugin both registers and unregisters the watch")

	# The runtime autoload reports the other half: the editor cannot see a
	# change_scene_to_file(), and the game cannot report its own crash.
	var rt := FileAccess.get_file_as_string("res://addons/godot_mcp/runtime/mcp_runtime.gd")
	_check(rt.contains("_tick_scene_awareness()") and rt.contains("game_scene_changed"), "the runtime reports its own scene swaps")
	_check(rt.contains('"source": "runtime"'), "and tags them runtime, so the server does not filter them as agent noise")

# A handler that contains `await` is a coroutine, and GDScript 4 will not return
# its value through a generic call() — the caller gets a GDScriptFunctionState
# and the agent sees "Tool returned no status". The executor works around that
# with _COROUTINE_TOOLS plus an explicit dispatch case per tool, which is a list
# somebody has to remember to update.
#
# run_scene is why this test exists: it blocked the main thread with
# OS.delay_msec instead of yielding, which froze the editor's WebSocket pump for
# the whole startup timeout and got the connection killed by the server's ping
# watchdog on every single call.
func _test_coroutine_tools_are_registered() -> void:
	print("\n[coroutine dispatch]")
	var exec_src := FileAccess.get_file_as_string("res://addons/godot_mcp/tool_executor.gd")

	# The names the executor declares as coroutines, and the ones it can dispatch.
	var declared: Array = []
	var re_set := RegEx.new()
	re_set.compile('(?s)_COROUTINE_TOOLS\\s*:=\\s*\\{(.*?)\\}')
	var block := re_set.search(exec_src)
	if block:
		var re_name := RegEx.new()
		re_name.compile('"([a-z_0-9]+)"\\s*:')
		for m in re_name.search_all(block.get_string(1)):
			declared.append(m.get_string(1))
	_check(declared.size() >= 2, "found the coroutine tool list (%s)" % str(declared))

	# Match against a newline-normalised copy. This assertion hard-codes "\n", so
	# it broke the moment the file was written with CRLF — which is what any
	# Windows checkout with core.autocrlf=true produces. It would have failed for
	# a contributor's line endings rather than for a real defect.
	var exec_lf := exec_src.replace("\r\n", "\n")
	for name in declared:
		_check(exec_lf.contains('"%s":\n\t\t\t\tresult = await node.%s(args)' % [name, name]),
			"%s has a direct await dispatch case" % name)

	# The other direction, which is the one that actually rots: a handler that
	# gained an `await` and was never added to the list above.
	#
	# Scanned line by line rather than by slicing on a regex. The first attempt
	# sliced between `func <name>(args: Dictionary)` matches and flagged three
	# tools that were fine: two had the word "await" inside a comment and a
	# user-facing message string, and the third inherited the body of a private
	# helper declared between two handlers. A wiring test that cries wolf gets
	# muted, so this one only counts `await` in statement position.
	var missing: Array = []
	for file in ["project_tools", "scene_tools", "script_tools", "testing_tools", "netcode_tools"]:
		var src := FileAccess.get_file_as_string("res://addons/godot_mcp/tools/%s.gd" % file)
		if src.is_empty():
			continue
		var current := ""  # name of the handler we are inside, "" when in a private helper
		for raw_line in src.split("\n"):
			var line: String = raw_line
			var hash_at := line.find("#")
			if hash_at >= 0:
				line = line.substr(0, hash_at)
			if line.begins_with("func "):
				# Any func ends the previous body; only args-handlers start one.
				current = ""
				var open := line.find("(")
				if open > 5 and line.substr(open).begins_with("(args: Dictionary)"):
					current = line.substr(5, open - 5)
				continue
			if current.is_empty() or declared.has(current):
				continue
			var code := line.strip_edges()
			if code.begins_with("await ") or code.contains("= await "):
				missing.append("%s.%s" % [file, current])
				current = ""  # one report per handler is enough
	_check(missing.is_empty(), "every awaiting tool handler is registered as a coroutine (missing: %s)" % str(missing))

# get_errors classified severity by looking for the word "warning" in the row's
# text — but that text comes from the editor's Debugger panel, which is
# translated. On a Spanish or Chinese editor ("Advertencia", "警告") every warning
# was reported as an error and include_warnings=false filtered nothing.
#
# Found by reading a competitor's bug report (Godot-MCP-Native #32) and checking
# whether we had the same defect. We did.
func _test_debugger_error_severity_is_language_independent() -> void:
	print("\n[debugger error severity]")
	var pt = preload("res://addons/godot_mcp/tools/project_tools.gd").new()
	var tree := Tree.new()
	var root := tree.create_item()

	# Godot stamps these in script_editor_debugger.cpp; it reads them back the
	# same way, on 4.5 and 4.7 alike.
	var warn := tree.create_item(root)
	warn.set_meta(&"_is_warning", true)
	var err := tree.create_item(root)
	err.set_meta(&"_is_error", true)

	# The message text is deliberately in another language: if the classifier
	# still reads the text, these two come back wrong.
	_check(pt._severity_for_error_item(warn, "Advertencia: nodo sin forma") == "warning",
		"a warning row is a warning even when the panel is not in English")
	_check(pt._severity_for_error_item(err, "错误:找不到节点") == "error",
		"an error row is an error even when the panel is not in English")

	# The English text must not be able to override the meta either.
	_check(pt._severity_for_error_item(err, "warning: this text lies") == "error",
		"the meta wins over the text, not the other way round")

	# No meta at all (an unfamiliar build): degrade to the old text match rather
	# than calling everything an error.
	var bare := tree.create_item(root)
	_check(pt._severity_for_error_item(bare, "WARNING: something") == "warning",
		"without meta it falls back to the text instead of guessing error")
	_check(pt._severity_for_error_item(bare, "ERROR: something") == "error",
		"and still reports a plain error as an error")

	tree.free()
	pt.free()

# seed_rng / time_scale / step_frames / await_condition exist so a test of a
# running game can be repeated: `wait` counts wall-clock time, so how much
# simulation happens depends on the machine.
#
# The frame-counting halves need a real running game and a socket, so what is
# checked here is everything that does not: argument contracts, clamping, and
# the truthiness rule await_condition uses to decide it is done.
func _test_deterministic_runtime_tools() -> void:
	print("\n[deterministic runtime tools]")
	# Not added to the tree, so _ready (and the WebSocket connect) never runs.
	var rt = preload("res://addons/godot_mcp/runtime/mcp_runtime.gd").new()

	var no_seed: Dictionary = rt._seed_rng({})
	_check(not no_seed.get("ok", true), "seed_rng without a seed is rejected")
	var seeded: Dictionary = rt._seed_rng({"seed": 42})
	_check(seeded.get("ok", false) and int(seeded.get("seed", 0)) == 42, "seed_rng echoes the seed it applied")
	_check(str(seeded.get("note", "")).contains("RandomNumberGenerator"),
		"and says which RNG it does NOT cover, rather than implying full determinism")

	# Same seed, same sequence — the property the tool exists for.
	rt._seed_rng({"seed": 12345})
	var first: Array = [randi(), randi(), randi()]
	rt._seed_rng({"seed": 12345})
	var second: Array = [randi(), randi(), randi()]
	_check(first == second, "reseeding replays the same sequence")

	var restore := Engine.time_scale
	_check(not rt._time_scale({}).get("ok", true), "time_scale without a scale is rejected")
	var half: Dictionary = rt._time_scale({"scale": 0.5})
	_check(half.get("ok", false) and is_equal_approx(float(half.get("time_scale", 0.0)), 0.5), "time_scale applies a valid scale")
	var huge: Dictionary = rt._time_scale({"scale": 5000.0})
	_check(huge.get("clamped", false), "an absurd scale is clamped, not applied")
	_check(float(huge.get("time_scale", 0.0)) <= 10.0, "and clamped to the documented ceiling")
	var negative: Dictionary = rt._time_scale({"scale": -3.0})
	_check(float(negative.get("time_scale", -1.0)) >= 0.0, "negative time is clamped to zero")
	Engine.time_scale = restore

	# step_frames' clamp is checked by inspecting the queued job rather than by
	# running it: the cap is 3600 physics frames, which is a real minute of
	# waiting, and a test that takes a minute to prove a bounds check is a test
	# nobody runs. (Learned the hard way — the first version of the live test did
	# exactly that and took the game down with it.)
	rt._step_jobs.clear()
	rt._start_step_frames("probe-clamp", {"frames": 999999})
	_check(rt._step_jobs.size() == 1, "step_frames queues a job")
	_check(int(rt._step_jobs[0]["frames"]) == 3600, "an absurd frame count is capped at 3600")
	_check(int(rt._step_jobs[0]["requested"]) == 999999, "and the job remembers what was asked, so the reply can say it clamped")
	_check(str(rt._step_jobs[0]["mode"]) == "physics", "physics frames are the default, not render frames")

	rt._step_jobs.clear()
	rt._start_step_frames("probe-zero", {"frames": 0})
	_check(rt._step_jobs.is_empty(), "a frame count below 1 is rejected instead of queued")
	rt._start_step_frames("probe-mode", {"frames": 2, "mode": "nonsense"})
	_check(rt._step_jobs.is_empty(), "an unknown mode is rejected instead of silently defaulting")
	rt._step_jobs.clear()

	# await_condition's truthiness: an empty array has to read as "not yet", or
	# `return tree.get_nodes_in_group("enemies")` would resolve immediately.
	_check(not rt._is_truthy(null), "null is not truthy")
	_check(not rt._is_truthy(false) and rt._is_truthy(true), "bools pass through")
	_check(not rt._is_truthy(0) and rt._is_truthy(3), "zero is false, non-zero is true")
	_check(not rt._is_truthy([]) and rt._is_truthy([1]), "an empty array is not yet, a full one is")
	_check(not rt._is_truthy({}) and rt._is_truthy({"a": 1}), "same for dictionaries")
	_check(not rt._is_truthy("") and rt._is_truthy("x"), "and for strings")

	rt.free()

# The unknown-tool error used to append every registered tool name — ~4,000
# characters — and batch_execute repeats the error once per failed operation. A
# single mistyped name in a two-op batch therefore cost about 2,000 tokens, more
# than a quarter of the whole default tool surface, in a server whose central
# claim is that context is expensive. Found by using the thing, not by reading it.
func _test_unknown_tool_error_is_cheap() -> void:
	print("\n[unknown-tool error]")
	var ex = preload("res://addons/godot_mcp/tool_executor.gd").new()
	ex._init_tools()

	var full_list_len: int = ", ".join(ex._tool_map.keys()).length()
	_check(full_list_len > 2000, "the full tool list really is large (%d chars)" % full_list_len)

	var typo: String = ex._suggest_tools("set_node_group")
	_check(typo.length() < 400, "a near-miss suggests a few names, not all of them (%d chars)" % typo.length())
	_check(typo.contains("set_node_groups"), "and the name actually wanted is among them")

	var nonsense: String = ex._suggest_tools("zzzzz_not_a_tool")
	_check(nonsense.length() < 200, "an unrecognisable name gets a short pointer, not a dump")
	_check(nonsense.contains("list_toolsets"), "and is told where to look instead")

	# Runtime tools are the confusing case: they exist, but not in this executor.
	var runtime_hint: String = ex._suggest_tools("query_runtime_node")
	_check(runtime_hint.contains("inside the GAME"), "a runtime tool explains WHY it is not here")
	_check(not runtime_hint.contains("Did you mean"), "rather than being reported as a typo")

	ex.free()

# An instanced child must keep the script it inherits from its own scene.
#
# Found in a real project: after editing a level with instance_scene/remove_node,
# the Player — an instance of player.tscn, which has player.gd on its root — came
# back with `script = null` written into the level as an instance OVERRIDE. The
# player silently stopped moving: no script, no _physics_process, no error. Only
# the scene that had been edited through these tools was affected.
#
# This is the clobbering class the whole live-tree design exists to prevent, so
# it gets a test on the disk path where it can be checked cheaply.
func _test_instanced_child_keeps_its_script() -> void:
	print("\n[instanced child keeps its script]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var script_path := "res://__gdtest_inst_child.gd"
	var child_path := "res://__gdtest_inst_child.tscn"
	var parent_path := "res://__gdtest_inst_parent.tscn"

	var f := FileAccess.open(script_path, FileAccess.WRITE)
	f.store_string("extends Node2D\n\nfunc _ready() -> void:\n\tpass\n")
	f.close()

	st.create_scene({"scene_path": child_path, "root_node_type": "Node2D", "root_node_name": "Child"})
	st.attach_script({"scene_path": child_path, "node_path": ".", "script_path": script_path})
	st.create_scene({"scene_path": parent_path, "root_node_type": "Node2D", "root_node_name": "Parent"})

	var inst: Dictionary = st.instance_scene({"scene_path": parent_path, "instance_path": child_path, "node_name": "Kid"})
	_check(inst.get("ok", false), "instance_scene ok")

	var text := FileAccess.get_file_as_string(parent_path)
	_check(text.contains("instance=ExtResource"), "the child is stored as an instance, not a copy")
	_check(not text.contains("script = null"),
		"the instance does NOT get script=null written over its inherited script")

	# And the same after a second edit, which is when it showed up in the wild.
	st.add_node({"scene_path": parent_path, "node_name": "Marker", "node_type": "Marker2D", "parent_path": "."})
	st.remove_node({"scene_path": parent_path, "node_path": "Marker"})
	var after := FileAccess.get_file_as_string(parent_path)
	_check(not after.contains("script = null"), "and still not after the parent is edited and re-saved")

	DirAccess.remove_absolute(ProjectSettings.globalize_path(script_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(child_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(parent_path))
	st.free()

# A "Node not found" that only repeats the path back is a guaranteed second
# wrong guess. The error now carries what the scene actually contains.
func _test_node_not_found_suggests_real_paths() -> void:
	print("\n[node-not-found errors suggest real paths]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_notfound.tscn"
	_rm(scene)

	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Player", "node_type": "Node2D", "parent_path": "."})
	st.add_node({"scene_path": scene, "node_name": "Sprite", "node_type": "Sprite2D", "parent_path": "Player"})

	# A near miss should be named outright.
	var typo: Dictionary = st.set_node_properties({"scene_path": scene, "node_path": "Playr", "properties": {"visible": false}})
	_check(not typo.get("ok", true), "a wrong node path still fails")
	_check(str(typo.get("error", "")).contains("Player"), "and the near miss is suggested by name")

	# Nothing close: fall back to listing what is there.
	var wild: Dictionary = st.set_node_properties({"scene_path": scene, "node_path": "Zzz", "properties": {"visible": false}})
	var msg := str(wild.get("error", ""))
	_check(msg.contains("Player/Sprite"), "with no near miss, the real paths are listed")
	_check(msg.contains("Zzz"), "and the offending value is still in the message")

	_rm(scene)
	st.free()

# The other half of the same incident. Neither the disk path nor the live path
# reproduces the `script = null` override, so we stopped guessing at the cause
# and made the symptom loud instead: a scene carrying one now fails
# validate_scene_integrity, which already runs automatically after mutations.
func _test_integrity_flags_an_instance_that_lost_its_script() -> void:
	print("\n[integrity catches a script=null instance override]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var tt = preload("res://addons/godot_mcp/tools/testing_tools.gd").new()
	var script_path := "res://__gdtest_lost_script.gd"
	var child_path := "res://__gdtest_lost_child.tscn"
	var parent_path := "res://__gdtest_lost_parent.tscn"

	var f := FileAccess.open(script_path, FileAccess.WRITE)
	f.store_string("extends Node2D\n\nfunc _ready() -> void:\n\tpass\n")
	f.close()

	st.create_scene({"scene_path": child_path, "root_node_type": "Node2D", "root_node_name": "Child"})
	st.attach_script({"scene_path": child_path, "node_path": ".", "script_path": script_path})

	# The parent is written as text rather than built with instance_scene: this
	# needs the exact on-disk shape the incident had, a bare instance line with
	# `script = null` under it and nothing else.
	_write_text(parent_path, "\n".join([
		"[gd_scene load_steps=2 format=3]",
		"",
		"[ext_resource type=\"PackedScene\" path=\"%s\" id=\"1_child\"]" % child_path,
		"",
		"[node name=\"Parent\" type=\"Node2D\"]",
		"",
		"[node name=\"Kid\" parent=\".\" instance=ExtResource(\"1_child\")]",
		"",
	]))

	# Healthy first, so a passing test cannot be the checker flagging everything.
	var clean: Dictionary = tt.validate_scene_integrity({"scene_path": parent_path})
	_check(clean.get("issue_count", -1) == 0, "a healthy instance raises no issue")

	_write_text(parent_path, FileAccess.get_file_as_string(parent_path).replace(
		"instance=ExtResource(\"1_child\")]",
		"instance=ExtResource(\"1_child\")]\nscript = null"))

	var broken: Dictionary = tt.validate_scene_integrity({"scene_path": parent_path})
	var found := false
	for issue in broken.get("issues", []):
		if issue.get("property", "") == "script" and str(issue.get("node_path", "")) == "Kid":
			found = true
	_check(found, "validate_scene_integrity reports the instance that lost its script")

	DirAccess.remove_absolute(ProjectSettings.globalize_path(script_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(child_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(parent_path))
	st.free()
	tt.free()

# A res:// path assigned to an Object-typed property must LOAD, on every tool
# that takes properties — not just on set_node_properties.
#
# 1.1.3 fixed this inside set_node_properties only. add_node, create_scene,
# instance_scene, batch_scene_edit and duplicate_node all share
# _set_node_properties and kept the bug: `texture: "res://...png"` reported ok
# and silently did nothing. Found by building a real scene and watching the
# sprite never appear. The fix moved into VariantCodec, the one place they all
# pass through.
func _test_resource_paths_load_on_every_entry_point() -> void:
	print("\n[res:// property loads everywhere]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var codec = preload("res://addons/godot_mcp/utils/variant_codec.gd")
	var tex_path := "res://__gdtest_res_prop.tres"
	var scene_path := "res://__gdtest_res_prop.tscn"

	var img := Image.create(4, 4, false, Image.FORMAT_RGBA8)
	img.fill(Color.RED)
	ResourceSaver.save(ImageTexture.create_from_image(img), tex_path)

	# The codec is the shared choke point — check it directly first.
	_check(codec.parse_typed_value(tex_path, TYPE_OBJECT) is Resource,
		"the codec loads a res:// path for an Object-typed property")
	_check(not (codec.parse_typed_value("res://does_not_exist.tres", TYPE_OBJECT) is Resource),
		"a path that does not resolve is left alone, not turned into garbage")
	_check(codec.parse_typed_value("just a string", TYPE_STRING) == "just a string",
		"and a normal string property is untouched")

	# Then through add_node, the entry point that was actually broken.
	st.create_scene({"scene_path": scene_path, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({
		"scene_path": scene_path, "node_name": "Pic", "node_type": "Sprite2D", "parent_path": ".",
		"properties": {"texture": tex_path, "hframes": 4},
	})
	var text := FileAccess.get_file_as_string(scene_path)
	_check(text.contains("hframes = 4"), "add_node applied the plain property")
	_check(text.contains("texture = ExtResource") or text.contains("texture = SubResource"),
		"AND the resource property, which used to be dropped silently")

	# Same conversion, third entry point: an animation keyframe on a texture
	# track stored the path as a String, so the assignment failed at runtime and
	# the sprite went blank.
	var at = preload("res://addons/godot_mcp/tools/animation_tools.gd").new()
	st.add_node({"scene_path": scene_path, "node_name": "Anim", "node_type": "AnimationPlayer", "parent_path": "."})
	at.create_animation({"scene_path": scene_path, "node_path": "Anim", "animation_name": "blink", "length": 1.0})
	at.add_animation_track({"scene_path": scene_path, "node_path": "Anim", "animation_name": "blink",
		"track_type": "value", "track_node_path": "Pic", "property": "texture"})
	at.set_animation_keyframe({"scene_path": scene_path, "node_path": "Anim", "animation_name": "blink",
		"track_index": 0, "time": 0.0, "value": tex_path})

	var anim_text := FileAccess.get_file_as_string(scene_path)
	_check(not anim_text.contains('"values": ["res://__gdtest_res_prop.tres"]'),
		"a texture keyframe does not store the raw path string")
	_check(anim_text.contains("ExtResource") or anim_text.contains("SubResource"),
		"it stores the loaded resource, so the track actually assigns something at runtime")
	at.free()

	DirAccess.remove_absolute(ProjectSettings.globalize_path(scene_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(tex_path))
	st.free()

# setup_collision used to drop the shape centred on the node origin, which for a
# 2D character buries the body half-way into the floor. Found by building an orc
# that hovered above the ground while the project's hand-made player collision,
# right next to it, was offset by hand for exactly this reason.
func _test_collision_sits_on_the_origin() -> void:
	print("\n[collision offset]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var ph = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var scene_path := "res://__gdtest_coll_offset.tscn"

	st.create_scene({"scene_path": scene_path, "root_node_type": "CharacterBody2D", "root_node_name": "Body"})
	ph.setup_collision({"scene_path": scene_path, "node_path": ".", "shape_type": "rectangle", "size": {"x": 30, "y": 40}})
	var text := FileAccess.get_file_as_string(scene_path)
	_check(text.contains("position = Vector2(0, -20)"),
		"a rectangle shape sits ON the origin (half its height up), so the origin is the feet")

	# Separate files per case: create_scene does not overwrite, so reusing one
	# path leaves the previous shape in the file and the assertion reads it.
	var explicit_path := "res://__gdtest_coll_explicit.tscn"
	st.create_scene({"scene_path": explicit_path, "root_node_type": "CharacterBody2D", "root_node_name": "Body"})
	ph.setup_collision({"scene_path": explicit_path, "node_path": ".", "shape_type": "rectangle",
		"size": {"x": 30, "y": 40}, "offset": {"x": 7, "y": 3}})
	_check(FileAccess.get_file_as_string(explicit_path).contains("position = Vector2(7, 3)"),
		"an explicit offset overrides the default")

	# A circle uses its radius, not a height.
	var circle_path := "res://__gdtest_coll_circle.tscn"
	st.create_scene({"scene_path": circle_path, "root_node_type": "CharacterBody2D", "root_node_name": "Body"})
	ph.setup_collision({"scene_path": circle_path, "node_path": ".", "shape_type": "circle", "size": 12})
	_check(FileAccess.get_file_as_string(circle_path).contains("position = Vector2(0, -12)"),
		"a circle sits on the origin by its radius")

	DirAccess.remove_absolute(ProjectSettings.globalize_path(scene_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(explicit_path))
	DirAccess.remove_absolute(ProjectSettings.globalize_path(circle_path))
	ph.free()
	st.free()


# A JSON client has one number type, so every integer arrives as a float. Setting
# an int property with it works, but the read-back returns an int — and comparing
# the two as strings ("1" vs "1.0") reported a correct write as a failure. That is
# why setting collision_layer/collision_mask came back "set had no effect (type
# mismatch?)" and, for a single-property call, saved nothing at all.
func _test_numeric_value_match() -> void:
	print("
[numeric value comparison]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	_check(st._values_match(1, 1.0), "int 1 matches float 1.0")
	_check(st._values_match(2.0, 2), "float 2.0 matches int 2")
	_check(not st._values_match(1, 2), "different numbers still differ")
	_check(st._values_match(1.5, 1.5), "floats still compare")
	# A stringified number DOES match, deliberately: MCP clients send scalars as
	# strings, the property reads back as a number, and calling that a failed
	# write is the same bug in a different costume.
	_check(st._values_match("1", 1), "a stringified number still matches")

	# End to end: the value a JSON client actually sends, on an int property.
	var scene := "res://__gdtest_numeric.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Body", "node_type": "CharacterBody2D", "parent_path": "."})

	var r = st.set_node_properties({"scene_path": scene, "node_path": "Body",
		"properties": {"collision_layer": 2.0}})
	_check(r.get("ok", false), "set_node_properties accepts a float for an int property")
	_check((r.get("failed", []) as Array).is_empty(), "no spurious 'set had no effect'")
	_check(FileAccess.get_file_as_string(scene).contains("collision_layer = 2"), "value persisted to disk")

	# Re-setting the same value is not a failure either.
	var again = st.set_node_properties({"scene_path": scene, "node_path": "Body",
		"properties": {"collision_layer": 2}})
	_check(again.get("ok", false), "re-setting an unchanged value is not an error")

	st.free()
	_rm(scene)


# Two tools take a `shape_type` and accept different vocabularies. Passing the
# sibling's spelling used to give a bare "Invalid shape type: rectangle" with no
# indication that a different word was wanted, or which.
func _test_shape_type_error() -> void:
	print("
[shape_type error quality]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_shape.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Col", "node_type": "CollisionShape2D", "parent_path": "."})

	var r = st.set_collision_shape({"scene_path": scene, "node_path": "Col", "shape_type": "rectangle"})
	_check(not r.get("ok", true), "the other tool's spelling is still rejected")
	var err := str(r.get("error", ""))
	_check(err.contains("RectangleShape2D"), "the error names the value that WOULD work")
	_check(err.contains("setup_collision"), "the error says where that spelling comes from")
	_check(err.contains("BoxShape3D"), "the error enumerates valid options")

	# An unrecognisable value still gets the list, just no suggestion.
	var r2 = st.set_collision_shape({"scene_path": scene, "node_path": "Col", "shape_type": "zzz"})
	_check(not r2.get("ok", true), "nonsense is rejected")
	_check(str(r2.get("error", "")).contains("CircleShape2D"), "and still lists the options")

	# The valid class name keeps working.
	var ok_r = st.set_collision_shape({"scene_path": scene, "node_path": "Col", "shape_type": "RectangleShape2D"})
	_check(ok_r.get("ok", false), "the class name is accepted")

	st.free()
	_rm(scene)


# "Where is everything" is the first question about a 2D scene, and answering it
# used to mean either one call per node or include_properties, which returns a
# fixed twelve on every node whether you wanted them or not.
func _test_read_scene_properties() -> void:
	print("
[read_scene property filter]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_readprops.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "A", "node_type": "Sprite2D", "parent_path": "."})
	st.set_node_properties({"scene_path": scene, "node_path": "A", "properties": {"position": {"x": 30, "y": 40}}})

	# Default stays lean: no properties at all.
	var plain = st.read_scene({"scene_path": scene})
	_check(plain.get("ok", false), "read_scene ok")
	_check(not (plain.get("root", {}) as Dictionary).has("properties"), "no properties by default")

	var only_pos = st.read_scene({"scene_path": scene, "properties": ["position"]})
	var kid: Dictionary = (only_pos.get("root", {}).get("children", [])[0])
	_check(kid.has("properties"), "requested property returned")
	var props: Dictionary = kid.get("properties", {})
	_check(props.size() == 1 and props.has("position"), "ONLY the requested property (got %d)" % props.size())
	_check(int(props["position"]["x"]) == 30, "and it carries the real value")

	# A typo must be visible, not silently absent.
	var typo = st.read_scene({"scene_path": scene, "properties": ["positon"]})
	var kid2: Dictionary = (typo.get("root", {}).get("children", [])[0])
	_check((kid2.get("missing_properties", []) as Array).has("positon"), "a misspelled property is reported, not dropped")

	# include_properties still works and returns more than one.
	var full = st.read_scene({"scene_path": scene, "include_properties": true})
	var kid3: Dictionary = (full.get("root", {}).get("children", [])[0])
	_check((kid3.get("properties", {}) as Dictionary).size() > 1, "include_properties still returns the fixed set")

	var bad = st.read_scene({"scene_path": scene, "properties": "position"})
	_check(not bad.get("ok", true), "a non-array 'properties' is rejected")

	st.free()
	_rm(scene)


# validate_scripts answers "does this parse". These failures are silent instead:
# a group nobody is in returns null, a renamed input action is simply never
# pressed, and neither produces an error anywhere.
func _test_validate_references() -> void:
	print("
[validate_references]")
	var at = preload("res://addons/godot_mcp/tools/analysis_tools.gd").new()

	# A clean baseline first: the tool is only useful if it stays quiet on code
	# that is fine. A false positive costs more than a miss here.
	var clean = at.validate_references({})
	_check(clean.get("ok", false), "validate_references ok")
	var baseline := int(clean.get("issue_count", -1))
	_check(baseline >= 0, "reports an issue count")

	# Define a group so there is something real to be close to.
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var scene := "res://__gdtest_refs.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "P", "node_type": "Node2D", "parent_path": "."})
	st.set_node_groups({"scene_path": scene, "node_path": "P", "groups": ["gdtest_player"]})
	st.free()

	var bad := "res://__gdtest_refs_bad.gd"
	_rm(bad)
	var f := FileAccess.open(bad, FileAccess.WRITE)
	f.store_string("extends Node
signal declared_here

func _ready() -> void:
" +
		"	get_tree().get_first_node_in_group(\"gdtest_playr\")
" +
		"	Input.is_action_pressed(\"gdtest_no_such_action\")
" +
		"	emit_signal(\"never_declared_anywhere\")
" +
		"	get_tree().get_first_node_in_group(\"gdtest_player\")
" +
		"	emit_signal(\"declared_here\")
")
	f.close()

	var r = at.validate_references({})
	var kinds: Dictionary = r.get("issues_by_kind", {})
	_check(int(r.get("issue_count", 0)) >= baseline + 3, "the three injected problems are reported")
	_check(int(kinds.get("group", 0)) >= 1, "a group nobody is in is caught")
	_check(int(kinds.get("input_action", 0)) >= 1, "an unmapped input action is caught")
	_check(int(kinds.get("signal", 0)) >= 1, "a signal emitted but not declared is caught")

	# The valid references in the same file must NOT be reported.
	var names: Array = []
	var suggestion_for_typo := ""
	for i in r.get("issues", []):
		names.append(str(i.get("name", "")))
		if str(i.get("name", "")) == "gdtest_playr":
			suggestion_for_typo = str(i.get("suggestion", ""))
	_check(not names.has("gdtest_player"), "a group that DOES exist is not flagged")
	_check(not names.has("declared_here"), "a declared signal is not flagged")
	_check(suggestion_for_typo == "gdtest_player", "the typo gets the right suggestion (got '%s')" % suggestion_for_typo)

	_rm(bad)
	_rm(scene)
	at.free()


# Two findings from building a real character, both silent until something else
# breaks: a second collision node left next to an empty one, and a sprite `frame`
# track that sorts before the sheet-layout track it depends on.
func _test_collision_reuse_and_track_order() -> void:
	print("
[collision reuse + sprite track order]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var ph = preload("res://addons/godot_mcp/tools/physics_tools.gd").new()
	var an = preload("res://addons/godot_mcp/tools/animation_tools.gd").new()
	var scene := "res://__gdtest_reuse.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "CharacterBody2D", "root_node_name": "Body"})
	# The shapeless node create_scene happily accepts, and Godot only complains
	# about at runtime.
	st.add_node({"scene_path": scene, "node_name": "CollisionShape2D", "node_type": "CollisionShape2D", "parent_path": "."})

	var r = ph.setup_collision({"scene_path": scene, "node_path": ".", "shape_type": "rectangle", "size": {"x": 16, "y": 32}})
	_check(r.get("ok", false), "setup_collision ok")
	_check(r.get("reused_existing_node", false), "filled the empty shape node instead of adding a sibling")

	var tree = st.read_scene({"scene_path": scene})
	var kids: Array = tree.get("root", {}).get("children", [])
	var shape_count := 0
	for k in kids:
		if str(k.get("type", "")) == "CollisionShape2D":
			shape_count += 1
	_check(shape_count == 1, "still exactly one CollisionShape2D (got %d)" % shape_count)

	# Calling it again with nothing empty left must add a new one rather than
	# overwrite the working shape.
	var r2 = ph.setup_collision({"scene_path": scene, "node_path": ".", "shape_type": "circle", "node_name": "Extra"})
	_check(r2.get("ok", false) and not r2.get("reused_existing_node", true), "a second call adds a node when none is empty")

	# --- sprite track order ---
	var scene2 := "res://__gdtest_trackorder.tscn"
	_rm(scene2)
	st.create_scene({"scene_path": scene2, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene2, "node_name": "Anim", "node_type": "AnimationPlayer", "parent_path": "."})
	st.add_node({"scene_path": scene2, "node_name": "Spr", "node_type": "Sprite2D", "parent_path": "."})
	an.create_animation({"scene_path": scene2, "node_path": "Anim", "animation_name": "walk", "length": 1.0})

	# frame FIRST — the order that breaks.
	an.add_animation_track({"scene_path": scene2, "node_path": "Anim", "animation_name": "walk",
		"track_type": "value", "track_node_path": "Spr", "property": "frame"})
	var warned = an.add_animation_track({"scene_path": scene2, "node_path": "Anim", "animation_name": "walk",
		"track_type": "value", "track_node_path": "Spr", "property": "hframes"})
	_check(warned.get("warning") != null, "the dangerous track order is reported")
	_check(str(warned.get("warning", "")).contains("out of bounds"), "and says what Godot will do about it")

	# The safe order stays quiet.
	an.create_animation({"scene_path": scene2, "node_path": "Anim", "animation_name": "run", "length": 1.0})
	an.add_animation_track({"scene_path": scene2, "node_path": "Anim", "animation_name": "run",
		"track_type": "value", "track_node_path": "Spr", "property": "hframes"})
	var quiet = an.add_animation_track({"scene_path": scene2, "node_path": "Anim", "animation_name": "run",
		"track_type": "value", "track_node_path": "Spr", "property": "frame"})
	_check(quiet.get("warning") == null, "the correct order produces no warning")

	an.free(); ph.free(); st.free()
	_rm(scene)
	_rm(scene2)


# Building one animated character used to take ~40 calls, and the track ORDER
# had to be right or Godot logged "Index p_frame is out of bounds" every frame.
func _test_sprite_animation() -> void:
	print("
[sprite animation]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var an = preload("res://addons/godot_mcp/tools/animation_tools.gd").new()

	# A real 4x2 sheet, saved as a .tres ImageTexture rather than a .png: load()
	# resolves the IMPORTED resource, and this suite runs headless with no import
	# pipeline, so a freshly written image would never load. The tool's slicing
	# and track ordering are what is under test; importing is Godot's job.
	var sheet := "res://__gdtest_sheet.tres"
	_rm(sheet)
	var img := Image.create(64, 32, false, Image.FORMAT_RGBA8)
	img.fill(Color(1, 0, 1, 1))
	ResourceSaver.save(ImageTexture.create_from_image(img), sheet)

	var scene := "res://__gdtest_spriteanim.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Anim", "node_type": "AnimationPlayer", "parent_path": "."})
	st.add_node({"scene_path": scene, "node_name": "Spr", "node_type": "Sprite2D", "parent_path": "."})

	var r = an.create_sprite_animation({
		"scene_path": scene, "node_path": "Anim", "sprite_path": "Spr",
		"animation_name": "run", "texture": sheet,
		"hframes": 4, "vframes": 2, "frames": 8, "fps": 8.0, "loop": true})
	_check(r.get("ok", false), "create_sprite_animation ok (%s)" % str(r.get("error", "")))
	_check(int(r.get("frame_count", 0)) == 8, "keys one frame each")
	_check(abs(float(r.get("length", 0.0)) - 1.0) < 0.001, "length = frames/fps")

	# The whole point: layout tracks must precede the frame track.
	var info = an.get_animation_info({"scene_path": scene, "node_path": "Anim", "animation_name": "run"})
	var frame_idx := -1
	var hframes_idx := -1
	for t in info.get("tracks", []):
		var path := str(t.get("path", ""))
		if path.ends_with(":frame"):
			frame_idx = int(t.get("index", -1)) if t.has("index") else frame_idx
		elif path.ends_with(":hframes"):
			hframes_idx = int(t.get("index", -1)) if t.has("index") else hframes_idx
	var paths: Array = []
	for t in info.get("tracks", []):
		paths.append(str(t.get("path", "")))
	var i_h := paths.find("Spr:hframes")
	var i_f := paths.find("Spr:frame")
	_check(i_h >= 0 and i_f >= 0, "both layout and frame tracks exist")
	_check(i_h < i_f, "hframes track comes BEFORE the frame track (%d < %d)" % [i_h, i_f])

	# A frame outside the sheet is refused rather than silently written.
	var bad = an.create_sprite_animation({
		"scene_path": scene, "node_path": "Anim", "sprite_path": "Spr",
		"animation_name": "bad", "hframes": 2, "vframes": 1, "frames": [0, 1, 9]})
	_check(not bad.get("ok", true), "a frame outside the sheet is rejected")
	_check(str(bad.get("error", "")).contains("0..1"), "and the error names the valid range")

	# Wrong node type points at the other tool.
	var wrong = an.create_sprite_animation({
		"scene_path": scene, "node_path": "Anim", "sprite_path": ".",
		"animation_name": "x", "hframes": 1})
	_check(str(wrong.get("error", "")).contains("create_sprite_frames"), "a non-Sprite2D is redirected to the right tool")

	# --- SpriteFrames ---
	var frames_path := "res://__gdtest_frames.tres"
	_rm(frames_path)
	var fr = an.create_sprite_frames({"path": frames_path, "animations": [
		{"name": "idle", "texture": sheet, "hframes": 4, "vframes": 2, "frames": 4, "fps": 6.0},
		{"name": "run", "texture": sheet, "hframes": 4, "vframes": 2, "frames": [4, 5, 6, 7], "fps": 12.0},
	]})
	_check(fr.get("ok", false), "create_sprite_frames ok (%s)" % str(fr.get("error", "")))
	_check(FileAccess.file_exists(frames_path), "resource written to disk")

	var loaded := load(frames_path) as SpriteFrames
	_check(loaded != null, "it loads back as a SpriteFrames")
	_check(loaded.has_animation("idle") and loaded.has_animation("run"), "both animations present")
	_check(not loaded.has_animation("default"), "the stock empty 'default' animation is removed")
	_check(loaded.get_frame_count("run") == 4, "run has 4 frames")
	_check(abs(loaded.get_animation_speed("run") - 12.0) < 0.001, "per-animation fps kept")

	# Frame 4 of a 4x2 sheet is row 1, column 0 — proves the slicing maths.
	var f0 := loaded.get_frame_texture("run", 0) as AtlasTexture
	_check(f0 != null, "frames are AtlasTextures over the shared sheet")
	_check(f0.region.position.x == 0.0 and f0.region.position.y == 16.0,
		"frame 4 maps to row 1 col 0 (got %s)" % str(f0.region.position))

	var bad_tex = an.create_sprite_frames({"path": frames_path, "animations": [
		{"name": "x", "texture": "res://__does_not_exist.png"}]})
	_check(not bad_tex.get("ok", true), "a missing texture is rejected")

	an.free(); st.free()
	_rm(frames_path)
	_rm(scene)
	_rm(sheet)


# 2D and 3D skeletons are different models, not two spellings of one: Skeleton3D
# owns bones as internal indices, Skeleton2D owns Bone2D NODES. Both paths are
# exercised so the difference stays visible rather than being papered over.
func _test_skeleton_tools() -> void:
	print("
[skeleton / bones]")
	var st = preload("res://addons/godot_mcp/tools/scene_tools.gd").new()
	var s3 = preload("res://addons/godot_mcp/tools/scene3d_tools.gd").new()

	# --- 3D ---
	var scene := "res://__gdtest_skel3d.tscn"
	_rm(scene)
	st.create_scene({"scene_path": scene, "root_node_type": "Node3D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene, "node_name": "Skel", "node_type": "Skeleton3D", "parent_path": "."})

	var a = s3.add_bone({"scene_path": scene, "node_path": "Skel", "bone_name": "hip"})
	_check(a.get("ok", false), "add_bone (3D) ok (%s)" % str(a.get("error", "")))
	_check(str(a.get("kind", "")) == "3d", "reports the 3D model")
	var b = s3.add_bone({"scene_path": scene, "node_path": "Skel", "bone_name": "spine", "parent_bone": "hip"})
	_check(b.get("ok", false), "a child bone is added")
	_check(int(b.get("parent_index", -99)) == int(a.get("bone_index", -1)), "parented to the right bone")

	var dup = s3.add_bone({"scene_path": scene, "node_path": "Skel", "bone_name": "hip"})
	_check(not dup.get("ok", true), "a duplicate bone name is rejected")
	var orphan = s3.add_bone({"scene_path": scene, "node_path": "Skel", "bone_name": "x", "parent_bone": "nope"})
	_check(not orphan.get("ok", true), "an unknown parent bone is rejected")
	_check(str(orphan.get("error", "")).contains("hip"), "and the error lists the bones that exist")

	var info = s3.get_skeleton_info({"scene_path": scene, "node_path": "Skel"})
	_check(info.get("ok", false), "get_skeleton_info ok")
	_check(int(info.get("bone_count", 0)) == 2, "both bones reported")

	var posed = s3.set_bone_pose({"scene_path": scene, "node_path": "Skel", "bone_name": "spine",
		"position": {"x": 0, "y": 1, "z": 0}})
	_check(posed.get("ok", false), "set_bone_pose (3D) ok (%s)" % str(posed.get("error", "")))
	var bad_pose = s3.set_bone_pose({"scene_path": scene, "node_path": "Skel", "bone_name": "spine",
		"position": {"x": 1, "y": 2}})
	_check(not bad_pose.get("ok", true), "a Vector2 is refused for a 3D bone")
	var nothing = s3.set_bone_pose({"scene_path": scene, "node_path": "Skel", "bone_name": "spine"})
	_check(not nothing.get("ok", true), "posing nothing is an error, not a silent no-op")

	# --- 2D ---
	var scene2 := "res://__gdtest_skel2d.tscn"
	_rm(scene2)
	st.create_scene({"scene_path": scene2, "root_node_type": "Node2D", "root_node_name": "Root"})
	st.add_node({"scene_path": scene2, "node_name": "Skel", "node_type": "Skeleton2D", "parent_path": "."})

	var a2 = s3.add_bone({"scene_path": scene2, "node_path": "Skel", "bone_name": "hip",
		"rest": {"x": 0, "y": 10}, "length": 12.0})
	_check(a2.get("ok", false), "add_bone (2D) ok (%s)" % str(a2.get("error", "")))
	_check(str(a2.get("kind", "")) == "2d", "reports the 2D model")
	var a3 = s3.add_bone({"scene_path": scene2, "node_path": "Skel", "bone_name": "spine", "parent_bone": "hip"})
	_check(a3.get("ok", false), "a chained Bone2D is added under its parent")
	_check(str(a3.get("parent_node_path", "")).contains("hip"), "nested under the parent bone node")

	var info2 = s3.get_skeleton_info({"scene_path": scene2, "node_path": "Skel"})
	_check(str(info2.get("kind", "")) == "2d", "2D skeleton reports kind=2d")
	_check(int(info2.get("bone_count", 0)) == 2, "both Bone2D nodes counted")
	var first: Dictionary = (info2.get("bones", [])[0])
	_check(not str(first.get("node_path", "")).is_empty(), "2D bones expose a node_path")

	var posed2 = s3.set_bone_pose({"scene_path": scene2, "node_path": "Skel", "bone_name": "hip",
		"position": {"x": 5, "y": 6}, "rotation": 0.5})
	_check(posed2.get("ok", false), "set_bone_pose (2D) ok (%s)" % str(posed2.get("error", "")))
	_check(FileAccess.get_file_as_string(scene2).contains("position = Vector2(5, 6)"), "the 2D pose persisted")

	var wrong = s3.get_skeleton_info({"scene_path": scene2, "node_path": "."})
	_check(not wrong.get("ok", true), "a non-skeleton node is rejected")

	s3.free(); st.free()
	_rm(scene)
	_rm(scene2)


# Authority is runtime state: `multiplayer_authority` is NOT a property, only
# set_multiplayer_authority() exists. Verified against the engine — a tool that
# wrote it into a .tscn would be writing something Godot never reads back.
func _test_mp_authority() -> void:
	print("
[mp_set_authority]")
	var nc = preload("res://addons/godot_mcp/tools/netcode_tools.gd").new()

	# The premise, asserted rather than assumed.
	var probe := Node2D.new()
	var has_prop := false
	for pr in probe.get_property_list():
		if str(pr.name) == "multiplayer_authority":
			has_prop = true
	_check(not has_prop, "multiplayer_authority is not a storable property")
	_check(probe.has_method("set_multiplayer_authority"), "only the setter exists")
	probe.free()

	var script := "res://__gdtest_auth.gd"
	_rm(script)
	var f := FileAccess.open(script, FileAccess.WRITE)
	f.store_string("extends Node2D

func _ready() -> void:
	pass
")
	f.close()

	var r = nc.mp_set_authority({"script_path": script, "peer_id": 1})
	_check(r.get("ok", false), "mp_set_authority ok (%s)" % str(r.get("error", "")))
	_check(r.get("called_from_existing_ready", false), "hooks into the existing _ready()")
	var body := FileAccess.get_file_as_string(script)
	_check(body.contains("set_multiplayer_authority(1)"), "writes the real call")
	_check(body.contains("_mcp_claim_authority()"), "and calls it from _ready")

	var again = nc.mp_set_authority({"script_path": script, "peer_id": 2})
	_check(not again.get("ok", true), "a second assignment is refused rather than fighting the first")

	# "owner" resolves to the spawning peer, which is the per-player case.
	var script2 := "res://__gdtest_auth2.gd"
	_rm(script2)
	var f2 := FileAccess.open(script2, FileAccess.WRITE)
	f2.store_string("extends Node2D
")
	f2.close()
	var r2 = nc.mp_set_authority({"script_path": script2, "peer_id": "owner", "recursive": true})
	_check(r2.get("ok", false), "peer_id 'owner' accepted")
	var body2 := FileAccess.get_file_as_string(script2)
	_check(body2.contains("multiplayer.get_unique_id()"), "resolves to the spawning peer")
	_check(body2.contains(", true)"), "recursive is passed through")
	_check(body2.contains("func _ready()"), "writes a _ready() when the script has none")

	var missing = nc.mp_set_authority({"script_path": script2})
	_check(not missing.get("ok", true), "a missing peer_id is an error")
	_check(str(missing.get("error", "")).contains("owner"), "and the error explains the options")
	var nofile = nc.mp_set_authority({"script_path": "res://__does_not_exist.gd", "peer_id": 1})
	_check(not nofile.get("ok", true), "a missing script is rejected")

	_rm(script)
	_rm(script2)
	nc.free()
