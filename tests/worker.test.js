import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRun,
  getRun,
  getRunSummary,
  openDb,
} from "../src/db.js";
import { createProviders } from "../src/providers/index.js";
import { runBatches } from "../src/runner.js";

const LABELS = [
  "Politics & Elections",
  "Medical & Health",
  "Legal & Regulatory",
  "Financial & Crypto",
];

function rows(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    id: `test-${index + 1}`,
    text: `Test text ${index + 1} about a doctor, a court or a bank.`,
    label: LABELS[index % LABELS.length],
    source: "test",
    fold: "fold-0",
  }));
}

test("mock run commits every task and both models", async () => {
  const db = openDb(":memory:");
  const runId = createRun(db, {
    mode: 100,
    seed: 42,
    provider: "mock",
    models: ["lfm", "d1"],
    batchSize: 2,
    retries: 1,
    rows: rows(6),
  });
  const providers = createProviders({ kind: "mock", models: ["lfm", "d1"], mockDelay: false });

  await runBatches(db, runId, providers, { batchSize: 2, retries: 1, quiet: true });

  const run = getRun(db, runId);
  assert.equal(run.status, "completed");
  assert.equal(run.completed_tasks, 6);

  const summary = getRunSummary(db, runId);
  assert.equal(summary.modelStats.lfm.attempts, 6);
  assert.equal(summary.modelStats.d1.attempts, 6);
  assert.equal(summary.modelStats.lfm.errors, 0);
  assert.equal(summary.disagreements >= 0, true);
  assert.equal(summary.recentTasks.length, 6);

  db.close();
});

test("kill at a batch boundary resumes without duplicate attempts", async () => {
  const db = openDb(":memory:");
  const runId = createRun(db, {
    mode: 100,
    seed: 42,
    provider: "mock",
    models: ["lfm", "d1"],
    batchSize: 2,
    retries: 1,
    rows: rows(6),
  });
  const providers = createProviders({ kind: "mock", models: ["lfm", "d1"], mockDelay: false });

  await runBatches(db, runId, providers, {
    batchSize: 2,
    retries: 1,
    killAfterBatches: 1,
    kill: () => {},
    quiet: true,
  });

  let run = getRun(db, runId);
  assert.equal(run.status, "killed");
  assert.equal(run.completed_tasks, 2);

  await runBatches(db, runId, providers, { batchSize: 2, retries: 1, quiet: true });
  run = getRun(db, runId);
  assert.equal(run.status, "completed");
  assert.equal(run.completed_tasks, 6);

  const summary = getRunSummary(db, runId);
  assert.equal(summary.modelStats.lfm.attempts, 6);
  assert.equal(summary.modelStats.d1.attempts, 6);
  assert.equal(summary.batches.every((batch) => batch.status === "done"), true);

  db.close();
});

test("one retry turns a failed label into a recorded success", async () => {
  const db = openDb(":memory:");
  const runId = createRun(db, {
    mode: 100,
    seed: 42,
    provider: "mock",
    models: ["flaky"],
    batchSize: 1,
    retries: 1,
    rows: rows(1),
  });

  let calls = 0;
  const providers = {
    flaky: {
      key: "flaky",
      async classify() {
        calls += 1;
        if (calls === 1) throw new Error("first attempt failed");
        return {
          label: "Medical & Health",
          confidence: 0.9,
          latencyMs: 5,
          raw: { provider: "test" },
        };
      },
    },
  };

  await runBatches(db, runId, providers, { batchSize: 1, retries: 1, quiet: true });

  const summary = getRunSummary(db, runId);
  const prediction = summary.recentTasks[0].predictions.flaky;
  assert.equal(calls, 2);
  assert.equal(prediction.label, "Medical & Health");
  assert.equal(prediction.error, null);
  assert.equal(prediction.retries, 1);
  assert.equal(summary.modelStats.flaky.attempts, 1);

  db.close();
});
