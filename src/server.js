#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import {
  DATASET_PATH,
  DB_PATH,
  DEFAULT_MODELS,
  LABELS,
  MODEL_META,
  MODES,
  ROOT,
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
import { selectTasks } from "./sample.js";

const PORT = Number(process.env.PORT || 3030);
const HOST = process.env.HOST || "127.0.0.1";
const GUI_DIR = path.join(ROOT, "gui");
const LOG_DIR = process.env.DLLY_LOG_DIR || path.join(ROOT, "scratch", "logs");
const WORKER = path.join(ROOT, "src", "worker.js");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const db = openDb();
const children = new Map();

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

for (const run of listRuns(db, 100)) {
  if (run.status === "running" && !isAlive(run.pid)) {
    setRunStatus(db, run.id, "interrupted", "worker heartbeat lost");
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    throw new HttpError(400, "Bad path");
  }
  const file = path.resolve(GUI_DIR, `.${decoded}`);
  if (!file.startsWith(`${GUI_DIR}${path.sep}`)) throw new HttpError(403, "Forbidden");

  let body;
  try {
    body = readFileSync(file);
  } catch {
    throw new HttpError(404, `Not found: ${requested}`);
  }
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

function logPath(runId) {
  return path.join(LOG_DIR, `run-${runId}.log`);
}

function spawnWorker(runId) {
  const existing = children.get(runId);
  if (existing && existing.exitCode === null) return existing.pid;

  const run = getRun(db, runId);
  if (!run) throw new HttpError(404, "Run not found");
  if (run.status === "completed") throw new HttpError(409, "Run is already completed");
  if (run.status === "running" && isAlive(run.pid)) return run.pid;

  mkdirSync(LOG_DIR, { recursive: true });
  const fd = openSync(logPath(runId), "a");
  const child = spawn(process.execPath, [WORKER, "resume", "--run-id", runId], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  children.set(runId, child);

  child.on("exit", () => {
    closeSync(fd);
    children.delete(runId);
  });
  child.on("error", (error) => {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    children.delete(runId);
    console.error(`worker ${runId} failed to start: ${error.message}`);
  });

  return child.pid;
}

function killRun(runId) {
  const run = getRun(db, runId);
  if (!run) throw new HttpError(404, "Run not found");
  if (run.status === "completed") throw new HttpError(409, "Run is already completed");
  if (run.status !== "running" && run.status !== "pending") {
    throw new HttpError(409, `Run is ${run.status}, not running`);
  }

  const child = children.get(runId);
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
  } else if (isAlive(run.pid)) {
    try {
      process.kill(run.pid, "SIGKILL");
    } catch {
      // process already gone
    }
  }
  setRunStatus(db, runId, "killed", "killed from GUI");
  return { runId, status: "killed" };
}

function createApiRun(body) {
  const mode = Number(body.mode ?? 100);
  if (!MODES.includes(mode)) {
    throw new HttpError(400, `mode must be one of ${MODES.join(", ")}`);
  }
  const provider = body.provider ?? "mock";
  if (!["mock", "llama"].includes(provider)) {
    throw new HttpError(400, "provider must be mock or llama");
  }
  const seed = Number(body.seed ?? 42);
  if (!Number.isInteger(seed)) throw new HttpError(400, "seed must be an integer");

  const batchSize = Number(body.batchSize ?? 3);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 12) {
    throw new HttpError(400, "batchSize must be an integer from 1 to 12");
  }
  const pauseMs = Number(body.pauseMs ?? 0);
  if (!Number.isFinite(pauseMs) || pauseMs < 0 || pauseMs > 60_000) {
    throw new HttpError(400, "pauseMs must be from 0 to 60000");
  }
  const retries = Number(body.retries ?? 1);
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) {
    throw new HttpError(400, "retries must be an integer from 0 to 3");
  }

  const models = body.models ?? DEFAULT_MODELS;
  if (!Array.isArray(models) || models.length === 0) {
    throw new HttpError(400, "models must be a non-empty array");
  }
  for (const model of models) {
    if (!MODEL_META[model]) throw new HttpError(400, `Unknown model: ${model}`);
  }

  const rows = loadDataset(DATASET_PATH);
  const tasks = selectTasks(rows, {
    mode,
    seed,
    excludeHoldout: Boolean(body.excludeHoldout),
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
  const pid = spawnWorker(runId);
  return { runId, tasks: tasks.length, pid };
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, db: DB_PATH, dataset: DATASET_PATH });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, {
      labels: LABELS,
      modes: MODES,
      models: MODEL_META,
      dataset: DATASET_PATH,
      db: DB_PATH,
      defaults: { batchSize: 3, pauseMs: 2500, retries: 1, models: DEFAULT_MODELS },
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/runs") {
    sendJson(res, 200, { runs: listRuns(db, 40) });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/runs") {
    const body = await readJson(req);
    sendJson(res, 201, createApiRun(body));
    return true;
  }

  const match = pathname.match(/^\/api\/runs\/(run-[a-z0-9-]+)(?:\/(resume|kill|log))?$/);
  if (!match) return false;

  const [, runId, action] = match;

  if (req.method === "GET" && !action) {
    const summary = getRunSummary(db, runId);
    if (!summary) throw new HttpError(404, "Run not found");
    sendJson(res, 200, summary);
    return true;
  }

  if (req.method === "GET" && action === "log") {
    const run = getRun(db, runId);
    if (!run) throw new HttpError(404, "Run not found");
    let body = "";
    try {
      body = readFileSync(logPath(runId), "utf8");
    } catch {
      body = "No log yet.";
    }
    sendText(res, 200, body.split("\n").slice(-120).join("\n"));
    return true;
  }

  if (req.method === "POST" && action === "resume") {
    const pid = spawnWorker(runId);
    sendJson(res, 200, { runId, pid });
    return true;
  }

  if (req.method === "POST" && action === "kill") {
    sendJson(res, 200, killRun(runId));
    return true;
  }

  throw new HttpError(405, "Method not allowed");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url.pathname);
      if (!handled) sendJson(res, 404, { error: "Unknown API route" });
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    sendJson(res, status, { error: error.message ?? "Internal error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DLLY lab GUI: http://${HOST}:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
