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
