// Step 0: CHART_OUTPUT_BASE_URL rules.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ROOT } from "./helpers.mjs";

function loadWith(baseUrl) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `import { API_BASE } from "${join(ROOT, "build/config/chartOutput.js")}"; console.log(API_BASE);`],
    { env: { PATH: process.env.PATH, CHART_OUTPUT_BASE_URL: baseUrl }, encoding: "utf8" }
  );
}

describe("CHART_OUTPUT_BASE_URL", () => {
  it("defaults to the www host", () => {
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import { API_BASE } from "${join(ROOT, "build/config/chartOutput.js")}"; console.log(API_BASE);`],
      { env: { PATH: process.env.PATH }, encoding: "utf8" }
    );
    assert.equal(r.stdout.trim(), "https://www.chart-output.com");
  });

  it("accepts https and strips trailing slashes", () => {
    assert.equal(loadWith("https://api.example.com//").stdout.trim(), "https://api.example.com");
  });

  it("accepts http only for localhost and 127.0.0.1", () => {
    assert.equal(loadWith("http://127.0.0.1:4010").stdout.trim(), "http://127.0.0.1:4010");
    assert.equal(loadWith("http://localhost:3000").stdout.trim(), "http://localhost:3000");
  });

  it("rejects plain http to any other host, and non-URLs", () => {
    const bad = loadWith("http://api.example.com");
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /must use https/);
    const junk = loadWith("not a url");
    assert.notEqual(junk.status, 0);
    assert.match(junk.stderr, /full URL/);
  });
});
