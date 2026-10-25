import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DB_PATH, DEFAULT_MODELS, MODEL_META } from "./config.js";

const STALE_MS = 12_000;

export function nowIso() {
  return new Date().toISOString();
}

function decodeRun(row) {
  if (!row) return null;
  return { ...row, models: JSON.parse(row.models) };
}

function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDb(file = DB_PATH) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      mode INTEGER NOT NULL,
      seed INTEGER NOT NULL,
      provider TEXT NOT NULL,
      models TEXT NOT NULL,
      batch_size INTEGER NOT NULL,
      pause_ms INTEGER NOT NULL,
      retries INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      total_tasks INTEGER NOT NULL,
      completed_tasks INTEGER NOT NULL DEFAULT 0,
      pid INTEGER,
      last_heartbeat_at TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      task_position INTEGER NOT NULL,
      batch_index INTEGER NOT NULL,
      dataset_id TEXT NOT NULL,
      text TEXT NOT NULL,
      expected_label TEXT NOT NULL,
      source TEXT,
      fold TEXT,
      PRIMARY KEY (run_id, task_position),
      UNIQUE (run_id, dataset_id)
    );

    CREATE TABLE IF NOT EXISTS attempts (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      task_position INTEGER NOT NULL,
      model TEXT NOT NULL,
      label TEXT NOT NULL,
      confidence REAL,
      latency_ms REAL NOT NULL,
      raw_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, task_position, model),
      FOREIGN KEY (run_id, task_position)
        REFERENCES tasks(run_id, task_position) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS batches (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      batch_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      committed_at TEXT,
      PRIMARY KEY (run_id, batch_index)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_run_batch ON tasks(run_id, batch_index);
    CREATE INDEX IF NOT EXISTS idx_attempts_run_model ON attempts(run_id, model);
    CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);
  `);

  const runColumns = db
    .prepare("PRAGMA table_info(runs)")
    .all()
    .map((row) => row.name);
  if (!runColumns.includes("retries")) {
    db.exec("ALTER TABLE runs ADD COLUMN retries INTEGER NOT NULL DEFAULT 1");
  }
}

export function createRun(db, config) {
  const {
    mode,
    seed = 42,
    provider = "mock",
    models = DEFAULT_MODELS,
    batchSize = 3,
    pauseMs = 0,
    retries = 1,
    rows,
  } = config;

  if (!Array.isArray(rows) || rows.length === 0) throw new Error("createRun needs rows");
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be >= 1");
  if (!Number.isInteger(retries) || retries < 0) throw new Error("retries must be >= 0");

  const id = `run-${randomUUID().slice(0, 8)}`;
  const createdAt = nowIso();
  const batchCount = Math.ceil(rows.length / batchSize);

  return withTransaction(db, () => {
    db.prepare(
      `INSERT INTO runs
        (id, mode, seed, provider, models, batch_size, pause_ms, retries, status,
         total_tasks, completed_tasks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
    ).run(
      id,
      mode,
      seed,
      provider,
      JSON.stringify(models),
      batchSize,
      pauseMs,
      retries,
      rows.length,
      createdAt,
    );

    const insertTask = db.prepare(
      `INSERT INTO tasks
        (run_id, task_position, batch_index, dataset_id, text, expected_label, source, fold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    rows.forEach((row, index) => {
      const position = index + 1;
      insertTask.run(
        id,
        position,
        Math.floor(index / batchSize),
        row.id,
        row.text,
        row.label,
        row.source ?? null,
        row.fold ?? null,
      );
    });

    const insertBatch = db.prepare(
      `INSERT INTO batches (run_id, batch_index, status) VALUES (?, ?, 'pending')`,
    );
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      insertBatch.run(id, batchIndex);
    }

    addEvent(db, id, "run_created", {
      mode,
      seed,
      provider,
      models,
      batchSize,
      pauseMs,
      retries,
      rows: rows.length,
    });

    return id;
  });
}

export function addEvent(db, runId, type, payload = null) {
  db.prepare(`INSERT INTO events (run_id, type, payload, created_at) VALUES (?, ?, ?, ?)`).run(
    runId,
    type,
    payload === null ? null : JSON.stringify(payload),
    nowIso(),
  );
}

export function getRun(db, id) {
  return decodeRun(db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id));
}

export function listRuns(db, limit = 20) {
  return db
    .prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`)
    .all(limit)
    .map(decodeRun);
}

export function markRunRunning(db, id, pid = process.pid) {
  db.prepare(
    `UPDATE runs
     SET status = 'running', pid = ?, started_at = COALESCE(started_at, ?),
         last_heartbeat_at = ?, finished_at = NULL, error = NULL
     WHERE id = ?`,
  ).run(pid, nowIso(), nowIso(), id);
  addEvent(db, id, "worker_started", { pid });
}

export function markRunCompleted(db, id) {
  db.prepare(
    `UPDATE runs
     SET status = 'completed', completed_tasks = total_tasks, pid = NULL,
         last_heartbeat_at = ?, finished_at = ?
     WHERE id = ?`,
  ).run(nowIso(), nowIso(), id);
  addEvent(db, id, "run_completed", null);
}

