#!/usr/bin/env sh
# Launch the Desktop (Electron) shell from this checkout, sharing $DSH_HOME with `dsh web`.
#
# Desktop ships macOS and Windows packages only. On Linux this launcher runs the same
# development pipeline under the mac-x64 build target: the Electron shell and the bundled
# Web application are platform-independent, and the prepared macOS payload is downloaded
# but never executed (its smoke check skips a foreign target). Office authoring tools that
# need the bundled Python runtime stay unavailable in this Linux development launch.
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
APP_ROOT="$ROOT/apps/desktop"
ELECTRON="$APP_ROOT/node_modules/electron/dist/electron"
PNPM_ENTRY="$APP_ROOT/node_modules/pnpm/bin/pnpm.mjs"

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'dsh-desktop: error: %s\n' "$*" >&2
  exit 1
}

now_ms() {
  date +%s%3N 2>/dev/null || printf '0'
}

elapsed() {
  if [ "$START" = 0 ]; then return 0; fi
  printf 'dsh desktop: +%s ms %s\n' "$(( $(now_ms) - START ))" "$1"
}

usage() {
  cat <<'USAGE'
Usage:
  dsh desktop                  inherit ~/.dsh sessions/settings and the web profile's plugins
  dsh desktop --isolated       sandbox DSH_HOME under apps/desktop/.desktop-build/linux-dev/home
  dsh desktop --home=<dir>     explicit DSH_HOME
  dsh desktop --build          rebuild the workspace before launching
  dsh desktop --reseed         re-copy the web profile's plugins and patch layer
  dsh desktop --no-install     skip the profile plugin install
  dsh desktop --without=a,b    drop bundles from the Desktop profile (comma separated)
  dsh desktop --diagnostics    open DevTools, keep the inspector ports and Chromium logging
  dsh desktop --no-diagnostics engine diagnostics off (default)
  dsh desktop --help           show this help

Default launch omits the shell and Host inspectors, Chromium logging, and DevTools: they
cost CPU and memory in a session nobody is debugging. Use --diagnostics when you need them.

The Desktop Host listens on http://127.0.0.1:19387. Do not open a Session that a
running `dsh web` is still writing: both Hosts would append to the same Session log.
USAGE
}

START=$(now_ms)
BUILD=no
ISOLATED=no
RESEED=no
INSTALL=yes
DIAGNOSTICS=off
WITHOUT=
HOME_OVERRIDE=
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=yes ;;
    --isolated) ISOLATED=yes ;;
    --reseed) RESEED=yes ;;
    --no-install) INSTALL=no ;;
    --diagnostics) DIAGNOSTICS=on ;;
    --no-diagnostics) DIAGNOSTICS=off ;;
    --without=*) WITHOUT="${arg#--without=}" ;;
    --home=*) HOME_OVERRIDE="${arg#--home=}" ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

[ -d "$ROOT/node_modules" ] || die "workspace dependencies are missing; run pnpm install in $ROOT"

if [ -n "$HOME_OVERRIDE" ]; then
  DSH_HOME="$HOME_OVERRIDE"
elif [ "$ISOLATED" = yes ]; then
  DSH_HOME="$APP_ROOT/.desktop-build/linux-dev/home"
else
  DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
fi
mkdir -p "$DSH_HOME"

if [ ! -x "$ELECTRON" ]; then
  say "dsh desktop: downloading the Electron binary (one time)"
  node "$APP_ROOT/node_modules/electron/install.js" || die "Electron download failed"
fi

PROFILE="$DSH_HOME/profiles/desktop"
SEED_FLAGS="--home=$DSH_HOME"
[ "$RESEED" = yes ] && SEED_FLAGS="$SEED_FLAGS --reseed"
[ -n "$WITHOUT" ] && SEED_FLAGS="$SEED_FLAGS --without=$WITHOUT"
# shellcheck disable=SC2086
node "$ROOT/scripts/dsh-desktop-profile.mjs" $SEED_FLAGS
elapsed "profile ready"

if [ "$INSTALL" = yes ] && [ ! -d "$PROFILE/node_modules" ] && [ -f "$PROFILE/package.json" ]; then
  if node -e "process.exit(Object.keys(require('$PROFILE/package.json').dependencies ?? {}).length === 0 ? 1 : 0)"; then
    say "dsh desktop: installing inherited plugins into $PROFILE (first launch takes a few minutes)"
    if ! ( cd "$PROFILE" && env ELECTRON_RUN_AS_NODE=1 DSH_DESKTOP_NODE_EXECUTABLE="$ELECTRON" \
        PATH="$APP_ROOT/scripts/node-bin:$PATH" "$ELECTRON" --expose-internals "$PNPM_ENTRY" install ); then
      say "dsh desktop: plugin install failed; the app still boots and the Plugin Manager can retry" >&2
    fi
    elapsed "plugins installed"
  fi
fi

BUILD_NEEDED=no
if [ "$BUILD" = yes ] || [ ! -f "$APP_ROOT/lib/main.js" ] || [ ! -f "$ROOT/apps/desktop-host/lib/index.js" ] || [ ! -f "$ROOT/apps/cli/lib/bin.js" ]; then
  BUILD_NEEDED=yes
fi

DIST_INDEX="$ROOT/apps/web/dist/index.html"
if [ -f "$DIST_INDEX" ] && [ -n "$(find "$ROOT/packages/client" "$ROOT/apps/web/src" -newer "$DIST_INDEX" -name '*.ts' -print -quit 2>/dev/null)" ]; then
  say "dsh desktop: warning: apps/web/dist is older than the client sources; the window shows a stale build (pass --build)" >&2
fi

say "dsh desktop: DSH_HOME=$DSH_HOME"
say "dsh desktop: profile=$PROFILE"

TARGET_ENV=
case "$(uname -s)" in
  Darwin) ;;
  Linux) TARGET_ENV="DSH_DESKTOP_TARGET_PLATFORM=darwin DSH_DESKTOP_TARGET_ARCH=x64" ;;
  *) die "unsupported host: $(uname -s)" ;;
esac

cd "$ROOT"
if [ "$BUILD_NEEDED" = yes ]; then
  say "dsh desktop: building the workspace and the Electron shell"
  # shellcheck disable=SC2086
  exec env $TARGET_ENV \
    DSH_HOME="$DSH_HOME" \
    DSH_DESKTOP_DIAGNOSTICS="$DIAGNOSTICS" \
    pnpm --filter @deepseek-ai/dsh-desktop run dev
fi

elapsed "launcher ready"
say "dsh desktop: launching the Electron shell (diagnostics $DIAGNOSTICS)"
# Skip the package-manager wrapper on the warm path: it costs about 0.7 s before the shell is
# spawned, and the source launch contract already runs TypeScript through tsx.
# shellcheck disable=SC2086
exec env $TARGET_ENV \
  DSH_HOME="$DSH_HOME" \
  DSH_DESKTOP_DIAGNOSTICS="$DIAGNOSTICS" \
  node --import tsx/esm "$APP_ROOT/scripts/dev.ts" --skip-build
