# Working against a real Godot project with this MCP

> Design judgment for using the godot_mcp tools against a real Godot project —
> not a loadable Claude Code skill, just project documentation for whoever
> (human or AI) is working in this repo.

This is design guidance, not a tool catalog — for "which tool does X" use the
`tool-index` guide (`get_guide({ slug: "tool-index" })`). This file is about
judgment calls the tool schemas don't make for you.

## Batch property edits, not N single calls

When configuring several properties on the *same* node (e.g. a new
`CharacterBody2D`'s `position`, `collision_layer`, `collision_mask`,
`floor_snap_length`), use `set_node_properties` with all of them in one
call instead of N calls to `modify_node_property`. Reasons this matters
beyond "fewer round trips":

- Each `modify_node_property` call independently loads and re-saves the
  scene file. N separate saves means N chances for an intermediate state
  to be inconsistent if something fails partway through.
- `batch_set_property` is the same idea but across *multiple nodes matching
  a type* (e.g. set `gravity_scale` on every `RigidBody2D` in a scene) —
  reach for it instead of looping `find_nodes_by_type` + per-node
  `modify_node_property` calls yourself.

Use `modify_node_property` only for genuinely one-off single-value changes.

## 2D vs 3D animation tracks are not interchangeable

`add_animation_track` / `set_animation_keyframe` take a `track_type` like
`"position"` or `"rotation"`. On a `Node2D` these type names are misleading:
Godot's `"position"`/`"rotation"` track types map to `TYPE_POSITION_3D` /
`TYPE_ROTATION_3D`, which expect `Vector3` and only apply to `Node3D`. For a
`Node2D` you need track type `"value"` targeting the `position` *property*
directly, with a `Vector2` keyframe value. Using `"position"` on a 2D node
used to silently no-op (`ok: true`, no keyframe inserted) — it's fixed to
return an explicit error now, but the underlying type mismatch is still
something to plan around before calling the tool: check whether the node is
`Node2D` or `Node3D` first, and pick `"value"`+`Vector2` vs
`"position"`/`"rotation"`+`Vector3` accordingly.

## Stop the scene before editing code

If a scene is running (`run_scene`), don't call `edit_script` /
`attach_script` / `create_script` against the live project — the running
instance keeps executing the old code, so a bug fix appears to do nothing
and gets "fixed" again on the next attempt. Call `stop_scene()` first, edit,
then `run_scene` again to pick up the change. This also applies to resource
edits that a running scene has already instanced (e.g. changing a
`CollisionShape2D.shape` on disk while the scene is playing won't retroactively
update the live node).

## Verify after destructive scene edits

After `remove_node`, `set_node_properties`, `modify_node_property`, or
`batch_set_property` against a saved scene, don't assume success from
`ok: true` alone — these calls can succeed while leaving the scene in a
broken or half-configured state (e.g. a node re-parented into a spot that
breaks a script's `@onready` path, or a resource slot left null).

The MCP server now runs `validate_scene_integrity({ scene_path })`
automatically after any of those four tools succeeds and saves to disk
(skipped for `dry_run: true` calls, since nothing changed on disk to check).
The result is attached to the tool's own response under `_integrity_check` —
check that field before moving on. If `_integrity_check.issue_count > 0`
there's an empty required resource slot (`CollisionShape2D.shape`,
`Sprite2D.texture`, `AudioStreamPlayer.stream`, etc.), the classic "added the
node but never configured it" mistake. If the secondary check itself fails to
run (e.g. Godot briefly disconnected), `_integrity_check` says so instead of
silently vanishing — the original tool's result is never held back for it.

Still worth doing manually, since the auto-check doesn't cover them:

1. `get_errors({ max_errors: 20 })` — catches parse/load errors immediately.
2. `run_scene_assertions({ scene_path, assertions: [...] })` — if you know
   specific properties that must hold after the edit (e.g. "Player.position.y
   should be > 0"), assert them explicitly rather than eyeballing the diff.

## Look before you leap on complex scenes

Before modifying a scene you haven't just created yourself, read it first:
`read_scene` or `scene_tree_dump` to see the actual node tree and paths
rather than guessing from filenames or prior assumptions. Node paths that
look plausible (`Player/Sprite`) are often wrong once nested Control layouts
or instanced sub-scenes are involved.

`remove_node`, `modify_node_property`, and `set_node_properties` all accept
a `dry_run: true` flag — use it first on a scene you're unsure about. It
returns the same shape as a real run (what would change, what would fail)
but skips saving, so you can inspect the outcome before committing.

## Addon development note (not relevant to using the MCP against your own game)

This applies only if you're modifying the `godot_mcp` addon's own `.gd`
source (e.g. adding a new tool). The addon installed in a Godot project is a
physical file copy, not a symlink — editing the source in this repo does not
automatically update what the running editor sees. Two restarts are needed
for a code change to take effect: resync the addon copy, then restart the
Godot editor process itself (and separately restart the MCP server process
if `mcp-server/src/**` TypeScript changed). If a change to addon code
"doesn't seem to work," check whether you actually resynced/restarted before
assuming the fix is wrong.
