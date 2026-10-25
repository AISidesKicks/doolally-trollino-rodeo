const state = {
  config: null,
  runs: [],
  runId: null,
  summary: null,
  timer: null,
  logText: "",
  busy: false,
};

const MODEL_NAMES = { lfm: "Doolally", d1: "Trollino" };
const MODEL_IMAGES = {
  lfm: "assets/doolally-moderator.webp",
  d1: "assets/trollino-author.webp",
};

const STATUS_META = {
  pending: "queued",
  running: "running",
  completed: "completed",
  killed: "killed by Trollino",
  interrupted: "interrupted",
  failed: "failed",
};

const $ = (selector, root = document) => root.querySelector(selector);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fmtNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function fmtMs(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function fmtPercent(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function truncate(text, limit = 260) {
  if (typeof text !== "string") return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit).trim()}...` : clean;
}

function setConn(tone, text) {
  const pill = $("#conn-pill");
  pill.dataset.tone = tone;
  $("#conn-text").textContent = text;
}

function setFormNote(message, tone = "muted") {
  const note = $("#form-note");
  note.textContent = message;
  note.dataset.tone = tone;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(body.slice(0, 240) || `HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(data?.error ?? `HTTP ${response.status}`);
  }
  return data;
}

async function apiText(path) {
  const response = await fetch(path);
  const body = await response.text();
  if (!response.ok) throw new Error(body.slice(0, 240) || `HTTP ${response.status}`);
  return body;
}

function statusOf(summary) {
  return summary?.run?.status ?? "pending";
}

function isActive(status) {
  return status === "running" || status === "pending";
}

function updateUrl(runId) {
  const url = new URL(window.location.href);
  if (runId) url.searchParams.set("run", runId);
  else url.searchParams.delete("run");
  window.history.replaceState(null, "", url);
}

function renderStatus() {
  const summary = state.summary;
  const status = statusOf(summary);
  const pill = $("#status-pill");
  pill.dataset.status = status;
  pill.textContent = STATUS_META[status] ?? status;

  $("#run-id").textContent = state.runId ?? "no run yet";
  const run = summary?.run;
  $("#active-run-chip").textContent = state.runId
    ? `${state.runId} · ${run?.provider ?? "-"} · ${run?.mode ? fmtNumber(run.mode) : "-"} tasks`
    : "no run selected";
}

function renderProgress() {
  const summary = state.summary;
  const run = summary?.run;
  const status = statusOf(summary);
  const completed = run?.completed_tasks ?? 0;
  const total = run?.total_tasks ?? 0;
  const progress = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
  const batches = summary?.batches ?? [];
  const doneBatches = batches.filter((batch) => batch.status === "done").length;

  $("#progress").dataset.running = status === "running" ? "true" : "false";
  $("#progress").setAttribute("aria-valuenow", String(Math.round(progress)));
  $("#progress-fill").style.width = `${progress}%`;
  $("#progress-text").textContent = `${fmtNumber(completed)} / ${fmtNumber(total)} tasks`;
  $("#batch-text").textContent = `${fmtNumber(doneBatches)} of ${fmtNumber(batches.length)} batches committed`;
  $("#elapsed-text").textContent = `${fmtElapsed(summary?.activeMs ?? summary?.elapsedMs ?? 0)} active`;
  $("#rate-text").textContent = `${(summary?.throughputPerSecond ?? 0).toFixed(2)} tasks/s`;
}

function modelStats(key) {
  return state.summary?.modelStats?.[key] ?? null;
}

