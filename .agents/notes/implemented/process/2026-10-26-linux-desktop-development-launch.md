# Agent Note: Linux development launch for the Desktop shell

Status: implemented

English | [中文](2026-10-26-linux-desktop-development-launch.zh.md)

## Problem

Desktop ships macOS and Windows packages only. `apps/desktop/scripts/desktop-build-paths.mjs` fixes the target set, and its resolver throws on a Linux host, so `pnpm run dev:desktop` cannot start there. The Electron shell, the shared Web application, and the plugin profile are platform-independent; only the prepared payload and the packaging path are not. Comparing Desktop against Web on a Linux workstation therefore had no launch, and the two products could not be driven from one Harness home.

## Decision

`scripts/dsh-desktop.sh` launches the unpackaged shell, and `scripts/dsh-dev.sh` routes `dsh desktop` to it. On Linux it runs the existing development pipeline under the `mac-x64` build target by setting `DSH_DESKTOP_TARGET_PLATFORM=darwin` and `DSH_DESKTOP_TARGET_ARCH=x64`. The build directories and the prepared payload then belong to a foreign target: the payload is downloaded once, and its smoke check returns early on a platform mismatch, so no macOS binary executes. Module resolution, the Host, and the renderer stay the platform's own.

The launch shares `DSH_HOME` with `dsh web`, so Sessions, storages, skills, and settings are the same records in both products. `profiles/desktop` is seeded from `profiles/web`: its dependency list and bundle rows, its `cordis.patch.yml` user layer, and its `settings.yaml`, because Desktop owns that profile exclusively and never shares `node_modules` with Web ([bundled runtime and external plugins](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md)). `--reseed` repeats the inheritance, and `--without=a,b` drops named bundles without rewriting the rest of the Desktop manifest.

Diagnostics are opt-in. `apps/desktop/scripts/dev.ts` reads `DSH_DESKTOP_DIAGNOSTICS` and omits the shell inspector, the renderer debugging port, the Host inspector, Chromium logging, and DevTools unless it is `on`; `--diagnostics` sets it. The warm path spawns `node --import tsx/esm apps/desktop/scripts/dev.ts --skip-build` instead of the package-manager wrapper, and `dev.ts` spawns pnpm through `scripts/pnpm-invocation.ts`, so a standalone pnpm executable (a native binary rather than a JavaScript entrypoint) does not break `--build`.

On Linux the shell runs with `--no-sandbox`, because a checkout's `chrome-sandbox` is never root-owned mode 4755. `prepareDevelopmentProject` skips dangling virtual-store links and linked directories without a manifest, both of which a Linux checkout produces.

## What this launch does not cover

The bundled Python runtime and the Office authoring tools are unavailable, because their payload is foreign. Packaging, signing, update delivery, the tray, and the Platform account view are untouched by this path and remain macOS and Windows concerns. No CI lane executes it.

A first launch prepares the `mac-x64` payload; later launches reuse it. The launcher prints its own phase timings and warns when `apps/web/dist` predates the client sources, which means the window serves an older client build until `--build` rebuilds it.

`dsh-better-sidebar` loads but cannot open its agent connection in Desktop; `dsh desktop --without=dsh-better-sidebar` drops it.

## Alternatives considered

**Add Linux to the shipped target set.** It would turn an evaluation path into a supported product: packaging, signing, updates, the tray, and platform-integration testing for a platform nobody maintains. The launcher borrows the foreign target instead and states that in its own output.

**Point `profiles/desktop` at the Web profile directory.** Desktop owns that directory and its package-manager state, so sharing it would let either product change the other's plugin graph and native modules. Copying the manifest, patch layer, and settings keeps the data identical without sharing executable packages.

**Prepare a stub payload instead of the `mac-x64` payload.** A stub needs its own descriptor, version fields, and dependency layout, and every Skill that reads the payload would need a second path; the download is one-time and reuses the maintained preparation.

**Keep the inspectors and DevTools on by default.** They tax every launch that nobody debugs, and one flag restores the previous development defaults.

## Consequences

A Linux workstation can run the same client, Host, and plugin graph as the Web product against the same Harness home, which is what made the startup comparison and the plugin-compatibility gaps observable. The cost is a launch that depends on a foreign target's build directory, a one-time payload download, and the absence of every Office capability. macOS and Windows launches are unchanged: they resolve their own target and never take the Linux branch.
