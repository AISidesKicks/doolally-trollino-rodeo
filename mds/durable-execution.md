# Durable execution - research links

Why this page exists: Trollino kills the classification worker at random. The worker must resume from SQLite instead of restarting the whole batch, and the GUI must show that recovery. This list backs item 1 of the plan in [INTENT.md](../INTENT.md).

## The core idea

- Commit intent before doing work. If the process dies, reopen the store and continue.
- A checkpoint is not a frozen JavaScript stack. On restart the app reruns the task phase from its last committed checkpoint.
- Side effects are the hard part. A tool may finish (email sent, payment made) and lose the result. That is why replay policy and idempotency keys matter.
- The host still has to supervise and restart the process. Opening SQLite again does not restart anything by itself.

## Primary references (Pi Durable)

### alejandro-ao/pi-durable-demo

https://github.com/alejandro-ao/pi-durable-demo

The direct inspiration for this project: companion code for the Pi Durable tutorial. Node.js 24+, SQLite, llama.cpp and restart recovery.

- `chat.mjs` - fresh conversation on every launch.
- `chat-resume.mjs` - reopen a saved conversation and resume interrupted work.
- Recovery is from persisted checkpoints. The CLI must run again; reopening SQLite is not enough.
- Ctrl+C is a graceful close, not a durable abort. SIGKILL and power-loss recovery are not covered by its tests - exactly the gap Trollino should exercise.
- Uses a simple PID guard for single-owner access. Good enough for a lab, not a distributed lock.

### earendil-works/pi - packages/durable

https://github.com/earendil-works/pi/tree/main/packages/durable

The harness behind the demo. Worth reading the README and the design spec.

- `Harness.open()` over SQLite or JSONL storage; `harness.resume()` picks up unfinished runs.
- Tools declare `replay: "safe"` to rerun after a crash. Otherwise the model gets an `interrupted` result with the output committed so far.
- `settings.restartLimit` (default 5) parks tasks that keep crashing, so a crash loop does not spin forever.
- `watch()` streams committed state, which maps well to a GUI that shows recovery live.
- Telemetry spans (`pi.durable.phase`, `pi.durable.checkpoint`, `pi.durable.replay`) are a good model for our Phoenix traces.
- Design spec: https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md
- Intro post: https://earendil.com/posts/pi-durable/

### earendil-works/pi - durable coding agent

https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/experimental/durable/README.md

Small local agent where the process owns the model runtime, the harness, SQLite storage and the TUI. Kill it mid tool call, start again with `--continue`: the interrupted call gets an interrupted result and the turn finishes.

### vercel-labs/durable-harness

https://github.com/vercel-labs/durable-harness

Adapters that make existing coding agents (Claude Code, Codex, OpenCode, Pi, fx) durable on a Workflow SDK World. Good comparison material for replay versus kill-the-process demos.

- Blog post: https://vercel.com/blog/making-every-harness-durable

## SQLite-first / small engines

These are closer to our lab setup: one file, one process, no extra services.

### danfry1/reflow-ts

https://github.com/danfry1/reflow-ts

Durable workflow execution for TypeScript, SQLite only. Steps are checkpointed, stale runs are reclaimed after a lease expires, and workflows can sleep or wait for events for days without keeping the process alive.

### RaycarlLei/tool-journal

https://github.com/RaycarlLei/tool-journal

Execution journal for tools that may be retried after a crash. Node.js 24.15+, SQLite, no runtime dependencies.

- Records intent before execution and uses lease fencing.
- Treats "the action happened but the response was lost" as an explicit uncertain outcome instead of guessing.
- Reproducible crash tests - useful patterns for our kill script and test suite.

### ahmedrowaihi/iterativeflow

https://github.com/ahmedrowaihi/iterativeflow

Backend-agnostic durable workflows. The same engine runs over Postgres, SQLite, MySQL, MongoDB, Redis, DynamoDB or Cloudflare Durable Objects. Steps commit their result and side effects in one transaction (outbox).

### nimeshnayaju/workerflow

https://github.com/nimeshnayaju/workerflow

Durable execution engine built on Cloudflare Workers and Durable Objects. Shows how to durably write `started` before invoking a workflow callback, so a stuck attempt can be detected after eviction.

## Larger frameworks

Heavier than this lab needs, but their docs explain the vocabulary well.

### dbos-inc/dbos-transact-ts

https://github.com/dbos-inc/dbos-transact-ts

Lightweight durable workflows on Postgres. Ordinary functions registered as workflows and steps, durable timeouts, automatic resume from the last completed step.

- Demo apps: https://github.com/dbos-inc/dbos-demo-apps

### restatedev/examples

https://github.com/restatedev/examples

Examples for Restate, a durable execution platform for services, virtual objects and workflows. Good for understanding durable RPC and stateful services.

### temporalio/samples-typescript

https://github.com/temporalio/samples-typescript

The classic durable execution model: workflows, activities, retries, child workflows. Requires a Temporal server, so it is not a drop-in for our single-container demo.

### inngest/inngest

https://github.com/inngest/inngest

Event-driven durable functions with step primitives such as `step.run`, `step.sleep` and `step.waitForEvent`. Runs on serverless, servers or the edge.

### hatchet-dev/hatchet

https://github.com/hatchet-dev/hatchet

Orchestration engine for background tasks, AI agents and durable workflows. Task queues plus DAG-style dependencies.

### triggerdotdev/trigger.dev

https://github.com/triggerdotdev/trigger.dev

Background jobs and durable AI workflows with checkpoint and resume support. The task dashboard is a useful reference for showing run state.

### mastra-ai/mastra

https://github.com/mastra-ai/mastra

TypeScript agent framework with a workflow engine that supports suspend and resume, plus workflow snapshots. Useful if the GUI later grows into a full agent UI.

## Cloudflare reference

- Durable execution with fibers: https://developers.cloudflare.com/agents/runtime/execution/durable-execution/
- `runFiber()` registers a task in SQLite, `stash()` checkpoints intermediate state, `onFiberRecovered()` fires after eviction.

## What to steal for Trollino

1. **Intent record first.** Write the task and its input to SQLite before calling the model.
2. **Explicit checkpoint per step.** classify -> validate -> store label -> mark done.
3. **Replay policy per tool.** Model calls can be retried; side effects need an idempotency key or must be marked interrupted.
4. **Restart limit.** Park a task after N crashes and show it in the GUI instead of looping forever.
5. **Single owner per SQLite file.** Use a PID/lock guard while the worker runs.
6. **Recovery visible.** On start, list recovered tasks and let the GUI replay them with a delay.
7. **Kill script.** SIGKILL the worker at a random step, restart, assert that no task is lost or duplicated.
8. **Traces.** One span per phase, plus events for checkpoint and replay.

## Demo script to reproduce

1. Start the worker on 100 tasks.
2. Let it finish 20 to 30.
3. `kill -9` the worker.
4. Restart it.
5. GUI shows the recovered tasks and continues from the last committed step.
6. Compare the final SQLite state with the input list: every task has exactly one label.
