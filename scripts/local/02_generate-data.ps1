# Rajo, step 2: the offline bake.
#
# Runs the staged pipeline (catalog, scenes, frames, masks, series, dem, export, validate) for the sites
# requested. WRITES TO A SANDBOX (build/local) UNLESS -Release IS PASSED: a bake that overwrote the
# committed artifacts is how a release gets clobbered. -Release refuses a partial tree.
#
# ASCII-ONLY STRING LITERALS: PowerShell 5.1 reads a .ps1 as CP-1252 without a UTF-8 BOM.
#
#   .\scripts\local\02_generate-data.ps1
#   .\scripts\local\02_generate-data.ps1 -Stage frames -Sites chuquicamata,escondida
#   .\scripts\local\02_generate-data.ps1 -Release

[CmdletBinding()]
param(
    [string]$Stage = "all",
    [string]$Sites = "",
    [switch]$Release,
    [switch]$Resume
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$vp = Join-Path ".venv" "Scripts\python.exe"
if (-not (Test-Path $vp)) { $vp = Join-Path ".venv" "bin/python" }
if (-not (Test-Path $vp)) { Write-Error "no .venv. Run:  .\scripts\local\01_init.ps1" }

$argsList = @("data-pipeline/run.py", $Stage)
if ($Sites) { $argsList += @("--sites", $Sites) }
if ($Release) { $argsList += "--release" } else { $argsList += @("--output", "build/local") }
if ($Resume) { $argsList += "--resume" }

$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    & $vp @argsList 2>&1 | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
}
finally { $ErrorActionPreference = $prev }
if ($code -ne 0) { throw "the bake failed with exit code $code" }
