@tool
extends SceneToolBase
class_name Scene3DTools
## 3D scene setup tools for MCP.
## Handles: add_mesh_instance, setup_lighting, set_material_3d, setup_environment,
##          setup_camera_3d, add_gridmap


# =============================================================================
# add_mesh_instance
# =============================================================================
const _MESH_TYPES: PackedStringArray = ["box", "sphere", "cylinder", "plane", "capsule", "torus"]

func _build_primitive_mesh(mesh_type: String, size: Variant) -> PrimitiveMesh:
	var parsed = _parse_value(size) if size != null else null
	match mesh_type:
		"box":
			var mesh := BoxMesh.new()
			if parsed is Vector3:
				mesh.size = parsed
			return mesh
		"sphere":
			var mesh := SphereMesh.new()
			if parsed is float or parsed is int:
				mesh.radius = float(parsed)
				mesh.height = float(parsed) * 2.0
			return mesh
		"cylinder":
			var mesh := CylinderMesh.new()
			if parsed is Vector2:
				mesh.top_radius = parsed.x
				mesh.bottom_radius = parsed.x
				mesh.height = parsed.y
			elif parsed is float or parsed is int:
				mesh.top_radius = float(parsed)
				mesh.bottom_radius = float(parsed)
			return mesh
		"plane":
			var mesh := PlaneMesh.new()
			if parsed is Vector2:
				mesh.size = parsed
			return mesh
		"capsule":
			var mesh := CapsuleMesh.new()
			if parsed is Vector2:
				mesh.radius = parsed.x
				mesh.height = parsed.y
			elif parsed is float or parsed is int:
				mesh.radius = float(parsed)
			return mesh
		"torus":
			var mesh := TorusMesh.new()
			if parsed is Vector2:
				mesh.inner_radius = parsed.x
				mesh.outer_radius = parsed.y
			elif parsed is float or parsed is int:
				mesh.outer_radius = float(parsed)
			return mesh
	return null

func add_mesh_instance(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var mesh_type: String = str(args.get(&"mesh_type", ""))
	var node_name: String = str(args.get(&"node_name", ""))
	var size = args.get(&"size")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if mesh_type not in _MESH_TYPES:
		return {&"ok": false, &"error": "Invalid 'mesh_type': %s. Use one of: %s" % [mesh_type, ", ".join(_MESH_TYPES)]}
	if node_name.strip_edges().is_empty():
		node_name = "MeshInstance3D"

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = node_name
	mesh_instance.mesh = _build_primitive_mesh(mesh_type, size)

	# Opened after the validations above so an early return can't leave an
	# action open on the editor's undo stack.
	var ctx := _begin_edit(is_live, "MCP: add %s" % mesh_instance.name, root)
	_edit_add_child(ctx, parent, mesh_instance, root)
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_name": mesh_instance.name, &"mesh_type": mesh_type,
		&"message": "Added MeshInstance3D (%s) to '%s'" % [mesh_type, parent_path]}

# =============================================================================
# setup_lighting
# =============================================================================
func setup_lighting(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var preset: String = str(args.get(&"preset", ""))
	var node_name: String = str(args.get(&"node_name", ""))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if preset not in ["sun", "indoor", "dramatic"]:
		return {&"ok": false, &"error": "Invalid 'preset': %s. Use 'sun', 'indoor', or 'dramatic'." % preset}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var light: Node3D
	var node_type: String
	if preset == "sun":
		var sun := DirectionalLight3D.new()
		sun.rotation_degrees = Vector3(-45, -45, 0)
		sun.light_energy = 1.0
		light = sun
		node_type = "DirectionalLight3D"
	else:
		var omni := OmniLight3D.new()
		if preset == "indoor":
			omni.light_color = Color(1.0, 0.92, 0.78)
			omni.light_energy = 0.8
			omni.omni_range = 10.0
		else: # dramatic
			omni.light_color = Color(0.2, 0.4, 1.0)
			omni.light_energy = 4.0
			omni.omni_range = 15.0
			omni.shadow_enabled = true
		light = omni
		node_type = "OmniLight3D"

	light.name = node_name if not node_name.strip_edges().is_empty() else node_type

	# Opened after the validations above so an early return can't leave an
	# action open on the editor's undo stack.
	var ctx := _begin_edit(is_live, "MCP: add %s" % light.name, root)
	_edit_add_child(ctx, parent, light, root)
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_name": light.name, &"node_type": node_type,
		&"preset": preset, &"message": "Added %s (%s preset) to '%s'" % [light.name, preset, parent_path]}

