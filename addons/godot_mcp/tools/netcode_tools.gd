@tool
extends SceneToolBase
class_name NetcodeTools
## Multiplayer scaffolding tools for MCP.
## Handles: mp_add_spawner, mp_add_synchronizer, mp_wire_rpc, mp_scaffold_lobby
##
## The runtime side of multiplayer (spawn_headless_peers, call_rpc_runtime,
## get_multiplayer_status) already exists for TESTING netcode. These build it:
## the high-level replication nodes Godot 4 uses (MultiplayerSpawner /
## MultiplayerSynchronizer) plus the RPC boilerplate, which are fiddly to author
## by hand because the useful state lives in a sub-resource
## (SceneReplicationConfig) rather than in plain properties.
##
## API verified against ClassDB on Godot 4.7 before writing.


# =============================================================================
# mp_add_spawner
# =============================================================================
## A MultiplayerSpawner replicates *node creation* from the authority to every
## peer: it watches `spawn_path` and, for scenes in its spawnable list, recreates
## them remotely. Without one, a node the server adds simply never exists on the
## clients.
func mp_add_spawner(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var node_name: String = str(args.get(&"node_name", "MultiplayerSpawner"))
	var spawn_path: String = str(args.get(&"spawn_path", "")).strip_edges()
	var spawnable_scenes: Array = args.get(&"spawnable_scenes", [])
	var spawn_limit: int = int(args.get(&"spawn_limit", 0))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if spawn_path.is_empty():
		return {&"ok": false, &"error": "Missing 'spawn_path' — the node new instances get added under (e.g. \"../Players\"), relative to the spawner."}

	# Validate every spawnable scene BEFORE touching the tree: on an open scene
	# a later failure cannot be rolled back (_discard_scene is a no-op there),
	# so a bad path must be caught while nothing has been mutated yet.
	var validated: Array = []
	for s in spawnable_scenes:
		var p: String = _ensure_res_path(str(s))
		if p == "res://__mcp_rejected_path__":
			return {&"ok": false, &"error": "Spawnable scene path escapes the project sandbox: " + str(s)}
		if not ResourceLoader.exists(p):
			return {&"ok": false, &"error": "Spawnable scene not found: " + p}
		validated.append(p)

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var spawner := MultiplayerSpawner.new()
	spawner.name = node_name
	spawner.spawn_path = NodePath(spawn_path)
	if spawn_limit > 0:
		spawner.spawn_limit = spawn_limit
	for p in validated:
		spawner.add_spawnable_scene(p)

	# Undo entry opened here, after the validations above: an action left open
	# by an early return would sit unclosed on the editor's undo stack.
	var ctx := _begin_edit(is_live, "MCP: add %s" % spawner.name, root)
	_edit_add_child(ctx, parent, spawner, root)
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	return {&"ok": true, &"scene_path": scene_path, &"node_name": spawner.name,
		&"spawn_path": spawn_path, &"spawnable_scenes": validated,
		&"message": "Added MultiplayerSpawner '%s' spawning into '%s' (%d scene(s))." % [spawner.name, spawn_path, validated.size()]}


# =============================================================================
# mp_add_synchronizer
# =============================================================================
## A MultiplayerSynchronizer replicates *property values* over time. The list of
## replicated properties lives in a SceneReplicationConfig sub-resource, where
## each entry carries independent spawn/sync flags — that indirection is what
## makes this tedious to write by hand.
##
## Property paths are relative to root_path and take the form ".:property"
## (e.g. ".:position"), matching what the editor's Replication dock produces.
func mp_add_synchronizer(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get(&"scene_path", "")))
	var parent_path: String = str(args.get(&"parent_path", "."))
	var node_name: String = str(args.get(&"node_name", "MultiplayerSynchronizer"))
	var root_path: String = str(args.get(&"root_path", "..")).strip_edges()
	var properties: Array = args.get(&"properties", [])
	var replication_interval: float = float(args.get(&"replication_interval", 0.0))

	if scene_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'scene_path'"}
	if properties.is_empty():
		return {&"ok": false, &"error": "Missing 'properties' — a non-empty array of property paths to replicate, e.g. [\".:position\", \".:velocity\"]."}

	# Normalise and validate before mutating anything (same reasoning as above).
	var prop_specs: Array = []
	for entry in properties:
		var path := ""
		var do_spawn := true
		var do_sync := true
		if entry is String:
			path = str(entry)
		elif entry is Dictionary:
			path = str(entry.get(&"path", ""))
			do_spawn = bool(entry.get(&"spawn", true))
			do_sync = bool(entry.get(&"sync", true))
		else:
			return {&"ok": false, &"error": "Each 'properties' entry must be a string or {path, spawn?, sync?}"}
		path = path.strip_edges()
		if path.is_empty():
			return {&"ok": false, &"error": "A 'properties' entry has an empty path"}
		# ".:position" is the form the Replication dock writes; accept a bare
		# "position" and normalise it rather than silently replicating nothing.
		if not path.contains(":"):
			path = ".:" + path
		prop_specs.append({&"path": path, &"spawn": do_spawn, &"sync": do_sync})

	var result := _acquire_scene(scene_path)
	if not result[2].is_empty():
		return result[2]
	var root: Node = result[0]
	var is_live: bool = result[1]

	var parent = _find_node(root, parent_path)
	if not parent:
		_discard_scene(root, is_live)
		return {&"ok": false, &"error": "Parent node not found: " + parent_path}

	var config := SceneReplicationConfig.new()
	for spec in prop_specs:
		var np := NodePath(str(spec[&"path"]))
		config.add_property(np, -1)
		config.property_set_spawn(np, bool(spec[&"spawn"]))
		config.property_set_sync(np, bool(spec[&"sync"]))

	var sync := MultiplayerSynchronizer.new()
	sync.name = node_name
	sync.root_path = NodePath(root_path)
	sync.replication_config = config
	if replication_interval > 0.0:
		sync.replication_interval = replication_interval

	# Undo entry opened here, after the validations above: an action left open
	# by an early return would sit unclosed on the editor's undo stack.
	var ctx := _begin_edit(is_live, "MCP: add %s" % sync.name, root)
	_edit_add_child(ctx, parent, sync, root)
	_edit_commit(ctx)

	var err := _finish_scene_edit(root, scene_path, is_live)
	if not err.is_empty():
		return err

	var applied: Array = []
	for spec in prop_specs:
		applied.append(spec[&"path"])

	return {&"ok": true, &"scene_path": scene_path, &"node_name": sync.name,
		&"root_path": root_path, &"properties": applied,
		&"message": "Added MultiplayerSynchronizer '%s' replicating %d propert%s." % [sync.name, applied.size(), "y" if applied.size() == 1 else "ies"]}


