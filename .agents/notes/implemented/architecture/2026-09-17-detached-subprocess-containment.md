# Agent Note: Detached subprocess containment lets a caller own long-lived descendants

Status: implemented

English | [中文](2026-09-17-detached-subprocess-containment.zh.md)

## Problem

The subprocess seam owns a managed range so that consumer teardown reaches descendants a direct child left behind. That default is wrong for a consumer whose command starts a long-lived service and returns — a local integration environment started by one tool call and stopped by a later one. A managed spawn's Linux transient scope stops when the direct command exits, so the service processes die with it, and the only workarounds couple the consumer to systemd or keep a synthetic `sleep infinity` scope alive just to hold the cgroup open. The seam had no explicit way to express "this command's descendants are mine to clean up", so the choice could not live at the ownership boundary that actually distinguishes the two cases.

## Decision

`SubprocessSpawnSpec.containment` makes descendant ownership explicit. Omitted and `'managed'` keep the provider's contained range unchanged: `terminate()`, the spec's abort signal, service disposal, and host exit all reach observable descendants, and `waitForExit()` does not resolve until that range is empty. `'detached'` starts the target outside every provider-owned range: the direct process is the whole range.

### Provider mapping

The local provider treats `'detached'` as a direct launch, bypassing the Linux transient scope, the Win32 Job runner, and the fallback PGID/taskkill range without probing or warning. It spawns the target itself (`detached: true` on POSIX, a new session and process group) and binds a direct-only owner: `terminate()` and host-exit termination signal only the direct process, and `waitForExit()` resolves as soon as that process exits even while descendants keep running. Provider disposal therefore cannot reach descendants it never claimed.

The remote provider (`subprocess-ssh`) rejects `'detached'` synchronously: its remote execution world owns the complete process range, so it cannot honor the caller's ownership claim and must not silently degrade it to the managed default.

### Consumer contract

`done` reports the direct command's exit facts exactly as for a managed spawn; the new value changes only range ownership. A detached descendant survives the handle's own `terminate()`, the service's disposal, and JavaScript-observable host exit, and it remains in the cgroup that hosted the spawning process. The consumer that sets `'detached'` owns stopping its descendants; the harness keeps no registry, since a registry would re-create the range the option exists to leave.

### Model-facing use

The bash tool exposes the choice as `detached: true` and states the ownership transfer in the tool description. A confining sandbox wraps the command in its own runner, whose range owns the descendants regardless of the subprocess choice, so the tool refuses `detached` under any mode other than `danger-full-access` instead of promising a detachment the sandbox will not honor. Background jobs keep their managed range; `job_kill` continues to reach a job's descendants, because a job that could not be stopped would make the jobs themselves a leak.

## Existing decisions and supersession

This note adds an explicit opt-out beside the native owners that [Native owners contain escaped subprocess descendants](2026-08-28-subprocess-native-containment.md) established, and it corrects the corresponding "managed ranges are the only shape" reading of the [subprocess seam](../../archived/architecture/2026-07-26-subprocess-seam.md). Both notes retain their other decisions and remain active.

## Verification

- `packages/subprocess/subprocess-local/tests/spawn.spec.ts` pins the direct-only owner: a same-group descendant survives `terminate()`, `waitForExit()`, and `terminateForHostExit()`, while `terminate()` still signals a running direct process.
- `packages/subprocess/subprocess-local/tests/local.spec.ts` pins that a detached spawn consults no native containment probe and never enters the Linux scope or Win32 Job path.
- `packages/shell/bash-local/tests/executor.spec.ts` pins the end-to-end shell path: a detached command's backgrounded descendant is still running after `run()` returns.
- A real Linux user-systemd spike spawned one managed and one detached command from a long-lived unit: the managed descendant was gone after its scope emptied, while the detached descendant was still running in a later invocation with `/proc/<pid>/cgroup` naming the hosting unit.

## Alternatives considered

**Tell consumers to use `setsid` or `nohup`.** Rejected: both leave the process inside the call's cgroup, so the scope stop kills it regardless of session or process-group membership.

**Make background jobs detached.** Rejected: a job's contract includes `job_kill` reaching the job's work, and a detached job whose command exits would leave descendants the job can no longer stop.

**Add a per-session systemd service that owns the daemons.** Rejected as the seam's mechanism: it is systemd-specific, cannot serve the remote provider, and introduces a second lifecycle owner whose teardown the caller cannot see.

**Make `containment` required.** Deferred: the optional field keeps every existing provider and consumer source-compatible while the ownership default is unambiguous. A required field would touch every hand-built spec in the tree for no behavior change.

**Return a PID on the detached handle.** Rejected: the ordinary handle deliberately has no target identity, and a detached descendant set is exactly the range the provider no longer observes.

## Consequences

A consumer can now start a long-lived process from one tool call and stop it from a later one, which the bash tool exposes directly. The cost is an ownership transfer with no harness safety net: a consumer that sets `'detached'` and never cleans up leaves processes running until the hosting cgroup ends, and the harness cannot report them through its existing range observations.
