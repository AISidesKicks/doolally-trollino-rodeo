#!/usr/bin/env node
import { parseArgs } from "node:util";

import {
  DEFAULT_MODELS,
  MODEL_META,
  MODES,
  DATASET_PATH,
  DB_PATH,
} from "./config.js";
import {
  createRun,
  getRun,
  getRunSummary,
  listRuns,
  openDb,
  setRunStatus,
} from "./db.js";
import { loadDataset } from "./dataset.js";
import { createProviders } from "./providers/index.js";
import { runBatches } from "./runner.js";
import { selectTasks } from "./sample.js";
import { createTracer } from "./tracing.js";

function usage() {
  console.log(`Usage:
  node src/worker.js run --mode 100 --provider mock
  node src/worker.js resume --run-id run-xxxxxxxx
  node src/worker.js status --run-id run-xxxxxxxx
  node src/worker.js list

Options:
  --mode <100|1000|10000>       play mode, default 100
  --seed <n>                    sample seed, default 42
  --provider <mock|llama>       default mock
  --models <lfm,d1>             default lfm,d1
  --batch-size <n>              default 3
  --pause-ms <n>                delay between batches, default 0
  --kill-after-batches <n>      demo SIGKILL after n committed batches
  --retries <n>                 retries per failed label, default 1
  --max-batches <n>             stop early, for tests
  --fold <fold-0..fold-7|holdout>
  --exclude-holdout
  --lfm-url <url>               default ${MODEL_META.lfm.url}
  --d1-url <url>                default ${MODEL_META.d1.url}
  --lfm-ft-url <url>            default ${MODEL_META["lfm-ft"].url}
  --phoenix-url <url>           OTLP HTTP endpoint, default $PHOENIX_URL
  --quiet`);
}

function intOption(values, name, fallback) {
  const raw = values[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return value;
}

function modelList(values) {
  const models = (values.models ?? DEFAULT_MODELS.join(","))
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  for (const model of models) {
    if (!MODEL_META[model]) throw new Error(`Unknown model: ${model}`);
  }
  if (models.length === 0) throw new Error("At least one model is required");
  return models;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: "string", default: "100" },
      seed: { type: "string", default: "42" },
      provider: { type: "string", default: "mock" },
      models: { type: "string" },
      "batch-size": { type: "string" },
      "pause-ms": { type: "string" },
      "kill-after-batches": { type: "string" },
      retries: { type: "string" },
      "max-batches": { type: "string" },
      "run-id": { type: "string" },
      fold: { type: "string" },
      "exclude-holdout": { type: "boolean", default: false },
      "lfm-url": { type: "string" },
      "d1-url": { type: "string" },
      "lfm-ft-url": { type: "string" },
      "phoenix-url": { type: "string" },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    usage();
    return;
  }

  const command = positionals[0] ?? "run";
  const db = openDb();
  const tracer = createTracer({
    endpoint: values["phoenix-url"] ?? process.env.PHOENIX_URL,
  });

  try {
    if (command === "list") {
      console.log(JSON.stringify(listRuns(db, 50), null, 2));
      return;
    }

    if (command === "status") {
      if (!values["run-id"]) throw new Error("status needs --run-id");
      const summary = getRunSummary(db, values["run-id"]);
      if (!summary) throw new Error(`Run not found: ${values["run-id"]}`);
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (command === "resume") {
      if (!values["run-id"]) throw new Error("resume needs --run-id");
      const run = getRun(db, values["run-id"]);
      if (!run) throw new Error(`Run not found: ${values["run-id"]}`);
      if (run.status === "completed") {
        console.log(`Run ${run.id} is already completed`);
        return;
      }

      const batchSize = intOption(values, "batch-size", run.batch_size);
      const pauseMs = intOption(values, "pause-ms", run.pause_ms);
      const killAfterBatches = intOption(values, "kill-after-batches", 0);
      const maxBatches = intOption(values, "max-batches", 0);
      const retries = intOption(values, "retries", run.retries ?? 1);
      const providers = createProviders({
        kind: run.provider,
        models: run.models,
        lfmUrl: values["lfm-url"] ?? MODEL_META.lfm.url,
        d1Url: values["d1-url"] ?? MODEL_META.d1.url,
        lfmFtUrl: values["lfm-ft-url"] ?? MODEL_META["lfm-ft"].url,
      });

      console.log(
        JSON.stringify({
          runId: run.id,
          mode: run.mode,
          tasks: run.total_tasks,
          completed: run.completed_tasks,
          batchSize,
          pauseMs,
          provider: run.provider,
          models: run.models,
        }),
      );
      await runBatches(db, run.id, providers, {
        batchSize,
        pauseMs,
        killAfterBatches,
        maxBatches,
        retries,
        quiet: values.quiet,
        tracer,
      });
      return;
    }

    if (command !== "run") throw new Error(`Unknown command: ${command}`);

    const mode = intOption(values, "mode", 100);
    if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
    const seed = intOption(values, "seed", 42);
    const provider = values.provider;
    if (!["mock", "llama"].includes(provider)) {
      throw new Error("--provider must be mock or llama");
    }
    const models = modelList(values);
    const batchSize = intOption(values, "batch-size", 3);
    const pauseMs = intOption(values, "pause-ms", 0);
    const killAfterBatches = intOption(values, "kill-after-batches", 0);
    const maxBatches = intOption(values, "max-batches", 0);
    const retries = intOption(values, "retries", 1);

    const rows = loadDataset(DATASET_PATH);
    const tasks = selectTasks(rows, {
      mode,
      seed,
      fold: values.fold ?? null,
      excludeHoldout: values["exclude-holdout"],
    });
    const runId = createRun(db, {
      mode,
      seed,
      provider,
      models,
      batchSize,
      pauseMs,
      retries,
      rows: tasks,
    });

    console.log(
      JSON.stringify({
        runId,
        mode,
        seed,
        provider,
        models,
        tasks: tasks.length,
        batchSize,
        retries,
      }),
    );

    const providers = createProviders({
      kind: provider,
      models,
      lfmUrl: values["lfm-url"] ?? MODEL_META.lfm.url,
      d1Url: values["d1-url"] ?? MODEL_META.d1.url,
      lfmFtUrl: values["lfm-ft-url"] ?? MODEL_META["lfm-ft"].url,
    });

    await runBatches(db, runId, providers, {
      batchSize,
      pauseMs,
      killAfterBatches,
      maxBatches,
      retries,
      quiet: values.quiet,
      tracer,
    });
  } catch (error) {
    console.error(`worker error: ${error.message}`);
    if (values["run-id"]) {
      try {
        setRunStatus(db, values["run-id"], "failed", error.message);
      } catch {
        // best effort
      }
    }
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
