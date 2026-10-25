import { createHash, randomBytes } from "node:crypto";

// Minimal OTLP/HTTP protobuf encoder. Phoenix accepts protobuf on
// /v1/traces, not JSON, so this keeps the lab dependency-free.

function varint(value) {
  let current = BigInt(value);
  const bytes = [];
  while (current > 0x7fn) {
    bytes.push(Number(current & 0x7fn) | 0x80);
    current >>= 7n;
  }
  bytes.push(Number(current));
  return Buffer.from(bytes);
}

function tag(field, wire) {
  return varint((BigInt(field) << 3n) | BigInt(wire));
}

function fieldBytes(field, buffer) {
  return Buffer.concat([tag(field, 2), varint(buffer.length), buffer]);
}

function fieldString(field, value) {
  return fieldBytes(field, Buffer.from(String(value), "utf8"));
}

function fieldVarint(field, value) {
  return Buffer.concat([tag(field, 0), varint(value)]);
}

function fieldFixed64(field, value) {
  const head = tag(field, 1);
  const body = Buffer.alloc(head.length + 8);
  head.copy(body, 0);
  body.writeBigUInt64LE(BigInt(value), head.length);
  return body;
}

function keyValue(key, value) {
  const anyValue = fieldString(1, value);
  return Buffer.concat([fieldString(1, key), fieldBytes(2, anyValue)]);
}

function encodeSpan({ traceId, spanId, name, startMs, endMs, attributes, error = false }) {
  const parts = [
    fieldBytes(1, Buffer.from(traceId, "hex")),
    fieldBytes(2, Buffer.from(spanId, "hex")),
    fieldString(5, name),
    fieldVarint(6, 1),
    fieldFixed64(7, BigInt(Math.round(startMs)) * 1_000_000n),
    fieldFixed64(8, BigInt(Math.round(endMs)) * 1_000_000n),
  ];

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    parts.push(fieldBytes(9, keyValue(key, value)));
  }

  // Status { code: 1 = OK, 2 = ERROR }
  parts.push(fieldBytes(15, Buffer.from([0x18, error ? 0x02 : 0x01])));
  return Buffer.concat(parts);
}

function encodeRequest({ serviceName, spans }) {
  const resource = Buffer.concat([
    fieldBytes(1, keyValue("service.name", serviceName)),
    fieldBytes(1, keyValue("service.version", "0.1.0")),
  ]);
  const scope = fieldString(1, "dlly-lab");
  const scopeSpans = Buffer.concat([
    fieldBytes(1, scope),
    ...spans.map((span) => fieldBytes(2, encodeSpan(span))),
  ]);
  const resourceSpans = Buffer.concat([
    fieldBytes(1, resource),
    fieldBytes(2, scopeSpans),
  ]);
  return fieldBytes(1, resourceSpans);
}

export function traceIdForRun(runId) {
  return createHash("sha256").update(`dlly:${runId}`).digest("hex").slice(0, 32);
}

export function createTracer(options = {}) {
  const {
    endpoint = process.env.PHOENIX_URL || "",
    serviceName = "dlly-lab",
    fetchImpl = fetch,
  } = options;

  if (!endpoint) {
    return { enabled: false, recordBatch: async () => {} };
  }

  const url = new URL("/v1/traces", endpoint.endsWith("/") ? endpoint : `${endpoint}/`).toString();
  let warned = false;

  function warn(error) {
    if (warned) return;
    warned = true;
    console.error(`phoenix tracing disabled after error: ${error.message}`);
  }

  async function recordBatch({ runId, batchIndex, tasks, attempts, completed, startedAt }) {
    const endMs = Date.now();
    const errors = attempts.filter((attempt) => attempt.error).length;
    const retries = attempts.reduce((sum, attempt) => sum + (attempt.raw?.retries ?? 0), 0);
    const span = {
      traceId: traceIdForRun(runId),
      spanId: randomBytes(8).toString("hex"),
      name: `classify batch ${batchIndex + 1}`,
      startMs: startedAt ?? endMs - 1,
      endMs,
      error: errors > 0,
      attributes: {
        "run.id": runId,
        "batch.index": String(batchIndex + 1),
        "batch.tasks": String(tasks),
        "batch.attempts": String(attempts.length),
        "batch.errors": String(errors),
        "batch.retries": String(retries),
        "run.completed": String(completed),
      },
    };

    const body = encodeRequest({ serviceName, spans: [span] });
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-protobuf",
          "content-length": String(body.length),
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        warn(new Error(`HTTP ${response.status}`));
      }
      return response.ok;
    } catch (error) {
      warn(error);
      return false;
    }
  }

  return { enabled: true, recordBatch };
}
