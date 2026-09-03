# Rajo, step 1: one-stop setup from a fresh clone.
#
# Idempotent. Everything it does is "already done?" first, so re-running costs seconds. -Force rebuilds
# the virtual environment and node_modules. -Gpu also installs the CUDA torch build for the training lane.
#
# ASCII-ONLY STRING LITERALS: PowerShell 5.1 reads a .ps1 as CP-1252 without a UTF-8 BOM.
#
#   .\scripts\local\01_init.ps1
#   .\scripts\local\01_init.ps1 -Force
#   .\scripts\local\01_init.ps1 -Gpu

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Gpu
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$PythonMin = [version]"3.12"
$NodeMin = [version]"22.0"

# Windows PowerShell 5.1 turns every stderr line of a native program into an ErrorRecord, and with
# $ErrorActionPreference = "Stop" a harmless pip warning aborts the script. Native calls therefore run
# with the preference relaxed and are judged on their EXIT CODE only.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @(), [string]$What = "")
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) {
        $label = if ($What) { $What } else { "$Exe $($Arguments -join ' ')" }
        throw "$label failed with exit code $code"
    }
}

function Get-VenvPy($dir) {
    $p = Join-Path $dir "Scripts\python.exe"
    if (Test-Path $p) { return $p }
    $p = Join-Path $dir "bin/python"
    if (Test-Path $p) { return $p }
    return $null
}

function Get-Ver($exe, $verArg) {
    try {
        $raw = & $exe $verArg 2>&1 | Out-String
        $m = [regex]::Match($raw, "(\d+)\.(\d+)")
        if ($m.Success) { return [version]("{0}.{1}" -f $m.Groups[1].Value, $m.Groups[2].Value) }
    } catch { }
    return $null
}

Write-Host ""
Write-Host "Rajo init" -ForegroundColor Cyan
Write-Host ""

# --- 1. prerequisites (the launcher picks 3.12 explicitly so a 3.13 default does not win) -----------
$pyExe = "python"; $pyArgs = @()
if (Get-Command "py" -ErrorAction SilentlyContinue) { $pyExe = "py"; $pyArgs = @("-3.12") }
$pyVer = $null
try { $pyVer = Get-Ver $pyExe (($pyArgs + @("--version")) -join " ") } catch { }
if (-not $pyVer) { $pyExe = "python"; $pyArgs = @(); $pyVer = Get-Ver "python" "--version" }
if (-not $pyVer -or $pyVer -lt $PythonMin) {
    Write-Error "Python $PythonMin or newer is required. Run:  .\scripts\local\00_install-prereqs.ps1"
}
$nodeVer = Get-Ver "node" "--version"
if (-not $nodeVer -or $nodeVer -lt $NodeMin) {
    Write-Error "Node $NodeMin or newer is required. Run:  .\scripts\local\00_install-prereqs.ps1"
}
Write-Host ("  [1/3] Python {0}, Node {1}" -f $pyVer, $nodeVer) -ForegroundColor Green

# --- 2. the offline bake venv --------------------------------------------------------------------
if ($Force -and (Test-Path ".venv")) { Remove-Item -Recurse -Force ".venv" }
if (-not (Test-Path ".venv")) { Invoke-Native $pyExe ($pyArgs + @("-m","venv",".venv")) -What "creating .venv" }
$vp = Get-VenvPy ".venv"
Invoke-Native $vp @("-m","pip","install","--upgrade","pip","-q") -What "upgrading pip"
Invoke-Native $vp @("-m","pip","install","-q","-r","requirements-precompute.txt","-r","requirements-dev.txt") -What "installing the bake lane"
if ($Gpu) {
    Invoke-Native $vp @("-m","pip","install","-q","-r","requirements-gpu.txt","--index-url","https://download.pytorch.org/whl/cu124") -What "installing the GPU lane"
    $cuda = (& $vp -c "import torch; print(torch.cuda.is_available())").Trim()
    Write-Host ("  [2/3] .venv ready, torch CUDA available: {0}" -f $cuda) -ForegroundColor Green
}
else {
    Write-Host "  [2/3] .venv ready (bake lane; add -Gpu for the training lane)" -ForegroundColor Green
}

# --- 3. the frontend ------------------------------------------------------------------------------
Push-Location frontend
try {
    if ($Force -and (Test-Path "node_modules")) { Remove-Item -Recurse -Force "node_modules" }
    if (-not (Test-Path "node_modules")) {
        if (Test-Path "package-lock.json") { Invoke-Native "npm" @("ci") -What "npm ci" }
        else { Invoke-Native "npm" @("install") -What "npm install" }
    }
} finally { Pop-Location }
Write-Host "  [3/3] frontend packages installed" -ForegroundColor Green

# THERE IS NO .env AND NOTHING TO PROVISION: no backend, no database, no secret.
Write-Host ""
Write-Host "  Ready. Next:  .\scripts\local\03_dev.ps1" -ForegroundColor Green
Write-Host "  (the offline bake is .\scripts\local\02_generate-data.ps1; not needed to run the app)" -ForegroundColor DarkGray
Write-Host ""
