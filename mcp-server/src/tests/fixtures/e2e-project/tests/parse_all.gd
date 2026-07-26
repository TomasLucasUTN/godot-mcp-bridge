extends SceneTree
## Compile every addon GDScript, so a syntax error in a file the logic tests
## never preload still fails the build instead of waiting to blow up in a live
## editor.
##
## This COMPILES the source rather than calling load(). load() consults the
## resource cache and can hand back a previously-good copy — which is exactly how
## a file broken by an edit sailed through this check while the real test suite
## died on it. GDScript.reload() on the raw source has no such escape hatch.
##
## `class_name` is stripped for the same reason validate_script strips it: a
## fresh compile of source that declares an already-registered global class fails
## with a bogus "hides a global script class". The throwaway script also gets a
## path next to the original, so path-sensitive warning settings (notably
## `exclude_addons`) behave the way they do for the real file.

var _seq := 0

func _initialize() -> void:
	var bad := 0
	var total := 0
	for path in _walk("res://addons/godot_mcp"):
		total += 1
		if not _compiles(path):
			bad += 1
			printerr("  FAIL compile: ", path)
	print("=== PARSE: %d scripts, %d failed ===" % [total, bad])
	quit(1 if bad > 0 else 0)

func _compiles(path: String) -> bool:
	var source := FileAccess.get_file_as_string(path)
	if source.is_empty():
		return true  # empty or unreadable is not a syntax error
	var stripped := PackedStringArray()
	for line in source.split("\n"):
		var s := line.strip_edges(true, false)
		if s.begins_with("class_name") and s.length() > 10 and (s[10] == " " or s[10] == "\t"):
			stripped.append("")
		else:
			stripped.append(line)
	_seq += 1
	var gd := GDScript.new()
	gd.resource_path = "%s/__parse_check_%d.gd" % [path.get_base_dir(), _seq]
	gd.source_code = "\n".join(stripped)
	return gd.reload() == OK

func _walk(dir_path: String) -> Array:
	var out: Array = []
	var d := DirAccess.open(dir_path)
	if d == null:
		return out
	d.list_dir_begin()
	var name := d.get_next()
	while name != "":
		var full := dir_path.path_join(name)
		if d.current_is_dir():
			out += _walk(full)
		elif name.ends_with(".gd"):
			out.append(full)
		name = d.get_next()
	d.list_dir_end()
	return out
