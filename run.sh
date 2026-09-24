#!/usr/bin/env bash
# Starts the Mini ETL backend and frontend (see RUNBOOK.md), if they
# aren't already running, and reports their status.
#
# Idempotent: safe to re-run. If a service already answers its health
# check, this leaves it alone rather than starting a second copy.
# Does NOT run one-time setup (venv creation, npm install, migrations,
# .env files) -- see RUNBOOK.md's "One-time setup" for that.
#
# Works on Linux/macOS, and on Windows under Git Bash / WSL (it looks
# for a venv laid out either the POSIX way, .venv/bin/python, or the
# Windows way, .venv/Scripts/python.exe).

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$root/backend"
frontend_dir="$root/frontend"
log_dir="${TMPDIR:-/tmp}/mini-etl-logs"
mkdir -p "$log_dir"

url_ok() {
  curl -fsS -o /dev/null --max-time 3 "$1" 2>/dev/null
}

wait_for_url() {
  local url="$1" seconds="$2" label="$3"
  for ((i = 0; i < seconds; i++)); do
    if url_ok "$url"; then return 0; fi
    sleep 1
  done
  echo "warning: $label did not respond at $url within ${seconds}s -- check the log." >&2
  return 1
}

echo "== Postgres =="
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready >/dev/null 2>&1 && echo "  pg_isready: accepting connections" \
    || echo "  warning: pg_isready reports Postgres is not accepting connections" >&2
else
  echo "  (pg_isready not on PATH -- skipping; make sure Postgres is running, see RUNBOOK.md)"
fi

echo "== Backend (FastAPI) =="
if url_ok "http://127.0.0.1:8000/health"; then
  echo "  already running at http://localhost:8000"
else
  venv_python="$backend_dir/.venv/bin/python"
  [ -x "$venv_python" ] || venv_python="$backend_dir/.venv/Scripts/python.exe"
  if [ ! -x "$venv_python" ]; then
    echo "error: no venv found under $backend_dir/.venv -- run the one-time backend setup in RUNBOOK.md first." >&2
    exit 1
  fi
  out="$log_dir/backend-out.log"
  (
    cd "$backend_dir"
    nohup "$venv_python" -m uvicorn app.main:app --host localhost --port 8000 >"$out" 2>&1 &
    disown
  )
  echo "  starting... (log: $out)"
  wait_for_url "http://127.0.0.1:8000/health" 20 "Backend" \
    && echo "  up at http://localhost:8000"
fi

echo "== Frontend (Next.js) =="
if url_ok "http://localhost:3000/"; then
  echo "  already running at http://localhost:3000"
else
  if [ ! -f "$frontend_dir/.next/BUILD_ID" ]; then
    echo "  no production build found -- running 'npm run build' first (this takes a while)..."
    (cd "$frontend_dir" && npm run build)
  fi
  out="$log_dir/frontend-out.log"
  (
    cd "$frontend_dir"
    nohup npm start -- -p 3000 >"$out" 2>&1 &
    disown
  )
  echo "  starting... (log: $out)"
  wait_for_url "http://localhost:3000/" 30 "Frontend" \
    && echo "  up at http://localhost:3000"
fi

echo
echo "Open http://localhost:3000 in a browser."