function renderModelCard(key) {
  const stats = modelStats(key);
  const status = statusOf(state.summary);
  const attempts = stats?.attempts ?? 0;
  const errors = stats?.errors ?? 0;

  const statusNode = $(`#${key}-status`);
  if (!state.summary) {
    statusNode.textContent = "idle";
    statusNode.dataset.tone = "muted";
  } else if (attempts === 0 && isActive(status)) {
    statusNode.textContent = "warming up";
    statusNode.dataset.tone = "muted";
  } else if (errors > 0) {
    statusNode.textContent = `${errors} errors`;
    statusNode.dataset.tone = "bad";
  } else if (isActive(status)) {
    statusNode.textContent = "reading";
    statusNode.dataset.tone = "good";
  } else if (status === "completed") {
    statusNode.textContent = "done";
    statusNode.dataset.tone = "good";
  } else {
    statusNode.textContent = "paused";
    statusNode.dataset.tone = "bad";
  }

  $(`#${key}-accuracy`).textContent = attempts > 0 ? fmtPercent(stats.accuracy, 1) : "-";
  $(`#${key}-correct`).textContent = attempts > 0 ? `${stats.correct}/${attempts}` : "-";
  $(`#${key}-median`).textContent = attempts > 0 ? fmtMs(stats.medianLatency) : "-";
  $(`#${key}-mean`).textContent = attempts > 0 ? fmtMs(stats.meanLatency) : "-";
  $(`#${key}-p95`).textContent = attempts > 0 ? fmtMs(stats.p95Latency) : "-";
  $(`#${key}-errors`).textContent = attempts > 0 ? fmtNumber(errors) : "-";

  const verdict = $(`#${key}-verdict`);
  if (attempts === 0) {
    verdict.textContent = isActive(status)
      ? "Reading the first batch. Give the troll a second."
      : "Waiting for the first batch.";
  } else if (key === "lfm") {
    verdict.textContent =
      errors > 0
        ? `${stats.correct} correct. ${errors} texts broke the banhammer.`
        : `${stats.correct} of ${attempts} correct. The moderator has spoken.`;
  } else {
    verdict.textContent =
      errors > 0
        ? `${stats.correct} correct. ${errors} baits were too spicy.`
        : `${stats.correct} of ${attempts} correct. No second thoughts, ever.`;
  }
}

function renderDuel() {
  const summary = state.summary;
  const lfm = modelStats("lfm");
  const d1 = modelStats("d1");
  const status = statusOf(summary);
  const attempts = lfm?.attempts ?? 0;

  $("#disagreements").textContent = summary ? fmtNumber(summary.disagreements) : "-";
  $("#tasks-done").textContent = summary ? fmtNumber(summary.run.completed_tasks) : "-";
  $("#batches-done").textContent = summary
    ? `${fmtNumber(summary.batches.filter((batch) => batch.status === "done").length)}/${fmtNumber(summary.batches.length)}`
    : "-";
  $("#total-errors").textContent = summary
    ? fmtNumber((lfm?.errors ?? 0) + (d1?.errors ?? 0))
    : "-";

  const score = $("#duel-score");
  const copy = $("#duel-copy");

  if (!summary || attempts === 0 || !lfm || !d1) {
    score.textContent = "-";
    copy.textContent = "Start a run and the trolls will pick a fight over every text.";
    return;
  }

  const lfmMedian = lfm.medianLatency;
  const d1Median = d1.medianLatency;
  if (!lfmMedian || !d1Median) {
    score.textContent = "Too close to call";
    copy.textContent = "One troll has no usable timing yet.";
    return;
  }

  const trollinoFaster = d1Median <= lfmMedian;
  const fast = trollinoFaster ? d1 : lfm;
  const slow = trollinoFaster ? lfm : d1;
  const speedup = slow.medianLatency > 0 ? Math.round((1 - fast.medianLatency / slow.medianLatency) * 100) : 0;
  const fastName = MODEL_NAMES[fast.model];
  const slowName = MODEL_NAMES[slow.model];

  score.textContent = `${fastName} ${speedup}% faster`;
  const accuracyLine =
    fast.accuracy === slow.accuracy
      ? "Accuracy is dead even."
      : `${MODEL_NAMES[fast.accuracy > slow.accuracy ? fast.model : slow.model]} lands more correct bans.`;
  const tail = isActive(status) ? "The next batch is already on the desk." : "Final call from the cave.";
  copy.textContent = `${fastName} wins the clock at ${fmtMs(fast.medianLatency)} median. ${slowName} takes ${fmtMs(slow.medianLatency)}. ${accuracyLine} ${tail}`;
}

