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
# tar from Git Bash; the stream lands in the release dir. Paths are handed to bash in MSYS form
# (/d/...): GNU tar reads "D:/..." as a remote host spec and ssh could not open the key given that way
# (measured on the first deploy, 2026-09-03). pipefail makes a tar failure fail the pipeline.
function ToBashPath([string]$p) {
    $u = $p -replace "\\", "/"
    if ($u -match "^([A-Za-z]):/(.*)$") { return ("/" + $Matches[1].ToLower() + "/" + $Matches[2]) }
    return $u
}
$tarCmd = "set -o pipefail; tar -C '{0}' -cf - . | ssh -i '{1}' -o StrictHostKeyChecking=accept-new {2} 'tar -C {3} --no-same-owner -xf -'" -f (ToBashPath $dist), (ToBashPath $Key), $Target, $release
# Git's own bash, never a bare "bash": on this machine PATH resolves bash to the WSL launcher
# (C:\Windows\System32\bash.exe), where neither D:/ nor /d/ exists (second failed ship, 2026-09-03)
$gitBash = Join-Path (Split-Path (Split-Path (Get-Command git).Source)) "bin\bash.exe"
if (-not (Test-Path $gitBash)) { throw "Git Bash not found next to git.exe ($gitBash)" }
& $gitBash "-lc" $tarCmd
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
# every client-side route answers the app shell when loaded directly; /data shares its name with the
# artifact prefix and once answered 404 (found by the live smoke on the first deploy)
foreach ($route in @("/data", "/data/", "/methods", "/atlas", "/about")) {
    $r = Invoke-WebRequest -Uri "https://$Domain$route" -UseBasicParsing -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if (-not $r -or $r.StatusCode -ne 200) { throw ("route {0} answered {1} instead of 200" -f $route, $(if ($r) { $r.StatusCode } else { "no response or a redirect" })) }
    if ("$($r.Headers['Content-Type'])" -notmatch "text/html") { throw ("route {0} served as '{1}', not text/html" -f $route, $r.Headers['Content-Type']) }
    if ($r.Content -notmatch "<title>") { throw ("route {0} did not serve the app shell" -f $route) }
}
# the server must name the types: a server-level `types` block without the mime include served the
# app shell and the hashed modules as application/octet-stream (found before the first deploy)
$indexType = (Invoke-WebRequest -Uri "https://$Domain/index.html?v=$stamp" -UseBasicParsing -Method Head).Headers["Content-Type"]
if ("$indexType" -notmatch "text/html") { throw ("index.html served as '{0}', not text/html" -f $indexType) }
$asset = [regex]::Match($liveIndex, 'src="(/assets/[^"]+\.js)"').Groups[1].Value
if (-not $asset) { throw "index.html names no /assets/*.js module" }
$assetType = (Invoke-WebRequest -Uri "https://$Domain$asset" -UseBasicParsing -Method Head).Headers["Content-Type"]
if ("$assetType" -notmatch "javascript") { throw ("{0} served as '{1}', not javascript" -f $asset, $assetType) }
$forestType = (Invoke-WebRequest -Uri "https://$Domain/models/rf/rf-v1.forest.bin" -UseBasicParsing -Method Head).Headers["Content-Type"]
if ("$forestType" -match "text/html") { throw "the forest file answers as the app shell (not shipped or no 404 rule)" }
# a missing artifact must answer 404, never the app shell (the tile decoders rely on it)
try {
    $missing = Invoke-WebRequest -Uri "https://$Domain/data/sites/chuquicamata/terrain/13/0/0.png" -UseBasicParsing -Method Head
    throw ("a missing tile answered {0} instead of 404" -f $missing.StatusCode)
} catch [System.Net.WebException] {
    $code = [int]$_.Exception.Response.StatusCode
    if ($code -ne 404) { throw ("a missing tile answered {0} instead of 404" -f $code) }
}
Step ("live: title '{0}', catalog identical, deep link 200 -> https://{1} (v{2})" -f $liveTitle, $Domain, $Version)
