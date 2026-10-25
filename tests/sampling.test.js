import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";

import { ROOT } from "../src/config.js";
import { loadDataset } from "../src/dataset.js";
import { selectTasks } from "../src/sample.js";

const dataset = loadDataset(path.join(ROOT, "datasets", "high-risk-10k.jsonl"));

test("mode 100 matches the python sampler selection", () => {
  const selected = selectTasks(dataset, { mode: 100, seed: 42 });
  assert.equal(selected.length, 100);
  assert.deepEqual(
    selected.slice(0, 8).map((row) => row.id),
    [
      "hr-252de4b5aa25",
      "hr-5ea04eb42310",
      "hr-f6fa4fff4fe3",
      "hr-0e8a469dcce5",
      "hr-009568a9f7c3",
      "hr-eed5c2cf238a",
      "hr-1f734028b2b0",
      "hr-7a2986dbd793",
    ],
  );
});

test("mode 100 is stratified across every class", () => {
  const selected = selectTasks(dataset, { mode: 100, seed: 42 });
  const counts = new Map();
  for (const row of selected) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  assert.equal(counts.size, 4);
  assert.deepEqual([...counts.values()], [25, 25, 25, 25]);
  assert.equal(new Set(selected.map((row) => row.id)).size, 100);
});

test("mode 1000 excludes the holdout on request", () => {
  const selected = selectTasks(dataset, { mode: 1000, seed: 42, excludeHoldout: true });
  assert.equal(selected.length, 1000);
  assert.equal(selected.some((row) => row.fold === "holdout"), false);
  const counts = new Map();
  for (const row of selected) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  assert.deepEqual([...counts.values()], [250, 250, 250, 250]);
});

test("mode 10000 uses every row exactly once", () => {
  const selected = selectTasks(dataset, { mode: 10000, seed: 42 });
  assert.equal(selected.length, 10000);
  assert.equal(new Set(selected.map((row) => row.id)).size, 10000);
});

test("selection is deterministic", () => {
  const first = selectTasks(dataset, { mode: 100, seed: 42 }).map((row) => row.id);
  const second = selectTasks(dataset, { mode: 100, seed: 42 }).map((row) => row.id);
  assert.deepEqual(first, second);
});

test("a play batch is not the first 100 rows", () => {
  const selected = new Set(selectTasks(dataset, { mode: 100, seed: 42 }).map((row) => row.id));
  const head = new Set(dataset.slice(0, 100).map((row) => row.id));
  assert.notDeepEqual(selected, head);
});