function predictionRow(task, modelKey) {
  const prediction = task.predictions?.[modelKey];
  const name = MODEL_NAMES[modelKey];
  const base = el(
    "div",
    { class: "pred", dataset: { model: modelKey } },
    el("img", { src: MODEL_IMAGES[modelKey], alt: "", width: "24", height: "24" }),
    el("strong", { text: name }),
  );

  if (!prediction) {
    base.dataset.missing = "true";
    base.append(el("span", { class: "pred-label", text: "waiting for this batch..." }));
    return base;
  }

  const correct = prediction.label === task.expectedLabel;
  base.dataset.correct = String(correct);
  const label = prediction.error ? "error" : prediction.label;
  const meta = prediction.error
    ? "failed"
    : `${prediction.confidence === null || prediction.confidence === undefined ? "-" : fmtPercent(prediction.confidence)} · ${fmtMs(prediction.latencyMs)}${prediction.retries > 0 ? ` · ${prediction.retries} retry` : ""}`;

  base.append(
    el("span", { class: "pred-label", text: label, title: prediction.error ?? label }),
    el("span", { class: "pred-meta", text: meta }),
  );
  return base;
}

function taskCard(task) {
  return el(
    "article",
    { class: "task" },
    el(
      "div",
      { class: "task-side" },
      el("span", { class: "task-pos", text: `#${task.position}` }),
      el("span", { class: "task-batch", text: `batch ${task.batchIndex + 1}` }),
      el("span", { class: "label-chip", dataset: { label: task.expectedLabel }, text: task.expectedLabel }),
      el("span", { class: "task-batch", text: task.fold ?? "" }),
    ),
    el(
      "div",
      { class: "task-body" },
      el("p", { class: "task-text", text: truncate(task.text) }),
      el("div", { class: "pred-row" }, predictionRow(task, "lfm"), predictionRow(task, "d1")),
    ),
  );
}

function renderTasks() {
  const list = $("#task-list");
  list.replaceChildren();
  const tasks = state.summary?.recentTasks ?? [];
  if (tasks.length === 0) {
    list.append(el("p", { class: "empty", text: "No tasks yet. Send the trolls to start the queue." }));
    return;
  }
  const ordered = [...tasks].sort((a, b) => {
    if (b.batchIndex !== a.batchIndex) return b.batchIndex - a.batchIndex;
    return a.position - b.position;
  });
  for (const task of ordered) list.append(taskCard(task));
}

function renderRecovery() {
  const banner = $("#recovery-banner");
  const summary = state.summary;
  const status = statusOf(summary);
  const recoverable = status === "killed" || status === "interrupted" || status === "failed";
  banner.hidden = !recoverable;
  if (!recoverable) return;

  const run = summary.run;
  const batches = summary.batches.filter((batch) => batch.status === "done");
  const lastBatch = batches.length > 0 ? Math.max(...batches.map((batch) => batch.batchIndex)) + 1 : 0;
  const pending = run.total_tasks - run.completed_tasks;

  const title =
    status === "killed"
      ? "Trollino pulled the plug."
      : status === "failed"
        ? "The worker tripped over a bait bucket."
        : "The worker vanished mid-bite.";
  $("#recovery-title").textContent = title;
  $("#recovery-copy").textContent =
    `${fmtNumber(run.completed_tasks)} tasks are safe in SQLite. ` +
    `${fmtNumber(pending)} are still pending. ` +
    `Last durable batch: ${fmtNumber(lastBatch)} of ${fmtNumber(summary.batches.length)}. ` +
    "Resume and no task is scored twice.";
}

