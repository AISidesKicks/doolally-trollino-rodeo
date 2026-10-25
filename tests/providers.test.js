import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeLabel } from "../src/providers/llama.js";

test("exact labels are accepted", () => {
  assert.equal(normalizeLabel("Politics & Elections"), "Politics & Elections");
  assert.equal(normalizeLabel("Medical & Health"), "Medical & Health");
  assert.equal(normalizeLabel("Legal & Regulatory"), "Legal & Regulatory");
  assert.equal(normalizeLabel("Financial & Crypto"), "Financial & Crypto");
});

test("near misses from small models are normalized", () => {
  assert.equal(normalizeLabel("Political & Elections"), "Politics & Elections");
  assert.equal(normalizeLabel("Political Campaigns"), "Politics & Elections");
  assert.equal(normalizeLabel("Medical/Health"), "Medical & Health");
  assert.equal(normalizeLabel("Business & Finance"), "Financial & Crypto");
  assert.equal(normalizeLabel("Regulatory"), "Legal & Regulatory");
});

test("unknown labels stay invalid so the retry can fire", () => {
  assert.equal(normalizeLabel("History"), null);
  assert.equal(normalizeLabel("D"), null);
  assert.equal(normalizeLabel(null), null);
});
