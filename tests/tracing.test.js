import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { createTracer } from "../src/tracing.js";

test("tracer posts one protobuf span and keeps it quiet", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        headers: request.headers,
        body: Buffer.concat(chunks),
        url: request.url,
      });
      response.writeHead(200);
      response.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;

  try {
    const tracer = createTracer({ endpoint, serviceName: "dlly-lab-test" });
    assert.equal(tracer.enabled, true);

    const ok = await tracer.recordBatch({
      runId: "run-test",
      batchIndex: 2,
      tasks: 3,
      attempts: [
        { model: "lfm", raw: { retries: 1 } },
        { model: "d1", raw: { retries: 0 } },
      ],
      completed: 9,
      startedAt: Date.now() - 500,
    });

    assert.equal(ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/v1/traces");
    assert.equal(requests[0].headers["content-type"], "application/x-protobuf");
    assert.equal(requests[0].body.length > 80, true);
    assert.equal(requests[0].body.includes(Buffer.from("dlly-lab-test")), true);
    assert.equal(requests[0].body.includes(Buffer.from("run-test")), true);
    assert.equal(requests[0].body.includes(Buffer.from("batch.retries")), true);
  } finally {
    server.close();
  }
});

test("tracer is disabled without an endpoint", async () => {
  const tracer = createTracer({ endpoint: "" });
  assert.equal(tracer.enabled, false);
  assert.equal(await tracer.recordBatch({}), undefined);
});
