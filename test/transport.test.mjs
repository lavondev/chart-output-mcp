// S8 retries and timeouts, S9 HTTP transport.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ROOT, requestsTo, startHarness } from "./helpers.mjs";
import { startFakeApi } from "../scripts/fake-api.mjs";

const RENDER = "/api/v1/render";
const bar = { type: "bar", labels: ["A"], datasets: [{ data: [1] }] };

describe("S8: retries and waits", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("a 429 with Retry-After: 600 fails fast with a clear message and is not repeated", async () => {
    h.api.requests.length = 0;
    const t0 = Date.now();
    const r = await h.call("render_chart", { ...bar, title: "E429" });
    assert.ok(Date.now() - t0 < 1500, "must not wait for the window");
    assert.equal(r.isError, true);
    assert.match(r.text, /Rate limited\. Try again in about 600 seconds\./);
    assert.equal(requestsTo(h.api, RENDER).length, 1);
  });

  it("a 500 is not retried", async () => {
    h.api.requests.length = 0;
    const r = await h.call("render_chart", { ...bar, title: "E500" });
    assert.equal(r.isError, true);
    assert.match(r.text, /500/);
    assert.equal(requestsTo(h.api, RENDER).length, 1);
  });

  it("a 503 is retried and then succeeds", async () => {
    h.api.requests.length = 0;
    const r = await h.call("render_chart", { ...bar, title: "FLAKY503" });
    assert.equal(r.isError, false, r.text);
    assert.equal(requestsTo(h.api, RENDER).length, 2);
  });
});

describe("S8: the AI chart waits long and never runs twice", () => {
  it("a slow answer succeeds under the default timeout", async () => {
    const pro = await startHarness({ key: "pk_test_pro" });
    try {
      const r = await pro.call("render_chart_ai", { description: "SLOWAI bar chart of A and B" });
      assert.equal(r.isError, false, r.text);
      assert.match(r.text, /AI charts: 3 of 100 used this period \(97 left\)\./);
    } finally {
      await pro.close();
    }
  });

  it("a timeout is reported and not retried", async () => {
    const pro = await startHarness({ key: "pk_test_pro", env: { CHART_OUTPUT_AI_TIMEOUT_MS: "400" } });
    try {
      const r = await pro.call("render_chart_ai", { description: "SLOWAI bar chart of A and B" });
      assert.equal(r.isError, true);
      assert.match(r.text, /timed out/);
      assert.match(r.text, /not repeated/);
      assert.equal(requestsTo(pro.api, "/api/v1/ai/render").length, 1);
    } finally {
      await pro.close();
    }
  });
});

// ---- S9: HTTP transport -------------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function startHttp(api, env) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, "build", "http.js")], {
    env: { PATH: process.env.PATH, PORT: String(port), CHART_OUTPUT_BASE_URL: api.baseUrl, CHART_OUTPUT_RETRY_BASE_MS: "10", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("http server did not start")), 8000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("running on")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`http server exited with ${code}`)));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => child.kill(),
    async rpc(method, params, headers = {}) {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return { status: res.status, body: await res.json() };
    },
  };
}

const toolText = (body) => (body.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

describe("S9: HTTP transport", () => {
  let api;
  let http;
  before(async () => {
    api = await startFakeApi();
    // The server has its own key set, as a careless public deployment would.
    http = await startHttp(api, { CHART_OUTPUT_API_KEY: "pk_test_server_secret" });
  });
  after(async () => {
    http.stop();
    await api.close();
  });

  it("a call with no key of its own gets a clear 401 text and never uses the server's key", async () => {
    api.requests.length = 0;
    const { body } = await http.rpc("tools/call", { name: "render_chart", arguments: bar });
    assert.equal(body.result?.isError, true, JSON.stringify(body));
    assert.match(toolText(body), /401 authentication_required: no API key was provided/);
    assert.equal(api.requests.filter((r) => r.path === RENDER).length, 0);
  });

  it("the caller's own key (either header) is used", async () => {
    api.requests.length = 0;
    const a = await http.rpc("tools/call", { name: "render_chart", arguments: bar }, { authorization: "Bearer pk_test_caller_a" });
    assert.notEqual(a.body.result?.isError, true, JSON.stringify(a.body));
    const b = await http.rpc("tools/call", { name: "render_chart", arguments: bar }, { "x-chart-output-api-key": "pk_test_caller_b" });
    assert.notEqual(b.body.result?.isError, true, JSON.stringify(b.body));
    const auths = requestsTo(api, RENDER).map((r) => r.authorization);
    assert.deepEqual(auths, ["Bearer pk_test_caller_a", "Bearer pk_test_caller_b"]);
  });

  it("a 300 KB request body passes the parser", async () => {
    api.requests.length = 0;
    const { status, body } = await http.rpc(
      "tools/call",
      { name: "render_chart", arguments: { ...bar, extensions: { padding_note: "x".repeat(300_000) } } },
      { authorization: "Bearer pk_test_big" }
    );
    assert.equal(status, 200);
    assert.notEqual(body.result?.isError, true, JSON.stringify(body).slice(0, 300));
    assert.equal(requestsTo(api, RENDER).length, 1);
  });

  it("tools/list needs no key", async () => {
    const { body } = await http.rpc("tools/list", {});
    assert.ok(body.result.tools.length >= 12);
  });

  it("MCP_ALLOW_SERVER_KEY=true lets the server's own key be used", async () => {
    const open = await startHttp(api, { CHART_OUTPUT_API_KEY: "pk_test_server_secret", MCP_ALLOW_SERVER_KEY: "true" });
    try {
      api.requests.length = 0;
      const { body } = await open.rpc("tools/call", { name: "render_chart", arguments: bar });
      assert.notEqual(body.result?.isError, true, JSON.stringify(body));
      assert.equal(requestsTo(api, RENDER)[0].authorization, "Bearer pk_test_server_secret");
    } finally {
      open.stop();
    }
  });
});
