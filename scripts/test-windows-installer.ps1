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

function Invoke-OverseerSmoke([string]$Phase) {
    $binary = Join-Path $installRoot 'Overseer.exe'
    if (-not (Test-Path $binary)) { throw 'Installer did not produce Overseer.exe.' }
    $env:OVERSEER_DESKTOP_BINARY = $binary
    $env:OVERSEER_DESKTOP_SMOKE_REPORT_DIR = Join-Path $resultRoot $Phase
    $env:OVERSEER_DESKTOP_SMOKE_USER_DATA = $profileRoot
    node scripts/smoke-electron.mjs
    if ($LASTEXITCODE -ne 0) { throw "Installed application failed during $Phase." }
}

function Invoke-OverseerUninstall {
    $uninstaller = Join-Path $installRoot 'Uninstall Overseer.exe'
    if (-not (Test-Path $uninstaller)) { return }
    Invoke-Installer $uninstaller '/S'
    $deadline = (Get-Date).AddSeconds(30)
    while ((Test-Path (Join-Path $installRoot 'Overseer.exe')) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (Test-Path (Join-Path $installRoot 'Overseer.exe')) { throw 'Uninstall left the application executable behind.' }
}

function Invoke-PortableWrapperSmoke([string]$Executable) {
    $portableReportDir = Join-Path $resultRoot 'portable'
    New-Item -ItemType Directory -Path $portableReportDir -Force | Out-Null
    $process = Start-Process -FilePath $Executable -PassThru
    Start-Sleep -Seconds 15
    $related = @(Get-Process | Where-Object { $_.Id -eq $process.Id -or $_.ProcessName -like 'Overseer*' })
    try {
        if ($process.HasExited -and $process.ExitCode -ne 0) { throw "Portable executable exited with code $($process.ExitCode)." }
        if ($related.Count -lt 1) { throw 'Portable executable did not leave a verifiable running process.' }
        $report = @{
            testedAt = (Get-Date).ToUniversalTime().ToString('o')
            portable = $Executable
            passed = $true
            scope = 'Portable wrapper process launch and cleanup. Installed-app smoke verifies renderer, map, source details, and local server behavior.'
            processes = @($related | ForEach-Object { @{ id = $_.Id; name = $_.ProcessName; hasExited = $_.HasExited } })
        } | ConvertTo-Json -Depth 5
        Set-Content -Path (Join-Path $portableReportDir 'smoke.json') -Value $report
    } finally {
        foreach ($candidate in $related) {
            if ($candidate.HasExited) { continue }
            & taskkill /pid $candidate.Id /T /F | Out-Null
        }
    }
}

try {
    # /D must be last and unquoted for NSIS, including when the path has spaces.
    # This directory is isolated under the runner's temporary directory.
    Invoke-Installer $installers[0].FullName "/S /D=$installRoot"
    Invoke-OverseerSmoke 'install'

    $markerDir = Join-Path $profileRoot 'data'
    New-Item -ItemType Directory -Path $markerDir -Force | Out-Null
    $marker = Join-Path $markerDir 'settings-preservation-marker.txt'
    Set-Content -Path $marker -Value 'created by Windows installer lifecycle smoke test'
    $markerCreated = $true

    Invoke-OverseerUninstall
    if (-not (Test-Path $marker)) { throw 'Uninstall removed the isolated per-user data directory unexpectedly.' }

    Invoke-Installer $installers[0].FullName "/S /D=$installRoot"
    Invoke-OverseerSmoke 'reinstall'
    if (-not (Test-Path $marker)) { throw 'Reinstall did not preserve the isolated per-user data directory.' }

    Invoke-OverseerUninstall
    if (-not (Test-Path $marker)) { throw 'Uninstall removed the isolated per-user data directory unexpectedly.' }

    $portable = @(Get-ChildItem (Join-Path $repo 'release/Overseer-Portable-*-x64.exe'))
    if ($portable.Count -ne 1) { throw 'Expected exactly one portable executable.' }
    Invoke-PortableWrapperSmoke $portable[0].FullName
} finally {
    Invoke-OverseerUninstall
    $marker = Join-Path (Join-Path $profileRoot 'data') 'settings-preservation-marker.txt'
    if ($markerCreated -and -not (Test-Path $marker)) { throw 'Uninstall removed the isolated per-user data directory unexpectedly.' }
}