# =============================================================================
# mp_wire_rpc
# =============================================================================
## Append a correctly-annotated @rpc method to a script. Getting the annotation
## wrong is the classic Godot-4 multiplayer bug: the call silently does nothing
## remotely, with no error, because the mode did not match how it was invoked.
func mp_wire_rpc(args: Dictionary) -> Dictionary:
	var script_path: String = _ensure_res_path(str(args.get(&"script_path", "")))
	var method: String = str(args.get(&"method", "")).strip_edges()
	var mode: String = str(args.get(&"mode", "authority")).strip_edges()
	var transfer: String = str(args.get(&"transfer_mode", "reliable")).strip_edges()
	var call_local: bool = bool(args.get(&"call_local", false))
	var params: Array = args.get(&"params", [])

	if script_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'script_path'"}
	if method.is_empty():
		return {&"ok": false, &"error": "Missing 'method'"}
	if not method.is_valid_identifier():
		return {&"ok": false, &"error": "'%s' is not a valid GDScript identifier" % method}
	if mode not in ["authority", "any_peer"]:
		return {&"ok": false, &"error": "Invalid 'mode': %s. Use \"authority\" (only the authority may call it) or \"any_peer\"." % mode}
	if transfer not in ["reliable", "unreliable", "unreliable_ordered"]:
		return {&"ok": false, &"error": "Invalid 'transfer_mode': %s. Use reliable, unreliable, or unreliable_ordered." % transfer}

	if not FileAccess.file_exists(script_path):
		return {&"ok": false, &"error": "Script not found: " + script_path}

	var f := FileAccess.open(script_path, FileAccess.READ)
	if f == null:
		return {&"ok": false, &"error": "Could not read " + script_path}
	var source := f.get_as_text()
	f.close()

	# A second @rpc with the same name would compile but shadow confusingly.
	if source.contains("func %s(" % method):
		return {&"ok": false, &"error": "Script already defines a method named '%s'" % method}

	var param_list: Array = []
	for p in params:
		if p is String:
			param_list.append(str(p))
		elif p is Dictionary:
			var pname := str(p.get(&"name", ""))
			var ptype := str(p.get(&"type", ""))
			if pname.is_empty():
				return {&"ok": false, &"error": "Each 'params' entry needs a name"}
			param_list.append(pname if ptype.is_empty() else "%s: %s" % [pname, ptype])
		else:
			return {&"ok": false, &"error": "Each 'params' entry must be a string or {name, type?}"}

	var annotation := "@rpc(\"%s\", \"%s\"%s)" % [
		mode, transfer, ", \"call_local\"" if call_local else ""
	]
	var body := "%s\nfunc %s(%s) -> void:\n\tpass # TODO: implement\n" % [
		annotation, method, ", ".join(param_list)
	]

	if not source.ends_with("\n"):
		source += "\n"
	source += "\n" + body

	var w := FileAccess.open(script_path, FileAccess.WRITE)
	if w == null:
		return {&"ok": false, &"error": "Could not write " + script_path}
	w.store_string(source)
	w.close()

	return {&"ok": true, &"script_path": script_path, &"method": method,
		&"annotation": annotation,
		&"generated": body.strip_edges(),
		&"message": "Added %s %s() to %s. Call it from the runtime with call_rpc_runtime." % [annotation, method, script_path],
		&"note": "\"authority\" means only the node's authority may invoke it; use \"any_peer\" if clients need to call it on the server."}


