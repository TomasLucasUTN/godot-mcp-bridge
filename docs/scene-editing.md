# Scene editing and bounded inspection

Scene mutations use `SceneToolBase` to preserve the editor's unsaved state. This
document describes the behavior callers can rely on and the limits they need to
handle explicitly.

## Choosing the target

| Target | Behavior |
|---|---|
| Active editor tab | Edit the live tree, register undo, leave `.tscn` unchanged. Save explicitly when ready. |
| Open inactive tab | Reject the operation. Focus that tab before retrying. Never silently fall back to its saved file. |
| Closed scene | Edit an isolated instance and save it. There is no editor undo history; use version control. |
| `dry_run: true` on an advertised preview tool | Use an isolated snapshot, including unsaved nodes in the active tab. No editor action, file or directory creation. |

Windows scene identity comparisons ignore filename case. Explicit saved-scene
assertions still inspect disk. `validate_scene_integrity` defaults to disk;
`use_live_tree: true` inspects the active editor tree instead. Automatic integrity
checks after edits use this live-aware mode.

Only pass `dry_run` to tools whose schema advertises it. File generators and
composite scaffolds do not automatically become transactional or previewable
because one of their internal operations supports preview.

## Resources, instances and inheritance

A closed-scene edit must not mutate a cached resource held by another scene, or
claim success while losing a change to an external `.tres`. Editable copies are
isolated first. Unchanged resources retain their external references; edited
copies are stored inside the scene. The original shared asset remains unchanged. Closed-scene acquisition reads a fresh
PackedScene rather than replaying an older cached version, so consecutive edits
do not overwrite one another when another object still holds that older scene.
Use explicit asset tools when the intention is to edit a shared asset itself.
Resources that cannot be isolated safely cause a diagnostic instead of a shared
mutation.

Non-editable descendants of a scene instance are rejected. Enable Editable
Children deliberately before modifying them, or edit their source scene. Non-root nodes
supplied by an instance or inherited base cannot be removed, renamed or reparented
through the derived scene: Godot cannot reliably serialize those changes. Local
nodes remain editable.

Creators and resource export refuse to overwrite an existing destination.
Use the appropriate editing tool for an existing resource. Script-specific tools
accept GDScript paths rather than rewriting arbitrary scene files. File rename
and project-wide refactors preflight affected open scenes before writing.

## Undo and failed calls

Live edits stage inverse operations and publish one history entry only after
success. Failed edits restore their changes without publishing an action into
redo or deleting the developer's existing redo history. Empty batches add no
history entry.

Script attachment/detachment preserves exported values through undo. Animation
key replacement restores the previous key; state removal restores its
transitions. Bone edits restore their previous serialized state. Newly created
AnimationTrees retain `active=true` for runtime, but do not start evaluating
animation tracks against editor data while being configured.

`batch_scene_edit` is a single-scene transaction. `batch_execute` is a sequence of
independent calls, with per-operation results and `all_ok`; it is not a transaction.
Scaffolds that create scripts and perform several edits also span separate actions.
Undoing a scene attachment does not delete an intentionally exported resource file.

## Reading large scenes without flooding context

`read_scene` returns at most **500 nodes by default**, or a caller-specified
`max_nodes` between 1 and 10,000. The budget applies to the whole returned branch,
not separately to each child.

```json
{"scene_path":"res://level.tscn","max_nodes":100,"properties":["position","visible"]}
```

If the budget is reached, the response includes `truncated`, `nodes_returned`
and a continuation hint. Nodes with omitted descendants include
`children_truncated`. Inspect those branches with `node_path`.

For wide branches, resume the direct children with the returned
`next_child_offset`:

```json
{"scene_path":"res://level.tscn","node_path":"Rooms","max_nodes":100,"child_offset":99}
```

Offsets index direct children of the requested branch. Nested truncated branches
must be inspected separately. They are not a stable cursor across concurrent
scene edits: if the developer changes the child list, start that branch again.
`max_depth` and explicit `properties` remain available and can be combined with
the budget.

In a synthetic 12,001-node flat scene on Godot 4.7/Windows, default output fell
from 865,897 bytes to approximately 35 KB, with explicit truncation. Median tool
time over six runs fell from 178 ms to 147 ms. This compares a full response with
a bounded response, not equal amounts of returned information. Payload bytes are
not an exact model-token measurement; actual savings depend on the scene and
tokenizer. Loading the scene still has a cost even when the returned tree is small.

### Compact output with the same fields

Add `"format":"compact"` to `read_scene` to avoid repeating field names and
nested `children` wrappers. The default remains `"tree"`.

```json
{"scene_path":"res://level.tscn","format":"compact","max_nodes":100,"properties":["position","visible"]}
```

The response replaces `root` with `root_name`, `columns` and `rows`. Each row is
aligned with `columns`, beginning with `path` and `type`. Optional columns
(`script`, `instance`, `properties`, `missing_properties`, `children_truncated`)
appear when any returned node has that field; absent values in other rows are
`null`. Rows retain depth-first child order. Paths encode the hierarchy and node
names; `root_name` supplies the selected branch's name. The node budget, depth
limit and continuation fields have the same meaning as in tree format.

On the same synthetic scene, returning the **same 500 nodes and fields** produced
35,033 bytes as a tree and 14,210 bytes compact (59.4% fewer JSON bytes). The
comparison checks every selected field and the continuation offset. This measures
payload bytes, not tokenizer-specific tokens or total tool latency. Compact output
also reads unsaved editor state without changing disk or the undo history.

## Verification

```powershell
cd mcp-server
npm run build
npm test
# Real editor regressions, isolated from the normal bridge port:
$env:GODOT_BIN = 'C:/path/to/Godot.exe'
npx vitest run src/tests/e2e-godot.test.ts -t 'live scene'
```

From the repository root, `scripts/test-gd.ps1 -Godot C:/path/to/Godot.exe` runs
parse, input, rendering and on-disk handler checks. Set `GODOT_MCP_SKIP_RENDER=1`
only when a real display is unavailable. The Windows runner waits for the actual
GUI executable and propagates its exit code rather than relying on a detached
process's stale `$LASTEXITCODE`.

Editor integration tests use an OS-assigned port, a per-run secret and project
binding. A configured secret/project handshake must complete before that socket
can receive tool invocations. WebSocket send/serialization failures release
pending requests immediately instead of waiting for the tool timeout.
