# Rajo: build, verify, ship to the VPS as a static site (vps-static), then check the LIVE content.
# .ps1 parity of deploy.sh (Felipe runs PowerShell). The SSH key stays out of this repo.
#
#   $env:RAJO_SSH_KEY = "<vault>\credentials\general\ssh\hetzner_fasl_prod"
#   .\deploy\deploy.ps1                 # full: guards, tests, build, ship, live check
#   .\deploy\deploy.ps1 -SkipTests      # ship a tree whose gates ran a minute ago
#
# Refuses to ship when: the artifact contract fails, the tests or the guards fail, the build did not
# produce dist\index.html, or, after shipping, the live page title or the live catalog.json disagree
# with the local build. A 200 from an SPA fallback proves only that nginx is up; the content check is
# the gate. First-time host setup (nginx site, certbot) is documented in deploy\README.md.
#
# ASCII-ONLY STRING LITERALS: PowerShell 5.1 reads a .ps1 as CP-1252 without a UTF-8 BOM.

[CmdletBinding()]
param(
    [switch]$SkipTests,
    [string]$Domain = "rajo.fasl-work.com",
    [string]$Target = "root@91.99.199.70"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
if (-not $env:RAJO_SSH_KEY) { throw "set RAJO_SSH_KEY to the vault SSH key path" }
$Key = $env:RAJO_SSH_KEY
$WebRoot = "/var/www/$Domain"
$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "no .venv. Run: .\scripts\local\01_init.ps1" }
$Version = (Get-Content (Join-Path $Root "VERSION") -Raw).Trim()

function Step($msg) { Write-Host ("[deploy {0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) }
function Run($exe, $argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw ("{0} {1} failed with exit {2}" -f $exe, ($argv -join " "), $LASTEXITCODE) }
}

Step "version $Version -> https://$Domain"
Step "artifact contract"
Run $py @("scripts\check_artifacts.py")
Step "repository standards"
Run $py @("scripts\check_repo_standards.py")

Push-Location (Join-Path $Root "frontend")
try {
    if (-not $SkipTests) {
        Step "typecheck + unit tests"
        Run "npm" @("run", "typecheck")
        Run "npm" @("run", "test")
    }
    Step "build (copy-data overlays the committed data\derived)"
    Run "npm" @("run", "build")
} finally { Pop-Location }

$dist = Join-Path $Root "frontend\dist"
if (-not (Test-Path (Join-Path $dist "index.html"))) { throw "build produced no dist\index.html" }
$localCatalog = Get-Content (Join-Path $dist "data\catalog.json") -Raw
$localTitle = [regex]::Match((Get-Content (Join-Path $dist "index.html") -Raw), "<title>([^<]*)</title>").Groups[1].Value
if (-not $localTitle) { throw "dist\index.html has no <title>" }

Step "ship: tar over ssh into a fresh release dir, atomic swap"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$release = "$WebRoot.releases/$stamp"
$sshArgs = @("-i", $Key, "-o", "StrictHostKeyChecking=accept-new", $Target)
& ssh @sshArgs "mkdir -p $release"
if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed" }
# tar from Git Bash's tar (bsdtar on Windows also works); the stream lands in the release dir
$tarCmd = "tar -C `"$dist`" -cf - . | ssh -i `"$Key`" $Target `"tar -C $release -xf -`""
& bash -lc $tarCmd.Replace("\", "/")
if ($LASTEXITCODE -ne 0) { throw "tar over ssh failed" }
& ssh @sshArgs "set -e; test -f $release/index.html; rm -rf $WebRoot.previous; if [ -d $WebRoot ] && [ ! -L $WebRoot ]; then mv $WebRoot $WebRoot.previous; fi; ln -sfn $release $WebRoot.next && mv -Tf $WebRoot.next $WebRoot; nginx -t >/dev/null 2>&1 && systemctl reload nginx; ls -1d $WebRoot.releases/* | head -n -3 | xargs -r rm -rf"
if ($LASTEXITCODE -ne 0) { throw "remote swap failed" }

Step "live content check"
$liveIndex = (Invoke-WebRequest -Uri "https://$Domain/?v=$stamp" -UseBasicParsing -Headers @{ "Cache-Control" = "no-cache" }).Content
$liveTitle = [regex]::Match($liveIndex, "<title>([^<]*)</title>").Groups[1].Value
if ($liveTitle -ne $localTitle) { throw ("live title '{0}' differs from the build '{1}'" -f $liveTitle, $localTitle) }
$liveCatalog = (Invoke-WebRequest -Uri "https://$Domain/data/catalog.json?v=$stamp" -UseBasicParsing).Content
if ($liveCatalog.Trim() -ne $localCatalog.Trim()) { throw "live catalog.json differs from the build" }
$deep = Invoke-WebRequest -Uri "https://$Domain/?site=chuquicamata" -UseBasicParsing
if ($deep.StatusCode -ne 200) { throw ("deep link answered {0}" -f $deep.StatusCode) }
Step ("live: title '{0}', catalog identical, deep link 200 -> https://{1} (v{2})" -f $liveTitle, $Domain, $Version)