function renderQuote() {
  const quote = $("#troll-quote p");
  const summary = state.summary;
  if (!summary) {
    quote.textContent = "Trollino is warming up the bait. Doolally is checking the banhammer.";
    return;
  }
  const status = statusOf(summary);
  const done = summary.run.completed_tasks;
  const total = summary.run.total_tasks;
  const disagreements = summary.disagreements;

  if (status === "killed") {
    quote.textContent =
      `Trollino pulled the plug after ${fmtNumber(done)} tasks. Doolally is already reaching for the backup.`;
  } else if (status === "interrupted") {
    quote.textContent =
      "The heartbeat stopped. Doolally does not panic, because the last batch is on disk.";
  } else if (status === "failed") {
    quote.textContent = "Something went sideways. The committed batches are still safe.";
  } else if (status === "completed") {
    quote.textContent =
      `Doolally banned the last batch. ${fmtNumber(total)} tasks done, ${fmtNumber(disagreements)} texts where the trolls disagreed.`;
  } else if (status === "running") {
    quote.textContent =
      disagreements > 0
        ? `${fmtNumber(disagreements)} texts where the trolls disagree. The dataset is watching.`
        : "Both trolls agree so far. That is either a good prompt or a suspicious dataset.";
  } else {
    quote.textContent = "The queue is set. Trollino is stretching his typing fingers.";
  }
}

function renderControls() {
  const status = statusOf(state.summary);
  const active = isActive(status);
  const canResume = status === "killed" || status === "interrupted" || status === "failed";
  $("#start-btn").disabled = state.busy || active;
  $("#kill-btn").disabled = state.busy || !active;
  $("#resume-btn").disabled = state.busy || !canResume;
  $("#recovery-resume").disabled = state.busy || !canResume;
  $("#load-log").disabled = !state.runId;
}

function syncFormFromRun(run) {
  if (!run) return;
  const mode = document.querySelector(`input[name="mode"][value="${run.mode}"]`);
  if (mode) mode.checked = true;
  const provider = document.querySelector(`input[name="provider"][value="${run.provider}"]`);
  if (provider) provider.checked = true;
  $("#batch-size").value = String(run.batch_size);
  $("#pause-ms").value = String(run.pause_ms);
  $("#seed").value = String(run.seed);
  $("#retries").checked = (run.retries ?? 1) > 0;
}

function renderHistory() {
  const list = $("#run-list");
  list.replaceChildren();
  if (state.runs.length === 0) {
    list.append(el("p", { class: "empty", text: "No runs yet." }));
    return;
  }
  for (const run of state.runs) {
    const status = run.status;
    const button = el(
      "button",
      {
        type: "button",
        class: "run-row",
        "aria-current": run.id === state.runId ? "true" : "false",
        onclick: () => selectRun(run.id),
      },
      el(
        "span",
        {},
        el("strong", { text: run.id }),
        el("small", {
          text: `${fmtNumber(run.mode)} tasks · ${run.provider} · ${fmtNumber(run.completed_tasks)}/${fmtNumber(run.total_tasks)}`,
        }),
      ),
      el("span", {
        class: "mini-status",
        dataset: { status },
        text: STATUS_META[status] ?? status,
      }),
    );
    list.append(button);
  }
}

function renderAll() {
  renderStatus();
  renderProgress();
  renderModelCard("lfm");
  renderModelCard("d1");
  renderDuel();
  renderTasks();
  renderRecovery();
  renderQuote();
  renderControls();
  renderHistory();
}

async function refreshRuns() {
  const data = await api("/api/runs");
  state.runs = data.runs ?? [];
  renderHistory();
}

async function loadLog() {
  if (!state.runId) return;
  try {
    state.logText = await apiText(`/api/runs/${state.runId}/log`);
    $("#log-view").textContent = state.logText.trim() || "The log is empty. Trollino is suspiciously quiet.";
    setConn("good", "api online");
  } catch (error) {
    $("#log-view").textContent = `Could not load the log: ${error.message}`;
  }
}

async function selectRun(runId) {
  clearTimeout(state.timer);
  state.runId = runId;
  state.logText = "";
  $("#log-view").textContent = "Load the log to see the worker talk.";
  updateUrl(runId);
  try {
    state.summary = await api(`/api/runs/${runId}`);
    syncFormFromRun(state.summary.run);
    setConn("good", "api online");
    renderAll();
    if (state.summary.run.status === "running" || state.summary.run.status === "pending") {
      state.timer = setTimeout(poll, 1100);
    } else {
      await refreshRuns();
    }
  } catch (error) {
    setConn("bad", "api error");
    setFormNote(error.message, "bad");
  }
}

