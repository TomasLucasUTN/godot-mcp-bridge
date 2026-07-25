# Restart the Godot editor on a test project so @tool addon changes reload.
# If the addon is symlinked/junctioned into the project, repo edits are already
# on disk — this only cycles the editor (GDScript @tool scripts don't hot-reload
# in place).
#
#   pwsh scripts/restart-godot.ps1 -Project "C:\path\to\proj" -Godot "C:\godot.exe"
#
# After it returns, poll get_runtime_status until connected:true (~30-35s to boot).
param(
    [Parameter(Mandatory=$true)][string]$Project,
    [Parameter(Mandatory=$true)][string]$Godot
)

# NOTE: the *_console.exe sibling is a broken 0.2MB stub (CreateProcess error 193) —
# always use the full GUI exe. And the project path MUST be quoted inside the arg
# list, or a space in the path truncates it and Godot aborts "Invalid project path".
Get-Process -Name "Godot*" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$p = Start-Process -FilePath $Godot `
    -ArgumentList @('--editor', '--path', "`"$Project`"") -PassThru
Write-Host "Launched Godot (pid $($p.Id)) on $Project. Poll get_runtime_status until connected."
