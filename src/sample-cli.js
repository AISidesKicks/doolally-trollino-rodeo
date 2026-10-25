#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { DATASET_PATH, MODES, ROOT } from "./config.js";
import { loadDataset } from "./dataset.js";
import { selectTasks } from "./sample.js";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "100" },
    seed: { type: "string", default: "42" },
    input: { type: "string" },
    out: { type: "string" },
    fold: { type: "string" },
    "exclude-holdout": { type: "boolean", default: false },
  },
});

const mode = Number(values.mode);
if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
const seed = Number(values.seed);
const input = values.input || DATASET_PATH;
const suffix = values.fold ? `-${values.fold}` : values["exclude-holdout"] ? "-no-holdout" : "";
const out = values.out || path.join(ROOT, "scratch", "datasets", "work", `node-play-${mode}${suffix}.jsonl`);

const rows = loadDataset(input);
const selected = selectTasks(rows, {
  mode,
  seed,
  fold: values.fold ?? null,
  excludeHoldout: values["exclude-holdout"],
});

mkdirSync(path.dirname(out), { recursive: true });
const lines = selected.map((row, index) =>
  JSON.stringify({ ...row, position: index + 1, play: mode, play_seed: seed }),
);
writeFileSync(out, `${lines.join("\n")}\n`);

const counts = {};
for (const row of selected) counts[row.label] = (counts[row.label] ?? 0) + 1;
console.log(JSON.stringify({ mode, seed, rows: selected.length, counts, out }, null, 2));
