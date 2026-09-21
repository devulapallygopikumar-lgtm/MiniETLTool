# Portable, no-admin Postgres 16 for local dev of this project only.
# Runs as the current user, listens on 5555 (not 5432 — leaves the
# machine's other Postgres installs untouched), data lives in .pgsql16\data.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pg = Join-Path $root ".pgsql16\pgsql"
$data = Join-Path $root ".pgsql16\data"
$bin = Join-Path $pg "bin"

if (-not (Test-Path $data)) {
    & "$bin\initdb.exe" -D $data -U postgres -A trust --locale=C --encoding=UTF8 | Out-Null
    Add-Content -Path (Join-Path $data "postgresql.conf") -Value "port = 5555"
}

$status = & "$bin\pg_ctl.exe" -D $data status
if ($LASTEXITCODE -ne 0) {
    & "$bin\pg_ctl.exe" -D $data -l (Join-Path $root ".pgsql16\server.log") start
}

& "$bin\createdb.exe" -U postgres -h localhost -p 5555 mini_etl 2>$null


Write-Host "Postgres 16 running on localhost:5555, database 'mini_etl' ready."
