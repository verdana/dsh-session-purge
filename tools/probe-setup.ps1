# Builds a throwaway, fully isolated DSH home for the browser dialog probes
# (tools/dialog-probe.mjs, tools/dialog-probe-double.mjs).
#
# Nothing here touches the user's real ~/.dsh or profile: the probe home lives
# inside this repo, the plugin is linked in with a junction, and the session
# fixture is copied from the existing .playwright-mcp sandbox.
#
# Usage:
#   pwsh -NoProfile -File tools/probe-setup.ps1
#   $env:DSH_HOME = '<repo>\.probe-home'
#   dsh --profile web --no-open --port 3081 --host 127.0.0.1
#   node tools/dialog-probe.mjs "http://127.0.0.1:3081/?token=<printed token>"
$ErrorActionPreference = 'Stop'

$probeHome = 'D:\deepseek-harness\dsh-session-purge\.probe-home'
$srcHome = 'D:\deepseek-harness\.playwright-mcp\devhome'
$repo = 'D:\deepseek-harness\dsh-session-purge'

if (Test-Path $probeHome) { Remove-Item $probeHome -Recurse -Force }

New-Item -ItemType Directory -Path "$probeHome\profiles\web\node_modules" -Force | Out-Null

foreach ($f in @('package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) {
    Copy-Item (Join-Path $srcHome "profiles\web\$f") (Join-Path $probeHome 'profiles\web') -Force
}
Copy-Item "$srcHome\settings.yaml" "$probeHome\settings.yaml" -Force
Copy-Item "$srcHome\sessions" "$probeHome\sessions" -Recurse -Force
Copy-Item "$srcHome\storages" "$probeHome\storages" -Recurse -Force
foreach ($f in @('.anonymous-user-id', '.credentials.yaml')) {
    if (Test-Path "$srcHome\$f") { Copy-Item "$srcHome\$f" "$probeHome\$f" -Force }
}

New-Item -ItemType Junction -Path "$probeHome\profiles\web\node_modules\dsh-nord" -Target 'D:\deepseek-harness\dsh-nord' | Out-Null
New-Item -ItemType Junction -Path "$probeHome\profiles\web\node_modules\dsh-session-purge" -Target $repo | Out-Null

# Register the plugin as a profile layer (the profile.json is rewritten, not merged).
$manifestPath = "$probeHome\profiles\web\package.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifest.dependencies | Add-Member -NotePropertyName 'dsh-session-purge' -NotePropertyValue "link:$repo" -Force
if ($manifest.dsh.profile.bundles -notcontains 'dsh-session-purge') {
    $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles) + 'dsh-session-purge'
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding utf8

Write-Host "probe home ready: $probeHome"
Get-Content $manifestPath -Raw
