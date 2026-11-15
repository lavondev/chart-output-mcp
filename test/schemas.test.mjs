// M2 (wrong hints gone), M4 (examples fit Free), M5 (plan names), M6 (sizes and dataset fields reach the API).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ROOT, requestsTo, startHarness } from "./helpers.mjs";

const RENDER = "/api/v1/render";

describe("M4: shipped examples run on a Free key", () => {
  const dir = join(ROOT, "examples");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`${file} has a longest edge of 1200 px or less`, () => {
      const j = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const edge = Math.round(Math.max(j.width ?? 800, j.height ?? 400) * (j.scale ?? j.devicePixelRatio ?? 1));
      assert.ok(edge <= 1200, `${file}: ${edge}px`);
    });
  }
});

describe("S10: examples use only documented fields and no account-specific brand slug", () => {
  // Top-level keys from the request-fields reference (Appendix A of the catch-up doc).
  const ALLOWED = new Set([
    "type", "data", "options", "width", "height", "format", "scale", "devicePixelRatio", "returnUrl", "repair_mode",
    "brand", "brandKitId", "theme", "padding", "colorblind_safe", "logo", "header", "legend", "kpiStrip", "footer",
    "border", "borderRadius", "backgroundColor", "textScale", "dataLabels", "annotations", "alt_text", "lang",
  ]);
  const dir = join(ROOT, "examples");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`${file}`, () => {
      const j = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const unknown = Object.keys(j).filter((k) => !ALLOWED.has(k));
      assert.deepEqual(unknown, [], `unknown top-level keys in ${file}`);
      assert.equal("brand" in j, false, "slugs belong to accounts; use brandKitId presets or theme");
    });
  }

  it("the three new examples exist and are listed by get_chart_example", async () => {
    const ids = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    for (const id of ["annotated-signups", "large-text-kpi", "accessible-alt-text"]) assert.ok(ids.includes(id), id);
  });
});

describe("M2 / M5: tool text", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("tool descriptions and instructions have no stale plan names or invented fields", async () => {
    const { tools } = await h.client.listTools();
    const text = [...tools.map((t) => `${t.name}\n${t.description}\n${JSON.stringify(t.inputSchema)}`), h.client.getInstructions() ?? ""].join("\n");
    assert.doesNotMatch(text, /Business/);
    assert.doesNotMatch(text, /500 renders/);
    // "there is no delta" is deliberate guidance; the old wrong shape was `{ label, value, delta }`.
    assert.doesNotMatch(text, /value,\s*delta/);
    assert.doesNotMatch(text, /footer \(\{/);
    assert.doesNotMatch(text, /"light" \| "dark"/);
    assert.doesNotMatch(text, /auto-retry/i);
    assert.doesNotMatch(text, /exactly match/);
    assert.match(text, /Pro or Agency/);
  });

  it("card tool descriptions name the real shapes", async () => {
    const { tools } = await h.client.listTools();
    for (const name of ["render_card", "render_card_url"]) {
      const spec = JSON.stringify(tools.find((t) => t.name === name).inputSchema);
      assert.match(spec, /kpiStrip \[\{label, value, color\?\}\]/);
      assert.match(spec, /footer \{left\?, right\?, borderTop\?\}/);
      assert.match(spec, /an object, never a string/);
      assert.match(spec, /textScale/);
    }
  });

  it("the request-fields reference resource is listed and readable", async () => {
    const { resources } = await h.client.listResources();
    assert.ok(resources.length >= 8);
    const read = await h.client.readResource({ uri: "chart-output://reference/request-fields" });
    const text = read.contents[0].text;
    assert.match(text, /kpiStrip.*There is no delta/);
    assert.match(text, /70% opacity/);
    assert.match(text, /dashed automatically/);
    assert.match(text, /annotations_not_supported/);
  });

  it("serverInfo.version equals package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(h.client.getServerVersion()?.version, pkg.version);
  });
});

describe("M6: sizes and dataset fields", () => {
  let free;
  let pro;
  before(async () => {
    free = await startHarness();
    pro = await startHarness({ key: "pk_test_pro" });
  });
  after(async () => {
    await free.close();
    await pro.close();
  });

  it("dataset fields (fill, stack, yAxisID, dataset type, null, [from,to], datalabels) all reach the API", async () => {
    pro.api.requests.length = 0;
    const datasets = [
      { label: "A", data: [1, null, 3], fill: true, tension: 0.4, stack: "a", borderDash: [6, 4], pointRadius: 3, borderWidth: 2 },
      { label: "B", data: [10, 20, 30], type: "line", yAxisID: "y1", hidden: false, datalabels: { display: true } },
      { label: "Range", data: [[10, 20], [5, 8], [1, 2]], borderRadius: 4 },
      { label: "Pts", data: [{ x: "Jan", y: 3 }, { x: "Feb", y: null }, { x: "Mar", y: 5 }], pointBackgroundColor: "#f00" },
    ];
    const r = await pro.call("render_chart", { type: "bar", labels: ["Jan", "Feb", "Mar"], datasets });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(requestsTo(pro.api, RENDER)[0].body.data.datasets, datasets);
  });

  it("scale is sent as scale; width up to 4000 passes the schema (the plan decides)", async () => {
    pro.api.requests.length = 0;
    const ok = await pro.call("render_chart", {
      type: "line",
      labels: ["a"],
      datasets: [{ data: [1] }],
      width: 3000,
      height: 500,
      scale: 1,
    });
    assert.equal(ok.isError, false, ok.text);
    const sent = requestsTo(pro.api, RENDER)[0].body;
    assert.equal(sent.width, 3000);
    assert.equal(sent.scale, 1);

    // 4000 is valid for the schema; the fake plan gate then answers 403, which is the app's call.
    const tooBig = await free.call("render_chart", {
      type: "line",
      labels: ["a"],
      datasets: [{ data: [1] }],
      width: 4000,
    });
    assert.equal(tooBig.isError, true);
    assert.match(tooBig.text, /Chart-Output 403/);
    assert.doesNotMatch(tooBig.text, /Invalid arguments|too_big/i);
  });

  it("a Free key at 2× over 1200 px gets the resolution 403 text", async () => {
    const r = await free.call("render_chart", {
      type: "line",
      labels: ["a"],
      datasets: [{ data: [1] }],
      width: 1200,
      height: 600,
      scale: 2,
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /Feature: resolution/);
  });

  it("pdf is accepted by render_chart_url only", async () => {
    pro.api.requests.length = 0;
    const url = await pro.call("render_chart_url", {
      type: "bar",
      labels: ["a"],
      datasets: [{ data: [1] }],
      format: "pdf",
    });
    assert.equal(url.isError, false, url.text);
    assert.match(url.text, /https:\/\/cdn\.example\/x\.png/);
    const sent = requestsTo(pro.api, RENDER)[0].body;
    assert.equal(sent.format, "pdf");
    assert.equal(sent.returnUrl, true);

    pro.api.requests.length = 0;
    const inline = await pro.call("render_chart", {
      type: "bar",
      labels: ["a"],
      datasets: [{ data: [1] }],
      format: "pdf",
    });
    assert.equal(inline.isError, true);
    assert.equal(requestsTo(pro.api, RENDER).length, 0);
  });
});
