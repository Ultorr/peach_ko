#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Package
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This build recipe requires Windows x64 and PowerShell 7.'
}

$PeachRoot = Split-Path -Parent $PSScriptRoot
$PeachFrontend = Join-Path $PeachRoot 'frontend'
$PeachBuild = Join-Path $PeachRoot 'build/korean'
$PeachDist = Join-Path $PeachRoot 'dist'
$PeachOutput = Join-Path $PeachDist 'Peach'
$PeachPython = Join-Path $PeachRoot '.venv/Scripts/python.exe'
$PeachPreviousEnvironment = $env:UV_PROJECT_ENVIRONMENT

foreach ($PeachCommand in @('uv', 'node', 'npm')) {
    Get-Command $PeachCommand -ErrorAction Stop | Out-Null
}
$PeachNodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or [version]$PeachNodeVersion.TrimStart('v') -lt [version]'24.0') {
    throw 'Node.js 24 or newer is required.'
}
if (Test-Path -LiteralPath (Join-Path $PeachRoot 'resources/seed')) {
    throw 'Private seed exports must not be included in application resources.'
}

Push-Location -LiteralPath $PeachRoot
try {
    $env:UV_PROJECT_ENVIRONMENT = Join-Path $PeachRoot '.venv'
    & uv sync --locked --all-extras --python 3.14
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency setup failed; use uv >=0.12.13.' }

    & npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Root npm dependency setup failed.' }
    & npm run check:vendor
    if ($LASTEXITCODE -ne 0) { throw 'Vendored assets differ; run npm run vendor:web and review the changes.' }
    & npm --prefix $PeachFrontend ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend npm dependency setup failed.' }
    & npm --prefix $PeachFrontend run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Frontend type checking failed.' }
    & npm --prefix $PeachFrontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

    foreach ($PeachAsset in @('peach-app.js', 'peach-app.css', 'peach-pages.js', 'peach-pages.css')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PeachRoot "web/dist/$PeachAsset") -PathType Leaf)) {
            throw "Missing frontend output: $PeachAsset"
        }
    }
    if (-not $Package) {
        Write-Output 'Source environment and web assets are ready. See docs/BUILD_KO.md.'
        return
    }

    & $PeachPython -m PyInstaller --version
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller is unavailable in the project environment.' }
    $PeachVersionMatch = Select-String -LiteralPath (Join-Path $PeachRoot 'src/peach/__init__.py') `
        -Pattern '__version__\s*=\s*"([^"]+)"'
    if (-not $PeachVersionMatch) { throw 'Application version is missing.' }
    $PeachCommit = $null
    $PeachDirty = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $PeachHead = & git -C $PeachRoot rev-parse HEAD 2>$null
        if ($LASTEXITCODE -eq 0) {
            $PeachCommit = "$PeachHead".Trim()
            $PeachStatus = & git -C $PeachRoot status --porcelain
            if ($LASTEXITCODE -ne 0) { throw 'Git working tree status could not be read.' }
            $PeachDirty = [bool]$PeachStatus
        }
    }
    New-Item -ItemType Directory -Path $PeachBuild -Force | Out-Null
    $PeachBuildInfo = Join-Path $PeachBuild 'build-info.json'
    [ordered]@{
        commit = $PeachCommit
        source_commit = $PeachCommit
        source_dirty = $PeachDirty
        version = $PeachVersionMatch.Matches[0].Groups[1].Value
        built_at = (Get-Date).ToString('o')
        locale = 'ko-KR'
        local_patch = 'ko-KR-1'
    } | ConvertTo-Json | Set-Content -LiteralPath $PeachBuildInfo -Encoding utf8
    $PeachSentry = Join-Path $PeachBuild 'sentry.json'
    @{ dsn = ''; library_dsn = '' } | ConvertTo-Json |
        Set-Content -LiteralPath $PeachSentry -Encoding utf8

    # scripts/build_windows.ps1 的独立目录参数；外部媒体工具由使用者另行提供。
    & $PeachPython -m PyInstaller --noconfirm --clean --onedir --windowed --name Peach `
        --distpath $PeachDist --workpath (Join-Path $PeachBuild 'app') --specpath $PeachBuild `
        --paths (Join-Path $PeachRoot 'src') --python-option 'X utf8' `
        --collect-all curl_cffi --collect-all resvg_py --copy-metadata sentry-sdk `
        --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto `
        --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.protocols.websockets.auto `
        --hidden-import uvicorn.lifespan.on --icon (Join-Path $PeachRoot 'resources/peach.ico') `
        --add-data "$(Join-Path $PeachRoot 'scripts/standalone.txt');." `
        --add-data "$(Join-Path $PeachRoot 'web');web" `
        --add-data "$(Join-Path $PeachRoot 'migrations');migrations" `
        --add-data "$(Join-Path $PeachRoot 'resources');resources" `
        --add-data "${PeachBuildInfo};." --add-data "${PeachSentry};." `
        (Join-Path $PeachRoot 'scripts/build_app_entry.py')
    if ($LASTEXITCODE -ne 0) { throw 'Windows application build failed.' }
    Copy-Item -LiteralPath (Join-Path $PeachRoot 'LICENSE') -Destination (Join-Path $PeachOutput 'LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $PeachRoot 'docs/BUILD_KO.md') -Destination $PeachOutput
    Write-Output "Application directory: $PeachOutput"
    Write-Output 'FFmpeg, ffprobe, untrunc and cloudflared are external tools and are not bundled.'
}
finally {
    $env:UV_PROJECT_ENVIRONMENT = $PeachPreviousEnvironment
    Pop-Location
}
