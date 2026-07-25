extends Node
## Minimal multiplayer sample for exercising the MCP peer-spawn harness.
##
## Run normally (run_scene) → HOSTS a server on PORT. Launched headless with the
## user arg `--mp-client` (as spawn_headless_peers does) → connects as a CLIENT.
## Spawned peers also get `--no-mcp` so they don't grab the MCP runtime socket.
##
## The agent runs this as the server, spawns N client peers, then checks
## get_multiplayer_status (connected_peers grows) or await_signal_runtime on
## multiplayer's peer_connected.

const PORT := 7777

var role := "server"

func _ready() -> void:
	var uargs := OS.get_cmdline_user_args()
	var peer := ENetMultiplayerPeer.new()
	if uargs.has("--mp-client"):
		role = "client"
		var err := peer.create_client("127.0.0.1", PORT)
		if err != OK:
			push_error("[mp] client create failed: %d" % err)
			return
	else:
		role = "server"
		var err := peer.create_server(PORT)
		if err != OK:
			push_error("[mp] server create failed (port %d in use?): %d" % [PORT, err])
			return
	multiplayer.multiplayer_peer = peer
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	print("[mp] started as %s (id=%d) on port %d" % [role, multiplayer.get_unique_id(), PORT])

func _on_peer_connected(id: int) -> void:
	print("[mp] peer connected: %d (total peers: %d)" % [id, multiplayer.get_peers().size()])

func _on_peer_disconnected(id: int) -> void:
	print("[mp] peer disconnected: %d" % id)

## Callable over RPC — the agent can call this on the server via call_rpc_runtime
## to broadcast to every connected client.
@rpc("any_peer", "call_local", "reliable")
func broadcast_ping(msg: String) -> void:
	print("[mp] ping '%s' from %d" % [msg, multiplayer.get_remote_sender_id()])
