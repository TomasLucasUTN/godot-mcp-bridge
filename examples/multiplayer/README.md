# Multiplayer peer-spawn sample

Reference for the `spawn_headless_peers` harness. `mp_sample.gd` hosts a server by
default (run it with `run_scene`), and connects as a client when it sees the user arg
`--mp-client` (which `spawn_headless_peers` passes, alongside `--no-mcp`). Copy the scene
into your project (or follow the same server-default / `--mp-client` convention) to drive
a real networking test:

1. `run_scene` the scene → it hosts on port 7777.
2. `spawn_headless_peers({scene, count})` → N headless clients connect.
3. `get_multiplayer_status` → `connected_peers` grows to N.
4. `call_rpc_runtime` a `@rpc` method (e.g. `broadcast_ping`) → verified with `rpc_ok`.
5. `stop_headless_peers` → kills them (ENet drops them after its timeout).

Verified end-to-end 2026-07-25 against this sample (2 peers connect, RPC broadcasts,
peers drop after stop).
