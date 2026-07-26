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
	print("\n=== RESULT: %d passed, %d failed ===" % [_pass, _fail])
	quit(1 if _fail > 0 else 0)

func _check(cond: bool, msg: String) -> void:
	if cond:
		_pass += 1
		print("  ok   ", msg)
	else:
		_fail += 1
		printerr("  FAIL ", msg)

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

	# The digest stays small even after a burst.
	log._agent_until_ms = 0
	for i in range(20):
		log.record("selection", ["N%d" % i])
	var d2: Dictionary = log.human_digest()
	_check(int(d2.get("human_events_since_last_call", 0)) == 20, "counts every human event")
	_check(Array(d2.get("recent", [])).size() == 5, "but only ships the last few (token cap)")

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
