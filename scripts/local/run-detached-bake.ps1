# Rajo: launch the canonical bake DETACHED from the calling shell.
#
# Two launcher defects this avoids, both of which cost full runs in sibling products:
#   1. running the bake as a child of an interactive session: it dies when that session exits.
#      Start-Process detaches it.
#   2. piping python's output through a PowerShell pipeline: when the pipeline stalls, the writer
#      BLOCKS and the run sits alive but idle. -RedirectStandardOutput writes the file directly.
#
# ASCII-ONLY STRING LITERALS: PowerShell 5.1 reads a .ps1 as CP-1252 without a UTF-8 BOM.
#
#   .\scripts\local\run-detached-bake.ps1                       # all stages, all sites, resume, release
#   .\scripts\local\run-detached-bake.ps1 -Stage frames -Sites chuquicamata,escondida -Sandbox
#   .\scripts\local\run-detached-bake.ps1 -DataRoot E:\_Datos\rajo

[CmdletBinding()]
param(
    [string]$Stage = "all",
    [string]$Sites = "",
    [string]$Years = "",
    [string]$DataRoot = "",
    [switch]$Sandbox,
    [string]$LogDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Error "no .venv. Run: .\scripts\local\01_init.ps1" }

if ($DataRoot) { $env:RAJO_DATA_ROOT = $DataRoot }
if (-not $LogDir) {
    $base = if ($env:RAJO_DATA_ROOT) { $env:RAJO_DATA_ROOT } else { Join-Path $Root "data\cache" }
    $LogDir = Join-Path $base "logs"
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $LogDir ("bake-{0}-{1}.log" -f $Stage, $stamp)
$err = Join-Path $LogDir ("bake-{0}-{1}.err" -f $Stage, $stamp)

$argsList = @("data-pipeline\run.py", $Stage, "--resume")
if ($Sites) { $argsList += @("--sites", $Sites) }
if ($Years) { $argsList += @("--years", $Years) }
if ($Sandbox) { $argsList += @("--output", "build\local") } else { $argsList += "--release" }

$p = Start-Process -FilePath $py -ArgumentList $argsList -WorkingDirectory $Root `
    -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden -PassThru
Write-Host ("launched pid {0}" -f $p.Id)
Write-Host ("  log: {0}" -f $log)
Write-Host ("  err: {0}" -f $err)
Write-Host "  progress:  Get-Content -Tail 20 <log>"
Write-Host "  blocked vs hung: compare CPU time over a minute with  Get-Process -Id <pid> | Select CPU"
