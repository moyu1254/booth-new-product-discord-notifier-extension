param(
  [string]$PackageDir = "dist/packages"
)

$ErrorActionPreference = "Stop"

$rootManifest = Get-Content "manifest.json" | ConvertFrom-Json
$version = $rootManifest.version

powershell -ExecutionPolicy Bypass -File "scripts/build-chromium.ps1"
powershell -ExecutionPolicy Bypass -File "scripts/build-firefox.ps1"

if (Test-Path $PackageDir) {
  Remove-Item -LiteralPath $PackageDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

$chromiumZip = Join-Path $PackageDir "booth-new-product-discord-notifier-extension-chromium-v$version.zip"
$firefoxZip = Join-Path $PackageDir "booth-new-product-discord-notifier-extension-firefox-v$version.zip"

Compress-Archive -Path "dist/chromium/*" -DestinationPath $chromiumZip -Force
Compress-Archive -Path "dist/firefox/*" -DestinationPath $firefoxZip -Force

Write-Host "Release packages written to $PackageDir"
