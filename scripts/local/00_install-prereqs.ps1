# Rajo, step 0: system-level prerequisites.
#
# Checks what a bare Windows machine needs and, ONLY with -Install, installs it via winget. Idempotent.
#
# ASCII-ONLY STRING LITERALS. PowerShell 5.1 reads a .ps1 as CP-1252 unless the file carries a UTF-8 BOM,
# so a non-ASCII dash or arrow inside a string can silently terminate it.
#
#   .\scripts\local\00_install-prereqs.ps1
#   .\scripts\local\00_install-prereqs.ps1 -Install

[CmdletBinding()]
param(
    # CHECKING IS THE DEFAULT AND INSTALLING IS OPT-IN. A setup script that silently replaces working
    # system software is a hazard, not a convenience.
    [switch]$Install
)

$ErrorActionPreference = "Stop"

# CI pins these, so local should match rather than drift ahead of what is actually tested.
$PythonMin = [version]"3.12"
$NodeMin = [version]"22.0"

function Test-Cmd($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# NOT named $args: that is a PowerShell automatic variable and a parameter of that name never binds.
function Get-Ver($exe, $verArg) {
    try {
        $raw = & $exe $verArg 2>&1 | Out-String
        $m = [regex]::Match($raw, "(\d+)\.(\d+)(\.(\d+))?")
        if ($m.Success) { return [version]("{0}.{1}" -f $m.Groups[1].Value, $m.Groups[2].Value) }
    } catch { }
    return $null
}

$missing = $false

if ($Install -and -not (Test-Cmd "winget")) {
    Write-Error "winget is not available. Install App Installer from the Microsoft Store, then re-run."
}

Write-Host ""
Write-Host "Rajo prerequisites" -ForegroundColor Cyan
Write-Host ""

# --- Python: the Windows launcher first, a bare python can be the Store alias stub -----------------
$pyVer = $null
if (Test-Cmd "py") { $pyVer = Get-Ver "py" "-3.12 --version" }
if (-not $pyVer -and (Test-Cmd "py")) { $pyVer = Get-Ver "py" "--version" }
if (-not $pyVer -and (Test-Cmd "python")) { $pyVer = Get-Ver "python" "--version" }
if ($pyVer -and $pyVer -ge $PythonMin) {
    Write-Host ("  Python {0}, at or above the {1} CI pin" -f $pyVer, $PythonMin) -ForegroundColor Green
}
else {
    if ($pyVer) { Write-Host ("  Python {0} is below the {1} CI pin" -f $pyVer, $PythonMin) -ForegroundColor Yellow }
    else { Write-Host "  Python not found" -ForegroundColor Yellow }
    if (-not $Install) {
        Write-Host "        install it, or re-run this script with -Install to let winget do it" -ForegroundColor DarkGray
        $script:missing = $true
    }
    else {
        winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
        Write-Host "  Python installed. OPEN A NEW TERMINAL and re-run so PATH refreshes." -ForegroundColor Yellow
        exit 0
    }
}

# --- Node -----------------------------------------------------------------------------------------
$nodeVer = $null
if (Test-Cmd "node") { $nodeVer = Get-Ver "node" "--version" }
if ($nodeVer -and $nodeVer -ge $NodeMin) {
    Write-Host ("  Node {0}, at or above the {1} CI pin" -f $nodeVer, $NodeMin) -ForegroundColor Green
}
else {
    if ($nodeVer) { Write-Host ("  Node {0} is below the {1} CI pin" -f $nodeVer, $NodeMin) -ForegroundColor Yellow }
    else { Write-Host "  Node not found" -ForegroundColor Yellow }
    if (-not $Install) {
        Write-Host "        install it, or re-run this script with -Install to let winget do it" -ForegroundColor DarkGray
        $script:missing = $true
    }
    else {
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
        Write-Host "  Node installed. OPEN A NEW TERMINAL and re-run so PATH refreshes." -ForegroundColor Yellow
        exit 0
    }
}

# --- git ------------------------------------------------------------------------------------------
if (Test-Cmd "git") {
    Write-Host "  git present" -ForegroundColor Green
}
else {
    Write-Host "  git not found" -ForegroundColor Yellow
    if (-not $Install) {
        Write-Host "        install it, or re-run this script with -Install to let winget do it" -ForegroundColor DarkGray
        $script:missing = $true
    }
    else {
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    }
}

# --- optional: a CUDA GPU for the training lane ---------------------------------------------------
if (Test-Cmd "nvidia-smi") {
    Write-Host "  nvidia-smi present: the GPU training lane is available (01_init -Gpu)" -ForegroundColor Green
}
else {
    Write-Host "  no nvidia-smi: the U-Net trains on CPU (slow) or reuse the committed ONNX" -ForegroundColor DarkGray
}

Write-Host ""
if ($missing) {
    Write-Host "  Something is missing. Nothing was installed." -ForegroundColor Yellow
    Write-Host "  Re-run with -Install to let winget install it:" -ForegroundColor Yellow
    Write-Host "    .\scripts\local\00_install-prereqs.ps1 -Install"
    Write-Host ""
    exit 1
}
Write-Host "  All prerequisites present. Nothing installed." -ForegroundColor Green
Write-Host "  Next:  .\scripts\local\01_init.ps1"
Write-Host ""
