# Run the headless GDScript logic tests for the tool handlers.
# Syncs the current addon into the e2e fixture, rebuilds its class cache, then
# runs the test runner. Exit code 0 = all passed, non-zero = a failure (CI-gateable).
#
#   pwsh scripts/test-gd.ps1
#   GODOT_BIN="C:\path\to\Godot.exe" pwsh scripts/test-gd.ps1
param(
    [string]$Godot = $env:GODOT_BIN
)
if (-not $Godot) {
    Write-Error "Set GODOT_BIN (or pass -Godot) to your Godot executable path."
    exit 1
}
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path $repo "mcp-server\src\tests\fixtures\e2e-project"

# Keep the fixture's addon copy current (it's what the tests load).
robocopy "$repo\addons\godot_mcp" "$fixture\addons\godot_mcp" /MIR /NFL /NDL /NJH /NJS /NC /NS /XF *.uid | Out-Null

# Rebuild the class cache so `extends SceneToolBase` (and other class_names) resolve
# under -s, then run the tests. The runner quits 0 on all-pass, 1 on any failure.
& $Godot --headless --path $fixture --import | Out-Null
# Every addon script must at least parse. The logic tests only preload the
# handlers they exercise, so a syntax error in an untested file would
# otherwise stay hidden until it blew up in a live editor.
& $Godot --headless --path $fixture -s "res://tests/parse_all.gd"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $Godot --headless --path $fixture -s "res://tests/run_tests.gd"
exit $LASTEXITCODE