export function setRunStatus(db, id, status, error = null) {
  const now = nowIso();
  db.prepare(
    `UPDATE runs SET status = ?, error = ?, last_heartbeat_at = ?, finished_at = ? WHERE id = ?`,
  ).run(status, error, now, now, id);
  addEvent(db, id, `run_${status}`, error ? { error } : null);
}

export function heartbeat(db, id, pid = process.pid) {
  db.prepare(`UPDATE runs SET last_heartbeat_at = ?, pid = ? WHERE id = ?`).run(
    nowIso(),
    pid,
    id,
  );
}

export function getPendingBatches(db, runId) {
  return db
    .prepare(
      `SELECT batch_index FROM batches
       WHERE run_id = ? AND status != 'done'
       ORDER BY batch_index`,
    )
    .all(runId)
    .map((row) => row.batch_index);
}

export function markBatchStarted(db, runId, batchIndex) {
  db.prepare(
    `UPDATE batches SET started_at = ? WHERE run_id = ? AND batch_index = ? AND started_at IS NULL`,
  ).run(nowIso(), runId, batchIndex);
}

export function getBatchTasks(db, runId, batchIndex) {
  return db
    .prepare(
      `SELECT task_position, batch_index, dataset_id, text, expected_label, source, fold
       FROM tasks WHERE run_id = ? AND batch_index = ?
       ORDER BY task_position`,
    )
    .all(runId, batchIndex)
    .map((row) => ({
      position: row.task_position,
      batchIndex: row.batch_index,
      datasetId: row.dataset_id,
      text: row.text,
      expectedLabel: row.expected_label,
      source: row.source,
      fold: row.fold,
    }));
}

export function getExistingAttempts(db, runId, positions, models) {
  if (positions.length === 0 || models.length === 0) return new Map();
  const positionMarks = positions.map(() => "?").join(",");
  const modelMarks = models.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM attempts
       WHERE run_id = ? AND task_position IN (${positionMarks}) AND model IN (${modelMarks})`,
    )
    .all(runId, ...positions, ...models);

  return new Map(
    rows.map((row) => [
      `${row.task_position}:${row.model}`,
      {
        taskPosition: row.task_position,
        model: row.model,
        label: row.label,
        confidence: row.confidence,
        latencyMs: row.latency_ms,
        raw: row.raw_json ? JSON.parse(row.raw_json) : null,
        error: row.error,
      },
    ]),
  );
}

export function countCompletedTasks(db, runId, modelCount) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks t
       WHERE t.run_id = ?
         AND (SELECT COUNT(*) FROM attempts a
              WHERE a.run_id = t.run_id AND a.task_position = t.task_position) >= ?`,
    )
    .get(runId, modelCount).n;
}

export function commitBatch(db, runId, batchIndex, attempts, modelCount) {
  return withTransaction(db, () => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO attempts
        (run_id, task_position, model, label, confidence, latency_ms, raw_json, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const attempt of attempts) {
      insert.run(
        runId,
        attempt.taskPosition,
        attempt.model,
        attempt.label,
        attempt.confidence ?? null,
        attempt.latencyMs,
        attempt.raw === undefined || attempt.raw === null ? null : JSON.stringify(attempt.raw),
        attempt.error ?? null,
        nowIso(),
      );
    }

    db.prepare(
      `UPDATE batches SET status = 'done', committed_at = ? WHERE run_id = ? AND batch_index = ?`,
    ).run(nowIso(), runId, batchIndex);

    const completed = countCompletedTasks(db, runId, modelCount);
    db.prepare(
      `UPDATE runs SET completed_tasks = ?, last_heartbeat_at = ? WHERE id = ?`,
    ).run(completed, nowIso(), runId);

    addEvent(db, runId, "batch_committed", {
      batchIndex,
      attempts: attempts.length,
      completed,
    });

    return completed;
  });
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

