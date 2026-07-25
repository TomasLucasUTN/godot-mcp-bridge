@tool
extends SceneToolBase
class_name NavigationTools
## Navigation tools for MCP.
## Handles: setup_navigation_region, bake_navigation_mesh,
##          setup_navigation_agent, set_navigation_layers, get_navigation_info


func _layers_to_mask(layers: Array) -> int:
	var mask := 0
	for l in layers:
		var idx := int(l)
		if idx >= 1 and idx <= 32:
			mask |= 1 << (idx - 1)
	return mask

func _mask_to_layers(mask: int) -> Array:
	var layers: Array = []
	for i in range(32):
		if mask & (1 << i):
			layers.append(i + 1)
	return layers

# =============================================================================
# setup_navigation_region
# =============================================================================
func setup_navigation_region(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var dimension: String = str(args.get(&"dimension", "2D"))
	var node_name: String = str(args.get(&"node_name", ""))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if dimension not in ["2D", "3D"]:
		return {&"ok": false, &"error": "Invalid 'dimension': %s. Use '2D' or '3D'." % dimension}

	var node_type: String = "NavigationRegion2D" if dimension == "2D" else "NavigationRegion3D"
	if node_name.strip_edges().is_empty():
		node_name = node_type

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var region: Node = ClassDB.instantiate(node_type)
	region.name = node_name

	if dimension == "2D":
		region.set(&"navigation_polygon", NavigationPolygon.new())
	else:
		region.set(&"navigation_mesh", NavigationMesh.new())

	parent.add_child(region, true)
	region.owner = root

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_name": region.name, &"node_type": node_type,
		&"message": "Added %s (%s) to '%s'" % [region.name, node_type, parent_path]}

# =============================================================================
# bake_navigation_mesh
# =============================================================================
## Bakes from the region's own children (collision shapes / meshes act as
## source geometry by default). Runs synchronously (on_thread=false) since
## this is a one-shot RPC call that needs the result immediately.
func bake_navigation_mesh(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var target := _find_node(root, node_path)
	if not target:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Node not found: " + node_path}

	var is_2d := target is NavigationRegion2D
	var is_3d := target is NavigationRegion3D
	if not is_2d and not is_3d:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Node '%s' (%s) is not a NavigationRegion2D/3D" % [node_path, target.get_class()]}

	if is_2d:
		if not target.get(&"navigation_polygon"):
			target.set(&"navigation_polygon", NavigationPolygon.new())
		target.call(&"bake_navigation_polygon", false)
	else:
		if not target.get(&"navigation_mesh"):
			target.set(&"navigation_mesh", NavigationMesh.new())
		target.call(&"bake_navigation_mesh", false)

	# NavigationRegion3D exposes get_bounds() (AABB); NavigationRegion2D does not —
	# its bounds come from NavigationServer2D by region RID (Rect2).
	var bounds
	if is_3d:
		bounds = target.call(&"get_bounds")
	else:
		bounds = NavigationServer2D.region_get_bounds(target.get_region_rid())

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"bounds": VariantCodec.serialize_value(bounds),
		&"message": "Baked navigation mesh for '%s'" % node_path}

# =============================================================================
# setup_navigation_agent
# =============================================================================
func setup_navigation_agent(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var dimension: String = str(args.get(&"dimension", "2D"))
	var node_name: String = str(args.get(&"node_name", ""))
	var radius = args.get(&"radius")
	var max_speed = args.get(&"max_speed")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if dimension not in ["2D", "3D"]:
		return {&"ok": false, &"error": "Invalid 'dimension': %s. Use '2D' or '3D'." % dimension}

	var node_type: String = "NavigationAgent2D" if dimension == "2D" else "NavigationAgent3D"
	if node_name.strip_edges().is_empty():
		node_name = node_type

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var agent: Node = ClassDB.instantiate(node_type)
	agent.name = node_name
	if radius != null:
		agent.set(&"radius", float(radius))
	if max_speed != null:
		agent.set(&"max_speed", float(max_speed))

	parent.add_child(agent, true)
	agent.owner = root

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_name": agent.name, &"node_type": node_type,
		&"message": "Added %s to '%s'" % [agent.name, parent_path]}

# =============================================================================
# set_navigation_layers
# =============================================================================
## Works on any node with a navigation_layers property: NavigationRegion2D/3D,
## NavigationAgent2D/3D.
func set_navigation_layers(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))
	var layers = args.get(&"layers")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if layers == null:
		return {&"ok": false, &"error": "Missing 'layers'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var target := _find_node(root, node_path)
	if not target:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Node not found: " + node_path}
	if not (&"navigation_layers" in target):
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Node '%s' (%s) has no 'navigation_layers' property" % [node_path, target.get_class()]}

	var mask: int = _layers_to_mask(layers) if layers is Array else int(layers)
	target.set(&"navigation_layers", mask)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"navigation_layers": mask, &"navigation_layers_bits": _mask_to_layers(mask),
		&"message": "Updated navigation_layers on '%s'" % node_path}

# =============================================================================
# get_navigation_info
# =============================================================================
func get_navigation_info(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var target := _find_node(root, node_path)
	if not target:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Node not found: " + node_path}

	var info: Dictionary = {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"node_type": target.get_class()}

	if &"navigation_layers" in target:
		var mask: int = int(target.get(&"navigation_layers"))
		info[&"navigation_layers"] = mask
		info[&"navigation_layers_bits"] = _mask_to_layers(mask)

	if target is NavigationRegion2D or target is NavigationRegion3D:
		info[&"enabled"] = bool(target.get(&"enabled"))
		info[&"is_baking"] = bool(target.call(&"is_baking"))
		# get_bounds() only exists on NavigationRegion3D (AABB); for 2D the bounds
		# live in NavigationServer2D keyed by region RID (Rect2).
		var region_bounds
		if target is NavigationRegion3D:
			region_bounds = target.call(&"get_bounds")
		else:
			region_bounds = NavigationServer2D.region_get_bounds(target.get_region_rid())
		info[&"bounds"] = VariantCodec.serialize_value(region_bounds)
		var mesh_res = target.get(&"navigation_polygon") if target is NavigationRegion2D else target.get(&"navigation_mesh")
		info[&"has_baked_data"] = mesh_res != null

	if target is NavigationAgent2D or target is NavigationAgent3D:
		info[&"radius"] = float(target.get(&"radius"))
		info[&"max_speed"] = float(target.get(&"max_speed"))
		info[&"avoidance_enabled"] = bool(target.get(&"avoidance_enabled"))

	_discard_scene(root, is_live)
	return info
