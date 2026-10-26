# Agent Note: A file target watches its parent entry natively

Status: implemented

English | [中文](2026-10-15-native-entry-watch-for-file-targets.zh.md)

## Problem

One web Host had accumulated about 16 hours of CPU time in 20.7 hours of uptime, nearly all of it on its main thread. A CPU profile attributed the samples to Chokidar's directory reader: `ReaddirpStream._read`, `lstat` (23% of samples), and per-entry path normalization. A breakpoint inside Chokidar's `_handleRead` resolved the watched directory as `/tmp`, and that watcher's `ignored` predicate accepted exactly one entry, `/tmp/rueidis-full-test.sh` — the file a Workspace files panel had open. dsh-fs-local watches a file target by watching its parent directory and filtering to the target, and Chokidar forces `alwaysStat: true, lstat: true` in that reader, so every change under `/tmp` cost one `readdir` plus one `lstat` per sibling. On that Host a single scan of `/tmp` (50,821 entries) took 1,225 ms — 64 ms of `readdir` and 1,161 ms for 50,836 `lstat` calls — and the watcher repeated it 1.36 times per second, the one-scan-per-directory-per-second throttle against a directory that changed about twice a second. One watched file therefore held roughly a whole core, and every Host request behind it waited, including a New Session click. The directory was that large because a local issue-lock sidecar is per path and deliberately never removed, so a day of tooling had left tens of thousands of lock files there.

## Decision

`LocalFileSystem.watch` keeps Chokidar for a directory target and for a file target whose parent directory does not exist, and subscribes with the native `fs.watch` on the parent for a file target whose parent is an existing directory. The native subscription reports the changed entry's name and the listener forwards only that name, so the cost per change no longer grows with the number of siblings. A platform that omits the name reports the change, and the consumer re-stats the target. Watching the parent rather than the file keeps atomic replacement, deletion, and same-path recreation visible, because the parent's `rename` event carries the target's name. The native arm resolves without an awaited readiness handshake: the kernel watch is registered before `fs.watch` returns, and there is no initial scan to wait for.

## Alternatives considered

**Watch the file itself with Chokidar.** Rejected: Chokidar watches the parent for its own bookkeeping regardless, and re-enters the same reader on every parent change, so the defect survives.

**Keep Chokidar and bound the watched directory's size.** Rejected: a threshold would change which events a deployment observes, and the CPU cost is Chokidar's per-entry stat, which runs before any filter is applied.

**Poll the target's metadata.** Rejected: it adds a scheduled stat per watched file, reports changes late, and duplicates what OS events already provide.

**Drop the watch when the parent directory is large.** Rejected: silently losing invalidation is worse than a slow watcher; callers would keep showing stale content with no error.

## Consequences

A file target now costs one inotify, FSEvents, or ReadDirectoryChangesW subscription plus one `stat` that confirms its parent is a directory, instead of a scan of every sibling per change. The trade-off is that Chokidar's re-arming is gone on this path: a parent directory removed and recreated after a successful watch leaves the native subscription on the old directory, which reports nothing further. A parent that does not exist at watch time still takes the Chokidar path, whose readiness covers creation of the initially missing file, so only a directory deleted after the watch started is affected.

## Testing

`packages/fs/fs-local/tests/watch.spec.ts` drives both arms with fakes: a file or missing target whose parent directory exists receives exactly one `fs.watch(dirname(target), { persistent: true })` call, reports only the watched entry's name, reports an unnamed event, normalizes a non-Error watcher error, and closes; a target whose parent is absent takes the Chokidar parent watch with the previous filter and readiness contract. `packages/fs/fs-local/src/index.ts` stays at 100% statements, branches, functions, and lines.
