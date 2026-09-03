# Rajo, step 3: run the app locally.
#
# Starts the Vite dev server over the committed artifacts. There is no backend to start: what you see
# locally is what the deployed site serves, plus the browser-side lanes against the open data sources.
#
# ASCII-ONLY STRING LITERALS: PowerShell 5.1 reads a .ps1 as CP-1252 without a UTF-8 BOM.
#
#   .\scripts\local\03_dev.ps1
#   .\scripts\local\03_dev.ps1 -Port 5180
#   .\scripts\local\03_dev.ps1 -Preview      # build, then serve the built site

[CmdletBinding()]
param(
    [int]$Port = 5173,
    [switch]$Preview
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

if (-not (Test-Path "frontend/node_modules")) {
    Write-Error "frontend packages are not installed. Run:  .\scripts\local\01_init.ps1"
}

# copy-data.mjs COPIES data/derived into the gitignored frontend/public/data overlay. It never runs
# science and never writes back, which is what keeps a web build from changing the evidence.
Push-Location frontend
try {
    node copy-data.mjs
    if ($LASTEXITCODE -ne 0) { Write-Error "copy-data failed" }

    if ($Preview) {
        Write-Host ""
        Write-Host "Building, then serving the built site." -ForegroundColor Cyan
        npm run build
        if ($LASTEXITCODE -ne 0) { Write-Error "the build failed" }
        Write-Host ""
        Write-Host ("  http://localhost:{0}" -f $Port) -ForegroundColor Green
        Write-Host ""
        npx vite preview --port $Port --strictPort
    }
    else {
        Write-Host ""
        Write-Host ("  http://localhost:{0}" -f $Port) -ForegroundColor Green
        Write-Host "  Ctrl+C to stop." -ForegroundColor DarkGray
        Write-Host ""
        npx vite --port $Port --strictPort
    }
}
finally { Pop-Location }
