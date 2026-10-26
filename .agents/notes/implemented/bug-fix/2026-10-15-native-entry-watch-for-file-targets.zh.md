# Agent Note: 文件目标改为原生订阅父目录条目

Status: implemented

[English](2026-10-15-native-entry-watch-for-file-targets.md) | 中文

## Problem

一个 web Host 在 20.7 小时的运行时间里积累了约 16 小时的 CPU 时间，几乎全部在主线程上。CPU 画像把采样归到 Chokidar 的目录读取器：`ReaddirpStream._read`、`lstat`（占 23% 采样）以及逐条目的路径归一化。在 Chokidar 的 `_handleRead` 里下断点后，被观察的目录解析为 `/tmp`，而该 watcher 的 `ignored` 谓词只放行一个条目 `/tmp/rueidis-full-test.sh`——Workspace 文件面板当时打开的文件。dsh-fs-local 监听文件目标的方式是监听其父目录再筛选到目标，而 Chokidar 在该读取器里强制 `alwaysStat: true, lstat: true`，因此 `/tmp` 下每一次变化都要付一次 `readdir` 加每个同级的 `lstat`。在那台 Host 上，单次扫描 `/tmp`（50,821 个条目）耗时 1,225 ms——64 ms 花在 `readdir`，1,161 ms 花在 50,836 次 `lstat`——而 watcher 每秒重复 1.36 次，即「每个目录每秒一次」的限流对上每秒变化约两次的目录。于是监听一个文件就占满了将近一个核心，排在它后面的每个 Host 请求都在等，包括点「新会话」。该目录之所以这么大，是因为本地 issue 锁的 sidecar 按路径命名且刻意从不删除，一天的工装运行就在那里留下了数万个锁文件。

## Decision

`LocalFileSystem.watch` 对目录目标、以及对父目录尚不存在的文件目标继续使用 Chokidar；对父目录已存在且为目录的文件目标，改用原生 `fs.watch` 订阅该父目录。原生订阅会报出变化条目的名字，监听器只放行这个名字，因此每次变化的代价不再随同级条目数增长。平台不提供名字时按「发生了变化」上报，由调用方重新 stat 目标。监听父目录而不是文件本身，使原子替换、删除和同路径重建仍然可见，因为父目录的 `rename` 事件带有目标的名字。原生分支不等待就绪握手即解析返回：内核 watch 在 `fs.watch` 返回前就已注册，也没有初次扫描需要等待。

## Alternatives considered

**改用 Chokidar 监听文件本身。** 否决：Chokidar 出于自身记账无论如何都会监听父目录，并在父目录每次变化时重新进入同一个读取器，缺陷依旧。

**保留 Chokidar，给被监听目录的条目数设上限。** 否决：阈值会改变一个部署能观察到哪些事件，而耗 CPU 的是 Chokidar 的逐条目 stat，它在任何筛选之前就已执行。

**轮询目标的元数据。** 否决：这会给每个被监听文件加上一个定时 stat，上报延迟，并且重复了 OS 事件已经提供的东西。

**父目录很大时放弃监听。** 否决：静默失去失效通知比 watcher 慢更糟；调用方会一直展示过期内容而不报错。

## Consequences

文件目标现在的代价是一次 inotify / FSEvents / ReadDirectoryChangesW 订阅，加一次确认父目录为目录的 `stat`，而不是每次变化扫描全部同级条目。代价是这条路径失去了 Chokidar 的重新挂载能力：若父目录在监听成功后先删除再重建，原生订阅仍停留在旧目录上，之后不再上报任何事件。监听时父目录不存在的情况仍走 Chokidar，其就绪时也覆盖起初缺失文件的创建，因此受影响的只有监听开始之后被删除的目录。

## Testing

`packages/fs/fs-local/tests/watch.spec.ts` 用替身驱动两条分支：父目录已存在的文件目标或缺失目标恰好收到一次 `fs.watch(dirname(target), { persistent: true })` 调用，只上报被监听条目的名字，会上报无名事件，会把非 Error 的 watcher 错误归一化，并能关闭；父目录不存在的目标走 Chokidar 父目录监听，保持此前的筛选与就绪契约。`packages/fs/fs-local/src/index.ts` 维持在语句、分支、函数、行四项 100%。
