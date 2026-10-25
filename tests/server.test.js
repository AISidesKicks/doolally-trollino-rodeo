import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { ROOT } from "../src/config.js";

const dir = mkdtempSync(path.join(tmpdir(), "dlly-api-test-"));
const port = 13000 + (process.pid % 2000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DLLY_DB_PATH: path.join(dir, "lab.db"),
    DLLY_LOG_DIR: path.join(dir, "logs"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(200);
  }
  throw new Error(`server did not start: ${stderr}`);
}

after(() => {
  child.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
});

test("api creates, runs and reports a mock batch", async () => {
  await waitForHealth();

  const response = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: 100,
      provider: "mock",
      batchSize: 3,
      pauseMs: 0,
      retries: 0,
    }),
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.tasks, 100);
  assert.match(created.runId, /^run-/);

  let summary = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await fetch(`${base}/api/runs/${created.runId}`);
    summary = await status.json();
    if (summary.run.status === "completed") break;
    await sleep(500);
  }

  assert.equal(summary.run.status, "completed");
  assert.equal(summary.run.completed_tasks, 100);
  assert.equal(summary.modelStats.lfm.attempts, 100);
  assert.equal(summary.modelStats.d1.attempts, 100);
  assert.equal(summary.batches.length, 34);
  assert.equal(summary.batches.every((batch) => batch.status === "done"), true);
});
