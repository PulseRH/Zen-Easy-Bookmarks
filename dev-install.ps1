# Copies the mod into a Zen profile for development (fx-autoconfig loads
# .uc.js from <profile>/chrome/JS). Find the profile dir via about:profiles.
param([Parameter(Mandatory = $true)][string]$ProfileDir)

$dest = Join-Path $ProfileDir "chrome\JS"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $PSScriptRoot "easy-bookmarks.uc.js") $dest -Force
Copy-Item (Join-Path $PSScriptRoot "style.css") (Join-Path $dest "easy-bookmarks.css") -Force
Write-Host "Installed to $dest. Restart Zen to reload."
