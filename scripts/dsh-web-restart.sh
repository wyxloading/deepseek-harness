#!/usr/bin/env sh
# Restart the `dsh web` server from this checkout.
#
# `dsh web` is a foreground server. This script owns the process management a
# restart needs: find the listener on the configured port, stop it, start a
# detached replacement from this checkout with timestamped logs, and wait until
# the replacement accepts connections. It never touches anything but that port's
# listener. POSIX only; discovery uses `ss` (Linux) or `lsof` (macOS).
#
# Usage:
#   dsh-web-restart [restart|start|stop|status] [--] [extra dsh web args...]
#
# Environment:
#   DSH_WEB_PORT           listener port to discover and probe (default 3080)
#   DSH_WEB_HOST           host printed and probed (default 127.0.0.1)
#   DSH_WEB_LOG_DIR        directory for restart logs (default /tmp)
#   DSH_WEB_STOP_TIMEOUT   seconds to wait for SIGTERM before SIGKILL (default 10)
#   DSH_WEB_START_TIMEOUT  seconds to wait for the listener (default 30)
#   DSH_WEB_LAUNCHER       launcher to run (default <checkout>/scripts/dsh-dev.sh)

set -eu

SCRIPT=$0
case "$SCRIPT" in
  /*) ;;
  *) SCRIPT=$(CDPATH= cd -- "$(dirname -- "$SCRIPT")" && pwd)/$(basename -- "$SCRIPT") ;;
esac
while [ -L "$SCRIPT" ]; do
  TARGET=$(readlink "$SCRIPT")
  case "$TARGET" in
    /*) SCRIPT=$TARGET ;;
    *) SCRIPT=$(dirname -- "$SCRIPT")/$TARGET ;;
  esac
done
SELF=$(CDPATH= cd -- "$(dirname -- "$SCRIPT")" && pwd)
ROOT=$(CDPATH= cd -- "$SELF/.." && pwd)

PORT=${DSH_WEB_PORT:-3080}
HOST=${DSH_WEB_HOST:-127.0.0.1}
LOG_DIR=${DSH_WEB_LOG_DIR:-/tmp}
STOP_TIMEOUT=${DSH_WEB_STOP_TIMEOUT:-10}
START_TIMEOUT=${DSH_WEB_START_TIMEOUT:-30}
LAUNCHER=${DSH_WEB_LAUNCHER:-$ROOT/scripts/dsh-dev.sh}

say() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }

# Print the pid listening on PORT, or nothing. Nonzero only when no discovery
# tool exists: "not running" is an empty result, not an error.
listener_pid() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1
    return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
    return 0
  fi
  err "dsh-web-restart: need 'ss' (iproute2) or 'lsof' to find the listener on port $PORT"
  return 1
}

# Wait up to STOP_TIMEOUT for the port to stop listening.
wait_gone() {
  i=0
  while [ "$i" -lt "$((STOP_TIMEOUT * 10))" ]; do
    [ -z "$(listener_pid)" ] && return 0
    i=$((i + 1))
    sleep 0.1
  done
  return 1
}

do_stop() {
  pid=$(listener_pid) || return 1
  if [ -z "$pid" ]; then
    say "dsh web: not running on $HOST:$PORT"
    return 0
  fi
  say "dsh web: stopping pid $pid"
  kill "$pid" 2>/dev/null || true
  if wait_gone; then
    say "dsh web: stopped"
    return 0
  fi
  say "dsh web: pid $pid still alive after ${STOP_TIMEOUT}s; sending SIGKILL"
  kill -9 "$pid" 2>/dev/null || true
  if wait_gone; then
    say "dsh web: killed"
    return 0
  fi
  err "dsh-web-restart: port $PORT is still listening after SIGKILL"
  return 1
}

do_start() {
  running=$(listener_pid) || return 1
  if [ -n "$running" ]; then
    say "dsh web: already running on $HOST:$PORT (pid $running)"
    return 0
  fi
  [ -x "$LAUNCHER" ] || { err "dsh-web-restart: launcher is not executable: $LAUNCHER"; return 1; }
  stamp=$(date +%Y-%m-%dT%H-%M-%S)
  out="$LOG_DIR/dsh-web-$stamp.out.log"
  errlog="$LOG_DIR/dsh-web-$stamp.err.log"
  if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    err "dsh-web-restart: warning: DEEPSEEK_API_KEY is not set in this shell; the server starts but model calls fail unless a root .env supplies it"
  fi
  say "dsh web: starting (logs: $out, $errlog)"
  # Launch from the checkout root so tsx module resolution and a root .env
  # behave like `pnpm dsh`; nohup keeps it alive after this shell exits.
  cd "$ROOT"
  nohup "$LAUNCHER" web "$@" >"$out" 2>"$errlog" </dev/null &
  new_pid=$!
  i=0
  while [ "$i" -lt "$((START_TIMEOUT * 10))" ]; do
    listening=$(listener_pid) || return 1
    if [ -n "$listening" ]; then
      say "dsh web: listening on http://$HOST:$PORT (pid $listening)"
      return 0
    fi
    if ! kill -0 "$new_pid" 2>/dev/null; then
      err "dsh-web-restart: server exited before listening"
      tail -n 20 "$out" "$errlog" 2>/dev/null >&2 || true
      return 1
    fi
    i=$((i + 1))
    sleep 0.1
  done
  err "dsh-web-restart: no listener on port $PORT after ${START_TIMEOUT}s"
  tail -n 20 "$out" "$errlog" 2>/dev/null >&2 || true
  return 1
}

verb=${1:-restart}
case "$verb" in
  restart) shift || true; do_stop && do_start "$@" ;;
  start) shift || true; do_start "$@" ;;
  stop) shift || true; do_stop ;;
  status)
    pid=$(listener_pid) || exit 1
    if [ -n "$pid" ]; then
      say "dsh web: running on http://$HOST:$PORT (pid $pid)"
    else
      say "dsh web: not running on $HOST:$PORT"
    fi
    ;;
  -h|--help|help) sed -n '2,19p' "$SCRIPT" | sed 's/^# \{0,1\}//' ;;
  *) err "dsh-web-restart: unknown command '$verb' (use restart|start|stop|status)"; exit 2 ;;
esac
