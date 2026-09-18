$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$installRoot = Join-Path $tempRoot "Overseer Installer Test $([guid]::NewGuid())"
$profileRoot = Join-Path $tempRoot "Overseer User Data $([guid]::NewGuid())"
$resultRoot = Join-Path $repo 'desktop-smoke-results'
$installers = @(Get-ChildItem (Join-Path $repo 'release/Overseer-Setup-*-x64.exe'))
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 setup executable.' }
New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null
New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
$markerCreated = $false

function Invoke-Installer([string]$Executable, [string]$Arguments) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(180000)) {
        Stop-Process -Id $process.Id -Force
        throw "Installer timed out: $Executable"
    }
    if ($process.ExitCode -ne 0) { throw "Installer exit code: $($process.ExitCode)" }
}

try {
    # /D must be last and unquoted for NSIS, including when the path has spaces.
    # This directory is isolated under the runner's temporary directory.
    foreach ($phase in @('install', 'reinstall')) {
        Invoke-Installer $installers[0].FullName "/S /D=$installRoot"
        $binary = Join-Path $installRoot 'Overseer.exe'
        if (-not (Test-Path $binary)) { throw 'Installer did not produce Overseer.exe.' }
        $env:OVERSEER_DESKTOP_BINARY = $binary
        $env:OVERSEER_DESKTOP_SMOKE_REPORT_DIR = Join-Path $resultRoot $phase
        $env:OVERSEER_DESKTOP_SMOKE_USER_DATA = $profileRoot
        node scripts/smoke-electron.mjs
        if ($LASTEXITCODE -ne 0) { throw "Installed application failed during $phase." }
        $markerDir = Join-Path $profileRoot 'data'
        New-Item -ItemType Directory -Path $markerDir -Force | Out-Null
        $marker = Join-Path $markerDir 'settings-preservation-marker.txt'
        if ($phase -eq 'install') {
            Set-Content -Path $marker -Value 'created by Windows installer lifecycle smoke test'
            $markerCreated = $true
        } elseif (-not (Test-Path $marker)) {
            throw 'Reinstall did not preserve the isolated per-user data directory.'
        }
    }
    $portable = @(Get-ChildItem (Join-Path $repo 'release/Overseer-Portable-*-x64.exe'))
    if ($portable.Count -ne 1) { throw 'Expected exactly one portable executable.' }
    $env:OVERSEER_DESKTOP_BINARY = $portable[0].FullName
    $env:OVERSEER_DESKTOP_SMOKE_REPORT_DIR = Join-Path $resultRoot 'portable'
    $env:OVERSEER_DESKTOP_SMOKE_USER_DATA = Join-Path $tempRoot "Overseer Portable User Data $([guid]::NewGuid())"
    node scripts/smoke-electron.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Portable application failed.' }
} finally {
    $uninstaller = Join-Path $installRoot 'Uninstall Overseer.exe'
    if (Test-Path $uninstaller) {
        Invoke-Installer $uninstaller '/S'
        $deadline = (Get-Date).AddSeconds(30)
        while ((Test-Path (Join-Path $installRoot 'Overseer.exe')) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 250
        }
        if (Test-Path (Join-Path $installRoot 'Overseer.exe')) { throw 'Uninstall left the application executable behind.' }
    }
    $marker = Join-Path (Join-Path $profileRoot 'data') 'settings-preservation-marker.txt'
    if ($markerCreated -and -not (Test-Path $marker)) { throw 'Uninstall removed the isolated per-user data directory unexpectedly.' }
}
