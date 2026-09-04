# Rajo: harvest the frames baked by parallel workers into data\derived, then export + validate.
#
# ASCII-ONLY STRING LITERALS: PowerShell 5.1 reads a .ps1 as CP-1252 without a UTF-8 BOM.
#
#   .\scripts\local\harvest-frames.ps1                          # every complete site under build\par
#   .\scripts\local\harvest-frames.ps1 -From build\par -Sites antamina,centinela
#   .\scripts\local\harvest-frames.ps1 -DryRun                  # report only

[CmdletBinding()]
param(
    [string]$From = "build\par",
    [string]$Sites = "",
    [switch]$DryRun,
    [switch]$NoStages
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Error "no .venv. Run: .\scripts\local\01_init.ps1" }

$argsList = @("data-pipeline\harvest.py", "--from", $From)
if ($Sites) { $argsList += @("--sites", $Sites) }
if ($DryRun) { $argsList += "--dry-run" }
if ($NoStages) { $argsList += "--no-stages" }

Push-Location $Root
try { & $py @argsList; if ($LASTEXITCODE -ne 0) { Write-Error ("harvest exited with {0}" -f $LASTEXITCODE) } }
finally { Pop-Location }
