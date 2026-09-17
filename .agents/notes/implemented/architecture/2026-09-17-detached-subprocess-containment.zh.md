# Agent Note：detached 子进程 containment 让调用方拥有长生命周期后代

Status: implemented

[English](2026-09-17-detached-subprocess-containment.md) | 中文

## 问题

subprocess seam 会持有一个 managed range，使消费方的清理能够触达直接子进程留下的后代。但对那种「命令启动一个长期服务后返回」的消费方来说，这个默认行为是错的——例如某个工具调用启动本地集成环境、稍后另一个调用再停掉它。managed spawn 的 Linux transient scope 会在直接命令退出时停止，因此服务进程随之死亡；唯一的变通办法是让消费方耦合 systemd，或者保留一个合成的 `sleep infinity` scope 仅仅为了把 cgroup 撑住。seam 没有显式方式表达「这条命令的后代由我负责清理」，因此这一选择无法落在真正区分两种情形的归属边界上。

## 决策

`SubprocessSpawnSpec.containment` 把后代归属显式化。省略与 `'managed'` 保持 provider 的受管范围不变：`terminate()`、spec 的 abort 信号、服务释放与宿主退出都会触达可观察的后代，且 `waitForExit()` 在该范围清空之前不会 resolve。`'detached'` 则在所有 provider 自有范围之外启动目标：直接进程就是整个范围。

### Provider 映射

本地 provider 把 `'detached'` 当作直接启动，跳过 Linux transient scope、Win32 Job runner 与 fallback PGID/taskkill 范围，且不做探测也不发警告。它自行 spawn 目标（POSIX 上 `detached: true`，即新会话与新的进程组），并绑定一个仅针对直接进程的 owner：`terminate()` 与宿主退出终止只对直接进程发信号，`waitForExit()` 在该进程一退出时即 resolve，即使其后代仍在运行。因此 provider 的释放触及不到它从未声明的后代。

远端 provider（`subprocess-ssh`）会同步拒绝 `'detached'`：其远端执行世界拥有完整的进程范围，无法兑现调用方的归属声明，也绝不能悄悄把它降级为 managed 默认值。

### 消费方契约

`done` 与 managed spawn 一样报告直接命令的退出事实；新取值只改变范围归属。detached 后代能在句柄自身的 `terminate()`、服务的释放以及 JavaScript 可观察的宿主退出之后继续存活，并留在托管发起进程的那个 cgroup 中。设置 `'detached'` 的消费方负责停掉自己的后代；harness 不保留任何 registry，因为 registry 会重建这个选项本意要离开的范围。

### 面向模型的用法

bash 工具把该选择暴露为 `detached: true`，并在工具描述里说明归属转移。confining sandbox 会把命令包进它自己的 runner，那个 runner 的范围无论如何都拥有后代，因此工具在除 `danger-full-access` 以外的任何模式下拒绝 `detached`，而不是承诺一个 sandbox 不会兑现的脱离。后台 job 保持其 managed range；`job_kill` 仍能触达 job 的后代，因为一个停不掉的 job 会让 job 自身成为泄漏源。

## 既有决策与取代关系

本 note 在 [Native owners contain escaped subprocess descendants](2026-08-28-subprocess-native-containment.zh.md) 确立的原生 owner 之外，增加了一个显式 opt-out，并纠正了 [subprocess seam](../../archived/architecture/2026-07-26-subprocess-seam.md) 中「managed range 是唯一形态」的相应理解。两个 note 保留各自的其他决策，继续有效。

## 验证

- `packages/subprocess/subprocess-local/tests/spawn.spec.ts` 固定了仅针对直接进程的 owner：同组后代在 `terminate()`、`waitForExit()` 与 `terminateForHostExit()` 之后仍存活，而 `terminate()` 对仍在运行的直接进程仍会发信号。
- `packages/subprocess/subprocess-local/tests/local.spec.ts` 固定了 detached spawn 不查询任何原生 containment 探测，也从不进入 Linux scope 或 Win32 Job 路径。
- `packages/shell/bash-local/tests/executor.spec.ts` 固定了端到端 shell 路径：detached 命令的后台后代在 `run()` 返回后仍在运行。
- 一次真实的 Linux user-systemd 验证从长生命周期 unit 中分别 spawn 了 managed 与 detached 命令：scope 清空后 managed 后代消失，而 detached 后代在后续调用中仍在运行，`/proc/<pid>/cgroup` 指向托管 unit。

## 考虑过的替代方案

**让消费方使用 `setsid` 或 `nohup`。** 否决：两者都会把进程留在调用的 cgroup 内，因此无论会话或进程组归属如何，scope 停止都会杀掉它。

**让后台 job 默认 detached。** 否决：job 的契约包含 `job_kill` 触达 job 的工作，而一个命令已退出的 detached job 会留下 job 再也停不掉的后代。

**增加一个 per-session 的 systemd service 来拥有这些守护进程。** 作为 seam 机制否决：它绑定 systemd，无法服务远端 provider，并引入第二个调用方不可见的生命周期 owner。

**把 `containment` 设为必填。** 暂缓：可选字段让所有既有 provider 与消费方保持源码兼容，而归属于默认值仍然无歧义。必填字段会为了零行为变化去改动树中每一个手工构造的 spec。

**在 detached 句柄上返回 PID。** 否决：普通句柄刻意不暴露目标标识，而 detached 后代集合恰恰是 provider 不再观察的那个范围。

## 后果

消费方现在可以从一次工具调用启动长期进程、在稍后的调用中停止它，bash 工具直接暴露了这一能力。代价是一次没有 harness 安全网的归属转移：设置 `'detached'` 却从不清理的消费方会留下进程一直运行到托管 cgroup 结束，而 harness 无法通过既有的范围观察报告它们。