# =============================================================================
# mp_scaffold_lobby
# =============================================================================
## Build the host/join plumbing every Godot multiplayer project needs: an
## ENetMultiplayerPeer set up as either server or client, plus the peer
## connect/disconnect signal handlers. This is the boilerplate that is identical
## in every project and easy to get subtly wrong.
func mp_scaffold_lobby(args: Dictionary) -> Dictionary:
	var script_path: String = _ensure_res_path(str(args.get(&"script_path", "")))
	var port: int = int(args.get(&"port", 7777))
	var max_clients: int = int(args.get(&"max_clients", 8))
	var default_address: String = str(args.get(&"default_address", "127.0.0.1"))

	if script_path.strip_edges() == "res://":
		return {&"ok": false, &"error": "Missing 'script_path' (where to write the lobby script, e.g. res://net/lobby.gd)"}
	if FileAccess.file_exists(script_path):
		return {&"ok": false, &"error": "Refusing to overwrite an existing file: " + script_path}
	if port < 1 or port > 65535:
		return {&"ok": false, &"error": "'port' must be between 1 and 65535"}

	var dir := script_path.get_base_dir()
	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(dir)):
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir))

	var src := """extends Node
## Multiplayer lobby: hosting, joining, and peer tracking.
## Generated by godot-mcp-bridge (mp_scaffold_lobby).

signal peer_joined(id: int)
signal peer_left(id: int)
signal connection_failed()
signal connected_to_server()

const PORT := %d
const MAX_CLIENTS := %d
const DEFAULT_ADDRESS := "%s"

var peers: Array[int] = []

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(func(): connected_to_server.emit())
	multiplayer.connection_failed.connect(func(): connection_failed.emit())

## Start listening. Returns OK, or the error code from create_server.
func host() -> int:
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_server(PORT, MAX_CLIENTS)
	if err != OK:
		push_error("Failed to host on port %%d: %%d (is it already in use?)" %% [PORT, err])
		return err
	multiplayer.multiplayer_peer = peer
	return OK

## Connect to a host. Returns OK, or the error code from create_client.
func join(address: String = DEFAULT_ADDRESS) -> int:
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_client(address, PORT)
	if err != OK:
		push_error("Failed to connect to %%s:%%d: %%d" %% [address, PORT, err])
		return err
	multiplayer.multiplayer_peer = peer
	return OK

## Drop the connection and reset to single-player.
func leave() -> void:
	if multiplayer.multiplayer_peer:
		multiplayer.multiplayer_peer.close()
	multiplayer.multiplayer_peer = null
	peers.clear()

func is_hosting() -> bool:
	return multiplayer.multiplayer_peer != null and multiplayer.is_server()

func _on_peer_connected(id: int) -> void:
	if not peers.has(id):
		peers.append(id)
	peer_joined.emit(id)

func _on_peer_disconnected(id: int) -> void:
	peers.erase(id)
	peer_left.emit(id)
""" % [port, max_clients, default_address]

	var w := FileAccess.open(script_path, FileAccess.WRITE)
	if w == null:
		return {&"ok": false, &"error": "Could not write " + script_path}
	w.store_string(src)
	w.close()

	return {&"ok": true, &"script_path": script_path, &"port": port,
		&"max_clients": max_clients,
		&"message": "Scaffolded lobby at %s (host/join/leave + peer tracking on port %d)." % [script_path, port],
		&"next_steps": [
			"Register it as an autoload with setup_autoload so any scene can reach it.",
			"Call host() or join(address) from your menu UI.",
			"Add a MultiplayerSpawner (mp_add_spawner) for the player scene.",
		]}
