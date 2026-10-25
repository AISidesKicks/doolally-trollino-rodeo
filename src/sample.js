import { createHash } from "node:crypto";

import { LABELS, MODES } from "./config.js";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashKey(seed, mode, label, id) {
  return sha256(`${seed}:${mode}:${label}:${id}`);
}

export function orderKey(seed, mode, id) {
  return sha256(`${seed}:${mode}:order:${id}`);
}

function sortByHash(rows, keyFn) {
  return rows
    .map((row) => ({ row, key: keyFn(row) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => entry.row);
}

export function selectTasks(rows, options = {}) {
  const { mode = 100, seed = 42, fold = null, excludeHoldout = false } = options;

  if (!MODES.includes(mode)) {
    throw new Error(`Mode must be one of ${MODES.join(", ")}, got ${mode}`);
  }
  if (mode % LABELS.length !== 0) {
    throw new Error(`Mode ${mode} is not divisible by ${LABELS.length} classes`);
  }

  let pool = rows;
  if (fold) {
    pool = pool.filter((row) => row.fold === fold);
    if (pool.length === 0) throw new Error(`Fold ${fold} has no rows`);
  }
  if (excludeHoldout) {
    pool = pool.filter((row) => row.fold !== "holdout");
  }

  const perClass = mode / LABELS.length;
  const selected = [];

  for (const label of LABELS) {
    const candidates = sortByHash(
      pool.filter((row) => row.label === label),
      (row) => hashKey(seed, mode, label, row.id),
    );
    if (candidates.length < perClass) {
      throw new Error(
        `Mode ${mode} needs ${perClass} rows for ${label}, but the filtered pool has ${candidates.length}`,
      );
    }
    selected.push(...candidates.slice(0, perClass));
  }

  return sortByHash(selected, (row) => orderKey(seed, mode, row.id));
}
