## What this does and why

## Checklist

- [ ] New/changed tool is wired in all three places (GDScript handler, `tool_executor.gd` dispatch, TS schema — see `CLAUDE.md`)
- [ ] Scene-mutating code extends `SceneToolBase` / edits the live tree when the scene is open, per `CLAUDE.md`
- [ ] `cd mcp-server && npm test` passes
- [ ] Added or updated a test if this changes a tool's on-disk logic (`mcp-server/src/tests/` or the GDScript fixture tests run via `scripts/test-gd.ps1`)
- [ ] Diff is scoped to this change — no unrelated reformatting