export function getRunSummary(db, id, recentBatches = 3) {
  const run = getRun(db, id);
  if (!run) return null;

  const statsRows = db
    .prepare(
      `SELECT a.model,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.label = t.expected_label THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN a.error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
              AVG(a.latency_ms) AS mean_latency,
              MIN(a.latency_ms) AS min_latency,
              MAX(a.latency_ms) AS max_latency
       FROM attempts a
       JOIN tasks t ON t.run_id = a.run_id AND t.task_position = a.task_position
       WHERE a.run_id = ?
       GROUP BY a.model`,
    )
    .all(id);

  const latencyRows = db
    .prepare(
      `SELECT model, latency_ms FROM attempts WHERE run_id = ? ORDER BY model, latency_ms`,
    )
    .all(id);

  const latencies = new Map();
  for (const row of latencyRows) {
    if (!latencies.has(row.model)) latencies.set(row.model, []);
    latencies.get(row.model).push(row.latency_ms);
  }

  const modelStats = {};
  for (const model of run.models) {
    const row = statsRows.find((entry) => entry.model === model);
    const values = latencies.get(model) ?? [];
    modelStats[model] = {
      model,
      name: MODEL_META[model]?.name ?? model,
      short: MODEL_META[model]?.short ?? model,
      color: MODEL_META[model]?.color ?? "#94a3b8",
      attempts: row?.attempts ?? 0,
      correct: row?.correct ?? 0,
      errors: row?.errors ?? 0,
      accuracy: row?.attempts ? row.correct / row.attempts : null,
      meanLatency: row?.mean_latency ?? null,
      medianLatency: percentile(values, 0.5),
      p95Latency: percentile(values, 0.95),
      minLatency: row?.min_latency ?? null,
      maxLatency: row?.max_latency ?? null,
    };
  }

  const disagreements = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT task_position FROM attempts
         WHERE run_id = ? GROUP BY task_position HAVING COUNT(DISTINCT label) > 1
       )`,
    )
    .get(id).n;

  const labelRows = db
    .prepare(
      `SELECT model, label, COUNT(*) AS n FROM attempts
       WHERE run_id = ? GROUP BY model, label ORDER BY model, n DESC`,
    )
    .all(id);
  const labelCounts = {};
  for (const row of labelRows) {
    if (!labelCounts[row.model]) labelCounts[row.model] = [];
    labelCounts[row.model].push({ label: row.label, count: row.n });
  }

  const batches = db
    .prepare(
      `SELECT batch_index, status, started_at, committed_at FROM batches
       WHERE run_id = ? ORDER BY batch_index`,
    )
    .all(id)
    .map((row) => ({
      batchIndex: row.batch_index,
      status: row.status,
      startedAt: row.started_at,
      committedAt: row.committed_at,
    }));

  const maxBatchIndex = Math.min(
    batches.length - 1,
    Math.floor(run.completed_tasks / run.batch_size),
  );
  const firstRecentBatch = Math.max(0, maxBatchIndex - recentBatches + 1);

  const recentRows = db
    .prepare(
      `SELECT t.task_position, t.batch_index, t.dataset_id, t.text, t.expected_label, t.source, t.fold,
              a.model, a.label, a.confidence, a.latency_ms, a.error, a.raw_json
       FROM tasks t
       LEFT JOIN attempts a
         ON a.run_id = t.run_id AND a.task_position = t.task_position
       WHERE t.run_id = ? AND t.batch_index >= ? AND t.batch_index <= ?
       ORDER BY t.task_position, a.model`,
    )
    .all(id, firstRecentBatch, maxBatchIndex);

  const recentTasks = new Map();
  for (const row of recentRows) {
    if (!recentTasks.has(row.task_position)) {
      recentTasks.set(row.task_position, {
        position: row.task_position,
        batchIndex: row.batch_index,
        datasetId: row.dataset_id,
        text: row.text,
        expectedLabel: row.expected_label,
        source: row.source,
        fold: row.fold,
        predictions: {},
      });
    }
    if (row.model) {
      let retries = 0;
      if (row.raw_json) {
        try {
          retries = JSON.parse(row.raw_json).retries ?? 0;
        } catch {
          retries = 0;
        }
      }
      recentTasks.get(row.task_position).predictions[row.model] = {
        label: row.label,
        confidence: row.confidence,
        latencyMs: row.latency_ms,
        error: row.error,
        retries,
      };
    }
  }

  const events = db
    .prepare(
      `SELECT type, payload, created_at FROM events
       WHERE run_id = ? ORDER BY id DESC LIMIT 12`,
    )
    .all(id)
    .map((row) => ({
      type: row.type,
      payload: row.payload ? JSON.parse(row.payload) : null,
      createdAt: row.created_at,
    }));

  const startedMs = run.started_at ? Date.parse(run.started_at) : null;
  const ended =
    run.status === "running" || run.status === "pending"
      ? Date.now()
      : run.finished_at
        ? Date.parse(run.finished_at)
        : run.last_heartbeat_at
          ? Date.parse(run.last_heartbeat_at)
          : Date.now();
  const elapsedMs = startedMs ? Math.max(0, ended - startedMs) : 0;
  const activeRow = db
    .prepare(
      `SELECT SUM((julianday(committed_at) - julianday(started_at)) * 86400000.0) AS ms
       FROM batches
       WHERE run_id = ? AND status = 'done'
         AND started_at IS NOT NULL AND committed_at IS NOT NULL`,
    )
    .get(id);
  const activeMs = Math.max(0, activeRow?.ms ?? 0);
  const heartbeatMs = run.last_heartbeat_at ? Date.parse(run.last_heartbeat_at) : null;

  return {
    run,
    progress: run.total_tasks ? run.completed_tasks / run.total_tasks : 0,
    elapsedMs,
    activeMs,
    throughputPerSecond: activeMs > 0 ? run.completed_tasks / (activeMs / 1000) : 0,
    stale: run.status === "running" && (!heartbeatMs || Date.now() - heartbeatMs > STALE_MS),
    modelStats,
    disagreements,
    labelCounts,
    batches,
    recentTasks: [...recentTasks.values()].slice(-recentBatches * run.batch_size),
    events,
  };
}