# =============================================================================
# set_material_3d
# =============================================================================
func set_material_3d(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var node_path: String = str(args.get(&"node_path", "."))
	var albedo_color = args.get(&"albedo_color")
	var metallic = args.get(&"metallic")
	var roughness = args.get(&"roughness")
	var emission_color = args.get(&"emission_color")
	var emission_energy = args.get(&"emission_energy")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var target = _find_node(root, node_path)
	if not target:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Node not found: " + node_path}
	if not (&"material_override" in target):
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Node '%s' (%s) has no 'material_override' property" % [node_path, target.get_class()]}

	# Parse and validate every colour BEFORE touching the node. On an open scene
	# _discard_scene is a no-op (target is the editor's live node, not a copy),
	# so validating a later argument after already assigning an earlier one
	# would leave those assignments applied while reporting total failure.
	var parsed_albedo = null
	if albedo_color != null:
		parsed_albedo = _parse_value(albedo_color)
		if not (parsed_albedo is Color):
			_discard_scene(root, is_live)
			return {&"ok": false, &"error": "'albedo_color' must be a Color, e.g. {\"r\":1,\"g\":1,\"b\":1,\"a\":1}"}
	var parsed_emission = null
	if emission_color != null:
		parsed_emission = _parse_value(emission_color)
		if not (parsed_emission is Color):
			_discard_scene(root, is_live)
			return {&"ok": false, &"error": "'emission_color' must be a Color, e.g. {\"r\":1,\"g\":1,\"b\":1,\"a\":1}"}

	var ctx := _begin_edit(is_live, "MCP: set material on %s" % node_path, root)
	var material: StandardMaterial3D = target.get(&"material_override") as StandardMaterial3D
	if not material:
		material = StandardMaterial3D.new()
		_edit_set(ctx, target, &"material_override", material)

	if parsed_albedo != null:
		_edit_set(ctx, material, &"albedo_color", parsed_albedo)
	if metallic != null:
		_edit_set(ctx, material, &"metallic", float(metallic))
	if roughness != null:
		_edit_set(ctx, material, &"roughness", float(roughness))
	if parsed_emission != null:
		_edit_set(ctx, material, &"emission_enabled", true)
		_edit_set(ctx, material, &"emission", Color(parsed_emission.r, parsed_emission.g, parsed_emission.b))
	if emission_energy != null:
		_edit_set(ctx, material, &"emission_enabled", true)
		_edit_set(ctx, material, &"emission_energy_multiplier", float(emission_energy))
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_path": node_path,
		&"message": "Updated material_override on '%s'" % node_path}

# =============================================================================
# setup_environment
# =============================================================================
func setup_environment(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var sky_top_color = args.get(&"sky_top_color")
	var sky_horizon_color = args.get(&"sky_horizon_color")
	var fog_enabled = args.get(&"fog_enabled")
	var glow_enabled = args.get(&"glow_enabled")
	var ssao_enabled = args.get(&"ssao_enabled")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}

	# Validate colours BEFORE acquiring and mutating the scene. This function
	# CREATES a WorldEnvironment node when none exists; on an open scene that
	# node is added to the editor's live tree and _discard_scene cannot take it
	# back, so a colour rejected further down would otherwise leave a stray node
	# behind while reporting failure.
	var parsed_sky_top = null
	if sky_top_color != null:
		parsed_sky_top = _parse_value(sky_top_color)
		if not (parsed_sky_top is Color):
			return {&"ok": false, &"error": "'sky_top_color' must be a Color"}
	var parsed_sky_horizon = null
	if sky_horizon_color != null:
		parsed_sky_horizon = _parse_value(sky_horizon_color)
		if not (parsed_sky_horizon is Color):
			return {&"ok": false, &"error": "'sky_horizon_color' must be a Color"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var world_env: WorldEnvironment = null
	for child in root.get_children():
		if child is WorldEnvironment:
			world_env = child
			break

	# Every colour argument is parsed above, before this point: creating the node
	# and then failing validation used to leave a stray WorldEnvironment in the
	# scene while reporting failure, because a live scene has nothing to roll
	# back to.
	var ctx := _begin_edit(is_live, "MCP: set up environment", root)

	var created := false
	if not world_env:
		world_env = WorldEnvironment.new()
		world_env.name = "WorldEnvironment"
		_edit_add_child(ctx, root, world_env, root)
		created = true

	var environment: Environment = world_env.environment
	if not environment:
		environment = Environment.new()
		_edit_set(ctx, world_env, &"environment", environment)

	var sky_material: ProceduralSkyMaterial = null
	if environment.sky and environment.sky.sky_material is ProceduralSkyMaterial:
		sky_material = environment.sky.sky_material
	if sky_top_color != null or sky_horizon_color != null:
		_edit_set(ctx, environment, &"background_mode", Environment.BG_SKY)
		if not environment.sky:
			_edit_set(ctx, environment, &"sky", Sky.new())
		if not sky_material:
			sky_material = ProceduralSkyMaterial.new()
			_edit_set(ctx, environment.sky, &"sky_material", sky_material)
		if parsed_sky_top != null:
			_edit_set(ctx, sky_material, &"sky_top_color", parsed_sky_top)
		if parsed_sky_horizon != null:
			_edit_set(ctx, sky_material, &"sky_horizon_color", parsed_sky_horizon)

	if fog_enabled != null:
		_edit_set(ctx, environment, &"fog_enabled", bool(fog_enabled))
	if glow_enabled != null:
		_edit_set(ctx, environment, &"glow_enabled", bool(glow_enabled))
	if ssao_enabled != null:
		_edit_set(ctx, environment, &"ssao_enabled", bool(ssao_enabled))
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"created": created,
		&"message": "Updated WorldEnvironment in " + scene_path}

