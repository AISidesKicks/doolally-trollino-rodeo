import { readFileSync } from "node:fs";

export function readJsonl(file) {
  const rows = [];
  for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1} of ${file}: ${error.message}`);
    }
  }
  return rows;
}

export function validateRows(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (!row.id || !row.text || !row.label) {
      throw new Error(`Dataset row missing id, text or label: ${JSON.stringify(row).slice(0, 120)}`);
    }
    if (ids.has(row.id)) throw new Error(`Duplicate dataset id: ${row.id}`);
    ids.add(row.id);
  }
  return rows;
}

export function loadDataset(file) {
  return validateRows(readJsonl(file));
}
