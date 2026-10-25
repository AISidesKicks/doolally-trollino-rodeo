import { LABELS, LABEL_DESCRIPTIONS } from "../config.js";

const SYSTEM_PROMPT = [
  "You are a strict topic classifier for a safety triage system.",
  "Think briefly about the text, then choose exactly one label from this list:",
  ...LABELS.map((label) => `- ${label}: ${LABEL_DESCRIPTIONS[label]}`),
  "Keep the reasoning short, under 80 words.",
  "After the reasoning, return JSON only, with no markdown and no extra explanation.",
  'The shape must be {"label":"one exact label from the list","confidence":0.85}.',
].join("\n");

export function normalizeLabel(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (LABELS.includes(cleaned)) return cleaned;

  const lower = cleaned
    .toLowerCase()
    .replace(/\s*[&/]\s*/g, " & ")
    .replace(/\s+/g, " ");
  const aliases = {
    politics: "Politics & Elections",
    political: "Politics & Elections",
    "political & elections": "Politics & Elections",
    "politics and elections": "Politics & Elections",
    elections: "Politics & Elections",
    medical: "Medical & Health",
    "medical & health": "Medical & Health",
    "medical and health": "Medical & Health",
    health: "Medical & Health",
    legal: "Legal & Regulatory",
    "legal & regulatory": "Legal & Regulatory",
    "legal and regulatory": "Legal & Regulatory",
    regulatory: "Legal & Regulatory",
    financial: "Financial & Crypto",
    "financial & crypto": "Financial & Crypto",
    "financial and crypto": "Financial & Crypto",
    "business & finance": "Financial & Crypto",
    "business and finance": "Financial & Crypto",
    finance: "Financial & Crypto",
    business: "Financial & Crypto",
    crypto: "Financial & Crypto",
  };
  if (aliases[lower]) return aliases[lower];

  const exact = LABELS.find((label) => label.toLowerCase() === lower);
  if (exact) return exact;

  // Models sometimes paraphrase the class name with the same head noun.
  if (/^politic/.test(lower)) return "Politics & Elections";
  if (/^medical/.test(lower) || /^health/.test(lower)) return "Medical & Health";
  if (/^legal/.test(lower) || /^regulat/.test(lower)) return "Legal & Regulatory";
  if (/^financial/.test(lower) || /^finance/.test(lower) || /^crypto/.test(lower)) {
    return "Financial & Crypto";
  }

  return null;
}

function extractJson(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findLabel(text) {
  if (typeof text !== "string") return null;
  return LABELS.find((label) => text.includes(label)) ?? null;
}

async function postJson(url, payload, timeoutMs) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Invalid JSON response: ${body.slice(0, 300)}`);
  }
}

export function createLfmProvider(options = {}) {
  const {
    baseUrl = "http://127.0.0.1:8081",
    timeoutMs = 120_000,
    model = "lfm",
  } = options;
  const endpoint = new URL("/v1/chat/completions", baseUrl).toString();

  return {
    key: model,
    kind: "llama",
    async classify({ text }) {
      const started = performance.now();
      const data = await postJson(
        endpoint,
        {
          model,
          temperature: 0.1,
          max_tokens: 512,
          stream: false,
          response_format: {
            type: "json_object",
            schema: {
              type: "object",
              properties: {
                label: { type: "string", enum: LABELS },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["label", "confidence"],
              additionalProperties: false,
            },
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Text to classify:\n"""${text}"""` },
          ],
        },
        timeoutMs,
      );

      const message = data.choices?.[0]?.message ?? {};
      const content = message.content || message.reasoning_content || "";
      const parsed = extractJson(content) ?? {};
      const label = normalizeLabel(parsed.label) ?? findLabel(content);
      if (!label) {
        throw new Error(`LFM returned no valid label: ${String(content).slice(0, 200)}`);
      }

      return {
        label,
        confidence:
          typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
            ? parsed.confidence
            : null,
        latencyMs: performance.now() - started,
        raw: {
          provider: "llama",
          model,
          finishReason: data.choices?.[0]?.finish_reason ?? null,
          usage: data.usage ?? null,
          reasoning: message.reasoning_content ? String(message.reasoning_content).slice(0, 500) : null,
          content: String(content).slice(0, 500),
        },
      };
    },
  };
}

export function createD1Provider(options = {}) {
  const {
    baseUrl = "http://127.0.0.1:8082",
    timeoutMs = 120_000,
    model = "d1",
  } = options;
  const endpoint = new URL("/v1/systemone", baseUrl).toString();

  const criteria = Object.fromEntries(
    LABELS.map((label) => [label, LABEL_DESCRIPTIONS[label]]),
  );

  return {
    key: model,
    kind: "llama",
    async classify({ text }) {
      const started = performance.now();
      const data = await postJson(
        endpoint,
        {
          state: text,
          questions: {
            category: {
              type: "choice",
              instructions:
                "Which high-risk topical category best fits this text? Pick exactly one.",
              criteria,
            },
          },
        },
        timeoutMs,
      );

      const answer = data.answers?.category;
      const label = normalizeLabel(answer?.choice);
      if (!label) {
        throw new Error(
          `d1 returned no valid choice: ${JSON.stringify(data.answers ?? data).slice(0, 300)}`,
        );
      }

      return {
        label,
        confidence:
          typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
            ? answer.confidence
            : null,
        latencyMs: performance.now() - started,
        raw: {
          provider: "systemone",
          model,
          choice: answer.choice,
          confidence: answer.confidence ?? null,
          probabilities: answer.probabilities ?? null,
          usage: data.usage ?? null,
        },
      };
    },
  };
}