# =============================================================================
# setup_camera_3d
# =============================================================================
func setup_camera_3d(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var node_name: String = str(args.get(&"node_name", "Camera3D"))
	var projection: String = str(args.get(&"projection", "perspective"))
	var fov = args.get(&"fov")
	var near = args.get(&"near")
	var far = args.get(&"far")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if projection not in ["perspective", "orthogonal"]:
		return {&"ok": false, &"error": "Invalid 'projection': %s. Use 'perspective' or 'orthogonal'." % projection}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var camera := Camera3D.new()
	camera.name = node_name
	camera.projection = Camera3D.PROJECTION_PERSPECTIVE if projection == "perspective" else Camera3D.PROJECTION_ORTHOGONAL
	if fov != null:
		camera.fov = float(fov)
	if near != null:
		camera.near = float(near)
	if far != null:
		camera.far = float(far)

	# Opened after the validations above so an early return can't leave an
	# action open on the editor's undo stack.
	var ctx := _begin_edit(is_live, "MCP: add %s" % camera.name, root)
	_edit_add_child(ctx, parent, camera, root)
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_name": camera.name,
		&"message": "Added Camera3D (%s) to '%s'" % [projection, parent_path]}

# =============================================================================
# add_gridmap
# =============================================================================
func add_gridmap(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var node_name: String = str(args.get(&"node_name", "GridMap"))
	var mesh_library_path = args.get(&"mesh_library_path")
	var cell_size = args.get(&"cell_size")

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var gridmap := GridMap.new()
	gridmap.name = node_name

	if mesh_library_path != null and not str(mesh_library_path).is_empty():
		var lib_path: String = _ensure_res_path(str(mesh_library_path))
		if not FileAccess.file_exists(lib_path):
			_discard_scene(root, is_live)
			return {&"ok": false, &"error": "MeshLibrary not found: " + lib_path}
		var lib := load(lib_path) as MeshLibrary
		if not lib:
			_discard_scene(root, is_live)
			return {&"ok": false, &"error": "Failed to load MeshLibrary: " + lib_path}
		gridmap.mesh_library = lib

	if cell_size != null:
		# Typed parse so [x, y, z] is accepted alongside {x, y, z} — the codec
		# needs the hint to know an array is meant as a vector here.
		var parsed = VariantCodec.parse_typed_value(cell_size, TYPE_VECTOR3)
		if not (parsed is Vector3):
			_discard_scene(root, is_live)
			return {&"ok": false, &"error": "'cell_size' must be a Vector3: {\"x\":2,\"y\":2,\"z\":2} or [2, 2, 2]"}
		gridmap.cell_size = parsed

	# Opened after the validations above so an early return can't leave an
	# action open on the editor's undo stack.
	var ctx := _begin_edit(is_live, "MCP: add %s" % gridmap.name, root)
	_edit_add_child(ctx, parent, gridmap, root)
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_name": gridmap.name,
		&"message": "Added GridMap to '%s'" % parent_path}
