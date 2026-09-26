<#
.SYNOPSIS
    Starts the Mini ETL backend and frontend (see RUNBOOK.md), if they
    aren't already running, and reports their status.

.DESCRIPTION
    Idempotent: safe to re-run. If a service already answers its health
    check, this leaves it alone rather than starting a second copy.
    Does NOT run one-time setup (venv creation, npm install, migrations,
    .env files) -- see RUNBOOK.md's "One-time setup" for that.
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$logDir = Join-Path $env:TEMP "mini-etl-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Url($url) {
    try {
        $resp = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing
        return $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300
    } catch {
        return $false
    }
}

function Wait-ForUrl($url, $seconds, $label) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-Url $url) { return $true }
        Start-Sleep -Seconds 1
    }
    Write-Warning "$label did not respond at $url within $seconds s -- check the log."
    return $false
}

function Get-ListeningPid($port) {
    try {
        return (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty OwningProcess)
    } catch {
        return $null
    }
}

Write-Host "== Postgres ==" -ForegroundColor Cyan
$pg = Get-Service | Where-Object { $_.Name -like "postgresql*" -and $_.Status -eq "Running" }
if ($pg) {
    $pg | ForEach-Object { Write-Host "  running: $($_.Name)" }
} else {
    Write-Warning "No running postgresql* service found. Start Postgres before continuing (see RUNBOOK.md)."
}

Write-Host "== Backend (FastAPI) ==" -ForegroundColor Cyan
if (Test-Url "http://127.0.0.1:8000/health") {
    Write-Host "  already running at http://localhost:8000"
} else {
    $venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        throw "No venv at $venvPython -- run the one-time backend setup in RUNBOOK.md first."
    }
    $out = Join-Path $logDir "backend-out.log"
    $err = Join-Path $logDir "backend-err.log"
    Push-Location $backendDir
    Start-Process -FilePath $venvPython `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "localhost", "--port", "8000" `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden
    Pop-Location
    Write-Host "  starting... (log: $err)"
    if (Wait-ForUrl "http://127.0.0.1:8000/health" 20 "Backend") {
        Write-Host "  up at http://localhost:8000" -ForegroundColor Green
    }
}

Write-Host "== Frontend (Next.js) ==" -ForegroundColor Cyan
$buildId = Join-Path $frontendDir ".next\BUILD_ID"
$frontendPid = Get-ListeningPid 3000
if ($frontendPid -and (Test-Path $buildId)) {
    try {
        $proc = Get-Process -Id $frontendPid -ErrorAction Stop
        if ((Get-Item $buildId).LastWriteTime -gt $proc.StartTime) {
            # `next start` serves whatever build was on disk when it launched --
            # it doesn't notice a later `npm run build` on its own. Kill it so
            # the check below falls through to starting a fresh one.
            Write-Host "  running process (PID $frontendPid) predates the current build -- restarting" -ForegroundColor Yellow
            Stop-Process -Id $frontendPid -Force
            Start-Sleep -Seconds 1
        }
    } catch {
        # process vanished between the port check and here -- fall through
    }
}

if (Test-Url "http://localhost:3000/") {
    Write-Host "  already running at http://localhost:3000"
} else {
    if (-not (Test-Path $buildId)) {
        Write-Host "  no production build found -- running 'npm run build' first (this takes a while)..."
        Push-Location $frontendDir
        & cmd.exe /c "npm run build"
        Pop-Location
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed -- see output above." }
    }
    $out = Join-Path $logDir "frontend-out.log"
    Push-Location $frontendDir
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm start -- -p 3000 > `"$out`" 2>&1" `
        -WindowStyle Hidden
    Pop-Location
    Write-Host "  starting... (log: $out)"
    if (Wait-ForUrl "http://localhost:3000/" 30 "Frontend") {
        Write-Host "  up at http://localhost:3000" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Open http://localhost:3000 in a browser." -ForegroundColor Cyan
