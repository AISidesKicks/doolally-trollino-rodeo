import {
  addEvent,
  commitBatch,
  getBatchTasks,
  getExistingAttempts,
  getPendingBatches,
  getRun,
  markBatchStarted,
  markRunCompleted,
  markRunRunning,
  setRunStatus,
} from "./db.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function averageLatency(attempts, model) {
  const values = attempts.filter((attempt) => attempt.model === model).map((attempt) => attempt.latencyMs);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function runBatches(db, runId, providers, options = {}) {
  const {
    batchSize,
    pauseMs = 0,
    killAfterBatches = 0,
    maxBatches = 0,
    retries = null,
    quiet = false,
    kill = process.kill.bind(process),
    onBatch = null,
  } = options;

  const run = getRun(db, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status === "completed") return run;
  const maxRetries = Number.isInteger(retries) ? retries : (run.retries ?? 1);

  markRunRunning(db, runId);
  const pending = getPendingBatches(db, runId);
  let processed = 0;

  for (const batchIndex of pending) {
    if (maxBatches > 0 && processed >= maxBatches) break;

    const tasks = getBatchTasks(db, runId, batchIndex);
    if (tasks.length === 0) continue;
    markBatchStarted(db, runId, batchIndex);

    const existing = getExistingAttempts(
      db,
      runId,
      tasks.map((task) => task.position),
      run.models,
    );
    const attempts = [];

    for (const task of tasks) {
      for (const model of run.models) {
        const key = `${task.position}:${model}`;
        if (existing.has(key)) {
          attempts.push(existing.get(key));
          continue;
        }

        const provider = providers[model];
        if (!provider) throw new Error(`No provider for model ${model}`);
        const started = performance.now();
        let result = null;
        let lastError = null;
        let tries = 0;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          tries = attempt + 1;
          try {
            result = await provider.classify({
              id: task.datasetId,
              text: task.text,
              position: task.position,
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          }
        }

        const elapsed = performance.now() - started;
        if (result) {
          attempts.push({
            taskPosition: task.position,
            model,
            label: result.label,
            confidence: result.confidence ?? null,
            latencyMs: elapsed,
            raw: { ...(result.raw ?? {}), retries: tries - 1 },
          });
        } else {
          attempts.push({
            taskPosition: task.position,
            model,
            label: "ERROR",
            confidence: null,
            latencyMs: elapsed,
            raw: { retries: tries - 1 },
            error: String(lastError?.message ?? lastError ?? "provider failed"),
          });
        }
      }
    }

    const completed = commitBatch(db, runId, batchIndex, attempts, run.models.length);
    processed += 1;

    if (!quiet) {
      const latency = run.models
        .map((model) => {
          const mean = averageLatency(attempts, model);
          return `${model} ${mean === null ? "n/a" : `${mean.toFixed(0)}ms`}`;
        })
        .join(" | ");
      const errors = attempts.filter((attempt) => attempt.error).length;
      const retried = attempts.filter((attempt) => (attempt.raw?.retries ?? 0) > 0).length;
      console.log(
        `[${runId}] batch ${batchIndex + 1}/${Math.ceil(run.total_tasks / batchSize)} | ` +
          `${tasks.length} tasks | ${latency} | errors ${errors} | retries ${retried} | ` +
          `completed ${completed}/${run.total_tasks}`,
      );
    }

    if (onBatch) await onBatch({ batchIndex, attempts, completed });
    if (pauseMs > 0) await sleep(pauseMs);

    if (killAfterBatches > 0 && processed >= killAfterBatches) {
      setRunStatus(db, runId, "killed", `SIGKILL after batch ${batchIndex + 1} (demo)`);
      addEvent(db, runId, "trollino_kill", { batchIndex, processed });
      if (!quiet) console.log(`[${runId}] Trollino says: kill after batch ${batchIndex + 1}`);
      kill(process.pid, "SIGKILL");
      await sleep(1_000);
      break;
    }
  }

  const remaining = getPendingBatches(db, runId);
  if (remaining.length === 0) {
    markRunCompleted(db, runId);
    if (!quiet) console.log(`[${runId}] completed`);
  } else if (!quiet) {
    console.log(`[${runId}] stopped with ${remaining.length} batches pending`);
  }

  return getRun(db, runId);
}
