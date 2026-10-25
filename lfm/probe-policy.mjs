// Probe the lab LFM model with a combined topic, risk and policy schema.
// Run the LFM server on port 8081 first, then: node lfm/probe-policy.mjs

import { DATASET_PATH, LABELS } from "../src/config.js";
import { loadDataset } from "../src/dataset.js";
import { selectTasks } from "../src/sample.js";

const rows = loadDataset(DATASET_PATH);
const play = selectTasks(rows, { mode: 100, seed: 42 });
const perClass = new Map();
for (const row of play) {
  if (!perClass.has(row.label)) perClass.set(row.label, []);
  const bucket = perClass.get(row.label);
  if (bucket.length < 5) bucket.push(row);
}
const tasks = LABELS.flatMap((label) => perClass.get(label) ?? []);

const schema = {
  type: "object",
  properties: {
    topic: { type: "string", enum: LABELS },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    policy_dimension: {
      type: "string",
      enum: ["scope", "risk_assessment", "implementation", "stakeholders", "none"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["topic", "risk", "policy_dimension", "confidence"],
  additionalProperties: false,
};

const system = `You are a strict policy and content-risk classifier.
Return JSON only. Do not explain.

Fields:
- topic: the subject matter. Choose exactly one:
  - Politics & Elections: campaigns, candidates, elections, voting, public policy, government or military action.
  - Medical & Health: medical advice, symptoms, disease, drugs, treatment, hospitals, mental health or personal health.
  - Legal & Regulatory: court cases, lawsuits, contracts, compliance, regulation, police, crime or law enforcement.
  - Financial & Crypto: banks, investments, stocks, loans, mortgages, taxes, payments, crypto, markets or company finance.
- risk: the potential impact if the content is acted on or spread. Choose one:
  - low: minor inaccuracies, non-sensitive data, benign creative material.
  - medium: potentially misleading information, culturally sensitive depictions, or content that could incite limited public unrest.
  - high: direct threats to safety, non-consensual intimate images, deepfake election propaganda, or hate speech with a high likelihood of real-world violence.
- policy_dimension: only when the text is about how AI rules are made. Choose scope, risk_assessment, implementation, stakeholders, or none.
- confidence: 0 to 1.

Rules:
- topic is the subject, not the severity.
- Do not invent a fifth topic.
- If the text mixes topics, pick the dominant one.
- Use high risk only when the impact is concrete and severe.
`;

async function classify(row) {
  const started = performance.now();
  const response = await fetch("http://127.0.0.1:8081/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "lfm",
      temperature: 0.1,
      seed: 42,
      max_tokens: 512,
      stream: false,
      response_format: { type: "json_object", schema },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Text to classify:\n"""${row.text}"""` },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await response.json();
  const content = body.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  return { parsed, latencyMs: performance.now() - started, raw: content };
}

const results = [];
for (const row of tasks) {
  try {
    const { parsed, latencyMs } = await classify(row);
    results.push({
      id: row.id,
      expected: row.label,
      ...parsed,
      correct: parsed.topic === row.label,
      latencyMs: Math.round(latencyMs),
    });
  } catch (error) {
    results.push({ id: row.id, expected: row.label, error: error.message });
  }
}

const valid = results.filter((r) => !r.error);
const correct = valid.filter((r) => r.correct);
const riskCounts = {};
const dimensionCounts = {};
for (const row of valid) {
  riskCounts[row.risk] = (riskCounts[row.risk] ?? 0) + 1;
  dimensionCounts[row.policy_dimension] = (dimensionCounts[row.policy_dimension] ?? 0) + 1;
}

console.log(
  JSON.stringify(
    {
      tasks: results.length,
      valid: valid.length,
      errors: results.filter((r) => r.error).length,
      topicCorrect: correct.length,
      topicAccuracy: valid.length ? correct.length / valid.length : null,
      riskCounts,
      dimensionCounts,
      medianLatencyMs: [...valid].sort((a, b) => a.latencyMs - b.latencyMs)[Math.floor(valid.length / 2)]?.latencyMs,
      rows: results,
    },
    null,
    2,
  ),
);
