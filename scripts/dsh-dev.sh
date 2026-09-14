#!/usr/bin/env sh
# Source-tree launcher wrapper for `dsh`.
#
# This command anchors every launch to the deepseek-harness checkout that
# contains this script. It is for contributors who want the normal `dsh`
# command without changing the working directory or using a globally installed
# copy. The source tree is always the code that runs; edits under packages/
# or apps/ are picked up on the next launch (rebuild where the loaded profile
# needs built artifacts).

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
APP="$ROOT/apps/cli/src/bin.ts"
DEFAULT_BIN_DIR="${DSH_DEV_BIN_DIR:-$HOME/.local/bin}"

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'dsh-dev: error: %s\n' "$*" >&2
  exit 1
}

run_dsh() {
  # Make sure the launcher is reachable from the repo root so tsx/ESM
  # module resolution and package-local .env still behave like `pnpm dsh`.
  cd "$ROOT"

  if ! [ -f "$APP" ]; then
    die "launcher not found: $APP"
  fi

  if ! [ -f "$ROOT/apps/cli/lib/bin.js" ]; then
    say "dsh-dev: warning: apps/cli/lib/bin.js is missing; run \`pnpm run build\` if the loaded profile needs built artifacts" >&2
  fi

  # `node --import tsx/esm` is the source launch contract used by
  # `pnpm dsh` when the repository has its workspace dependencies installed.
  # `pnpm` is not required just to launch; it is required for dependency
  # setup and for plugin installs through the existing `dsh plugin` path.
  exec node --import tsx/esm "$APP" "$@"
}

print_status() {
  link="$DEFAULT_BIN_DIR/dsh"
  say "dsh-dev source: $ROOT"
  if [ -L "$link" ]; then
    say "command link: $link -> $(readlink "$link")"
  elif [ -e "$link" ]; then
    say "command link: $link (not a dsh-dev symlink; leave it or remove it manually)"
  else
    say "command link: not installed (run \`$0 install\`)"
  fi
  if [ -f "$ROOT/apps/cli/lib/bin.js" ]; then
    say "built lib: present"
  else
    say "built lib: missing (coarse indicator; run \`pnpm run build\` for profiles that need built artifacts)"
  fi
}

install_link() {
  mkdir -p "$DEFAULT_BIN_DIR"
  target="$DEFAULT_BIN_DIR/dsh"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    die "$target exists and is not a symlink; move it away or set DSH_DEV_BIN_DIR"
  fi
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$ROOT/scripts/dsh-dev.sh" ]; then
    say "already installed: $target"
    return
  fi
  ln -sfn "$ROOT/scripts/dsh-dev.sh" "$target"
  say "installed: $target"
  say "add to PATH if needed: export PATH=\"$DEFAULT_BIN_DIR:\$PATH\""
}

uninstall_link() {
  target="$DEFAULT_BIN_DIR/dsh"
  if [ ! -L "$target" ]; then
    if [ -e "$target" ]; then
      die "$target is not a dsh-dev symlink; remove it manually"
    fi
    say "not installed: $target"
    return
  fi
  current=$(readlink "$target")
  if [ "$current" != "$ROOT/scripts/dsh-dev.sh" ]; then
    die "$target points to $current, not this checkout; remove it manually"
  fi
  rm "$target"
  say "removed: $target"
}

usage() {
  cat <<'EOF'
dsh-dev: run the dsh CLI from this deepseek-harness source tree.

Usage:
  dsh-dev <args...>                  run dsh (all launcher/profile args pass through)
  dsh-dev install                    symlink this wrapper as ~/.local/bin/dsh
  dsh-dev uninstall                  remove that symlink
  dsh-dev status                     show source checkout, link, and build state
  dsh-dev help                       show this help (dsh --help forwards to the CLI)

Examples:
  dsh-dev install
  dsh-dev web                        boot web from this checkout
  dsh-dev --profile headless "job"
  dsh-dev plugin --profile demo add ./hello-plugin

DSH_DEV_BIN_DIR overrides the install target directory (default ~/.local/bin).
EOF
}

case "${1:-}" in
  install) install_link ;;
  uninstall) uninstall_link ;;
  status) print_status ;;
  help) usage ;;
  --dsh-dev-help) usage ;;
  *) run_dsh "$@" ;;
esac