async function poll() {
  if (!state.runId) return;
  clearTimeout(state.timer);
  try {
    const summary = await api(`/api/runs/${state.runId}`);
    state.summary = summary;
    setConn("good", "api online");
    renderAll();
    const status = summary.run.status;
    if (status === "running" || status === "pending") {
      state.timer = setTimeout(poll, 1100);
    } else {
      await refreshRuns();
    }
  } catch (error) {
    setConn("bad", "api error");
    setFormNote(error.message, "bad");
    state.timer = setTimeout(poll, 3000);
  }
}

async function startRun(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const payload = {
    mode: Number(data.get("mode")),
    provider: String(data.get("provider")),
    batchSize: Number(data.get("batchSize")),
    pauseMs: Number(data.get("pauseMs")),
    seed: Number(data.get("seed")),
    excludeHoldout: data.get("excludeHoldout") === "on",
    retries: data.get("retries") === "on" ? 1 : 0,
  };

  state.busy = true;
  renderControls();
  setFormNote("Trollino is baiting the queue. Doolally is checking the batch size...", "muted");
  try {
    const result = await api("/api/runs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setFormNote(
      `${fmtNumber(result.tasks)} tasks queued. Worker pid ${result.pid}. First batch is on the desk.`,
      "good",
    );
    await refreshRuns();
    await selectRun(result.runId);
  } catch (error) {
    setFormNote(error.message, "bad");
  } finally {
    state.busy = false;
    renderControls();
  }
}

async function killRun() {
  if (!state.runId) return;
  const ok = window.confirm(
    "Trollino will pull the plug with SIGKILL. Only committed batches survive. Pull it?",
  );
  if (!ok) return;
  state.busy = true;
  renderControls();
  try {
    await api(`/api/runs/${state.runId}/kill`, { method: "POST" });
    setFormNote("Trollino pulled the plug. SQLite is holding the line.", "bad");
    await selectRun(state.runId);
    await refreshRuns();
  } catch (error) {
    setFormNote(error.message, "bad");
  } finally {
    state.busy = false;
    renderControls();
  }
}

async function resumeRun() {
  if (!state.runId) return;
  state.busy = true;
  renderControls();
  setFormNote("Doolally is reading the last committed batch and picking up the queue...", "muted");
  try {
    const result = await api(`/api/runs/${state.runId}/resume`, { method: "POST" });
    setFormNote(`Worker ${result.pid} is back. No duplicates, no drama.`, "good");
    await selectRun(state.runId);
    await refreshRuns();
  } catch (error) {
    setFormNote(error.message, "bad");
  } finally {
    state.busy = false;
    renderControls();
  }
}

function bindEvents() {
  $("#run-form").addEventListener("submit", startRun);
  $("#kill-btn").addEventListener("click", killRun);
  $("#resume-btn").addEventListener("click", resumeRun);
  $("#recovery-resume").addEventListener("click", resumeRun);
  $("#refresh-runs").addEventListener("click", async () => {
    try {
      await refreshRuns();
      setConn("good", "api online");
    } catch (error) {
      setConn("bad", "api error");
      setFormNote(error.message, "bad");
    }
  });
  $("#load-log").addEventListener("click", loadLog);
}

async function init() {
  bindEvents();
  try {
    state.config = await api("/api/config");
    setConn("good", "api online");
    await refreshRuns();

    const requested = new URLSearchParams(window.location.search).get("run");
    const known = new Set(state.runs.map((run) => run.id));
    const runId = requested && known.has(requested) ? requested : state.runs[0]?.id ?? null;

    if (runId) await selectRun(runId);
    else {
      renderAll();
      setFormNote(
        "No runs yet. Start with the mock provider to see the whole flow, then switch to llama.cpp.",
        "muted",
      );
    }
  } catch (error) {
    setConn("bad", "api offline");
    setFormNote(`The API is not answering: ${error.message}`, "bad");
    renderAll();
  }
}

init();
