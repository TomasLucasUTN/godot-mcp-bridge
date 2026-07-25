# Contributing

Contributions are welcome — bug reports, tool ideas, and pull requests alike.

## How this works

This isn't a team project with write access for contributors. To propose a
change:

1. Fork the repo.
2. Make your change on a branch.
3. Open a pull request against `main`.

A maintainer reviews and merges it (or asks for changes) — nobody pushes
directly to `main` except the maintainer. Small, focused PRs are much easier
to review than large ones touching many unrelated things.

Found a bug but don't want to fix it yourself? Open an [issue](https://github.com/TomasLucasUTN/godot-mcp-bridge/issues) instead — that's just as useful.

Security issue? See [`SECURITY.md`](./SECURITY.md) instead of a public issue or PR.

## Setting up

```bash
cd mcp-server
npm install
npm run build
npm test
```

See [`TESTING.md`](./TESTING.md) for the full test suite breakdown, and
[`CLAUDE.md`](./CLAUDE.md) for the architecture and the dev/reload loop
against a real Godot project.

## Adding or changing a tool

A tool needs to be wired in three places — see the "Adding or changing a
tool" section of [`CLAUDE.md`](./CLAUDE.md) for exactly where. The two rules
that keep this codebase from drifting back into copy-paste, also documented
there:

- Scene-mutating tools extend `SceneToolBase` for the shared helpers instead
  of reimplementing scene load/save.
- Mutating tools edit the **live editor tree** when the target scene is
  already open, instead of overwriting the `.tscn` file out from under the
  user.

## Pull requests

- Keep the diff scoped to what the PR is about — avoid drive-by reformatting
  or unrelated refactors in the same PR.
- Add or update a test when you change a tool's on-disk logic (see
  `scripts/test-gd.ps1` / `mcp-server/src/tests/`).
- Commit messages: short, imperative, explain *why* over *what*.
