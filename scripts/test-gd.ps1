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

# A Windows GUI executable can detach when invoked with &, returning a stale
# LASTEXITCODE. Wait on the actual process and drain both streams concurrently.
function Invoke-GodotCheck {
    param([string[]]$GodotArgs)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Godot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $GodotArgs) { $startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        Write-Output $stdout.GetAwaiter().GetResult()
        $errorText = $stderr.GetAwaiter().GetResult()
        if ($errorText) { [Console]::Error.WriteLine($errorText) }
        if ($process.ExitCode -ne 0) { exit $process.ExitCode }
    } finally {
        $process.Dispose()
    }
}

# Keep the fixture's addon copy current (it's what the tests load).
robocopy "$repo\addons\godot_mcp" "$fixture\addons\godot_mcp" /MIR /NFL /NDL /NJH /NJS /NC /NS /XF *.uid | Out-Null

# Rebuild the class cache so `extends SceneToolBase` (and other class_names) resolve
# under -s, then run the tests. The runner quits 0 on all-pass, 1 on any failure.
Invoke-GodotCheck @('--headless', '--path', $fixture, '--import') | Out-Null
# Every addon script must at least parse. The logic tests only preload the
# handlers they exercise, so a syntax error in an untested file would
# otherwise stay hidden until it blew up in a live editor.
Invoke-GodotCheck @('--headless', '--path', $fixture, '-s', 'res://tests/parse_all.gd')

# Input delivery runs as a SCENE, not with -s: Input only advances its action
# state on real frames, so the SceneTree runner cannot test it.
Invoke-GodotCheck @('--headless', '--path', $fixture, 'res://tests/input_delivery.tscn')

# Scene rendering needs a real display: --headless uses the dummy driver and the
# viewport produces no image at all, so this runs windowed. CI runs the same
# check under xvfb (see .github/workflows/test.yml).
if ($env:GODOT_MCP_SKIP_RENDER) {
    Write-Host "Skipping render test (GODOT_MCP_SKIP_RENDER set)."
} else {
    Invoke-GodotCheck @('--path', $fixture, '-s', 'res://tests/render_preview.gd')
}

Invoke-GodotCheck @('--headless', '--path', $fixture, '-s', 'res://tests/run_tests.gd')
exit 0
