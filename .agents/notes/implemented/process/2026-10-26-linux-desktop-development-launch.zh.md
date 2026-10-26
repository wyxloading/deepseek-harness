# Agent Note: Desktop shell 的 Linux 开发启动

Status: implemented

[English](2026-10-26-linux-desktop-development-launch.md) | 中文

## Problem

Desktop 只发布 macOS 与 Windows 包。`apps/desktop/scripts/desktop-build-paths.mjs` 固定了 target 集合，其解析函数在 Linux 主机上直接抛错，因此 `pnpm run dev:desktop` 在那里无法启动。Electron shell、共享的 Web 应用以及插件 profile 都是平台无关的，只有预置 payload 与打包链路不是。于是在 Linux 工作站上对比 Desktop 与 Web 没有任何启动入口，两个产品也无法共用同一个 Harness home 运行。

## Decision

`scripts/dsh-desktop.sh` 负责启动未打包的 shell，`scripts/dsh-dev.sh` 把 `dsh desktop` 转发给它。在 Linux 上它通过设置 `DSH_DESKTOP_TARGET_PLATFORM=darwin` 与 `DSH_DESKTOP_TARGET_ARCH=x64`，让既有开发流水线按 `mac-x64` target 运行。构建目录与预置 payload 因此属于一个外来 target：payload 只下载一次，其 smoke 检查在平台不匹配时提前返回，不会有 macOS 二进制被执行。模块解析、Host 与渲染器仍然运行在该平台自身之上。

该启动与 `dsh web` 共用 `DSH_HOME`，因此 Session、storage、skill 与 setting 在两侧是同一批记录。`profiles/desktop` 从 `profiles/web` 播种：依赖清单与 bundle 行、`cordis.patch.yml` 用户层，以及 `settings.yaml`，因为 Desktop 独占该 profile，且从不与 Web 共享 `node_modules`（[内置运行时与外部插件](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.zh.md)）。`--reseed` 重新执行继承，`--without=a,b` 只删除指名 bundle，不重写 Desktop manifest 的其余部分。

诊断默认关闭。`apps/desktop/scripts/dev.ts` 读取 `DSH_DESKTOP_DIAGNOSTICS`，除非取值为 `on`，否则不附加 shell inspector、渲染器调试端口、Host inspector、Chromium 日志与 DevTools；`--diagnostics` 会把它设为 `on`。热路径直接执行 `node --import tsx/esm apps/desktop/scripts/dev.ts --skip-build`，不再经过包管理器包装层；`dev.ts` 通过 `scripts/pnpm-invocation.ts` 拉起 pnpm，因此 standalone 形式的 pnpm 可执行文件（原生二进制，而非 JavaScript 入口）不会再让 `--build` 失败。

在 Linux 上 shell 以 `--no-sandbox` 运行，因为 checkout 里的 `chrome-sandbox` 永远不会是 root 所有且权限为 4755。`prepareDevelopmentProject` 跳过悬空的虚拟仓库软链与没有 manifest 的链接目录，这两类在 Linux checkout 上都会出现。

## What this launch does not cover

内置 Python 运行时与 Office 写作工具不可用，因为它们的 payload 属于外来平台。打包、签名、更新分发、托盘与 Platform 账户视图都不受这条路径影响，仍属 macOS 与 Windows 的范围。没有任何 CI lane 执行它。

首次启动会准备 `mac-x64` payload，之后的启动复用它。启动器会打印自身各阶段耗时，并在 `apps/web/dist` 早于客户端源文件时给出告警，这意味着窗口在 `--build` 重建之前展示的是旧的客户端构建。

`dsh-better-sidebar` 能加载，但在 Desktop 下无法建立它的 agent 连接；`dsh desktop --without=dsh-better-sidebar` 可以去掉它。

## Alternatives considered

**把 Linux 加入正式 target 集合。** 这会把一条评估路径变成受支持产品：为一个无人维护的平台提供打包、签名、更新、托盘与平台集成测试。启动器的做法是借用外来 target，并在自己的输出里说明这一点。

**让 `profiles/desktop` 指向 Web profile 目录。** Desktop 独占该目录及其包管理器状态，共享会让任一产品改动对方的插件图与原生模块。复制 manifest、patch 层与 settings 既保持数据一致，又不共享可执行包。

**准备一份 stub payload 代替 `mac-x64` payload。** stub 需要自己的 descriptor、版本字段与依赖布局，每个读取 payload 的 Skill 都要多一条路径；而下载只发生一次，且复用已有的准备流程。

**默认保留 inspector 与 DevTools。** 它们会给每次无人调试的启动增加开销，而一个开关就能恢复此前的开发默认值。

## Consequences

Linux 工作站可以用与 Web 产品相同的客户端、Host 与插件图运行在同一个 Harness home 上，正是这一点让启动对比与插件兼容性缺口变得可观测。代价是启动依赖一个外来 target 的构建目录、一次性 payload 下载，以及所有 Office 能力的缺席。macOS 与 Windows 启动不变：它们解析自己的 target，从不进入 Linux 分支。
