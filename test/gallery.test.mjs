// S5: list_gallery_charts and get_gallery_chart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ROOT, requestsTo, startHarness } from "./helpers.mjs";

const RENDER = "/api/v1/render";
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

describe("S5: gallery tools (Free key)", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("list_gallery_charts groups charts by job and says they are not template ids", async () => {
    const r = await h.call("list_gallery_charts", {});
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Gallery: 3 charts in 2 jobs\./);
    assert.match(r.text, /## Revenue \(revenue\)[\s\S]*mrr-growth \| MRR growth \| line[\s\S]*revenue-by-plan/);
    assert.match(r.text, /## Growth \(growth\)[\s\S]*signups-by-channel/);
    assert.match(r.text, /Use when: You want to show how MRR is trending\./);
    assert.match(r.text, /Shows: MRR by month; target/);
    assert.match(r.text, /Data: columns Month, MRR, Target; 6–12 rows; 1–2 number columns; target: optional; values must be 0 or more; Months in order\./);
    assert.match(r.text, /These are gallery charts\. They are not template ids for `\/api\/v1\/templates`\./);
  });

  it("job filter narrows the list; an unknown job lists the valid ids", async () => {
    const one = await h.call("list_gallery_charts", { job: "growth" });
    assert.match(one.text, /signups-by-channel/);
    assert.doesNotMatch(one.text, /mrr-growth/);
    const none = await h.call("list_gallery_charts", { job: "nope" });
    assert.match(none.text, /No gallery job named "nope"\. Valid jobs: revenue, growth\./);
  });

  it("reading the gallery sends no key, only a User-Agent", async () => {
    h.api.requests.length = 0;
    await h.call("list_gallery_charts", {});
    const req = requestsTo(h.api, "/gallery.json")[0];
    assert.equal(req.authorization, "");
    assert.equal(req.userAgent, `chart-output-mcp/${pkg.version}`);
  });

  it("get_gallery_chart (none) returns the runnable request, sample data and how to change it, not the brand-kit request", async () => {
    const r = await h.call("get_gallery_chart", { slug: "mrr-growth" });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Gallery chart: mrr-growth — MRR growth/);
    assert.match(r.text, /How to change it: Replace data\.labels/);
    assert.match(r.text, /Sample data: \{"labels":\["Jan","Feb","Mar"\]/);
    assert.match(r.text, /"devicePixelRatio": 2/);
    assert.doesNotMatch(r.text, /"brand": "acme"/);
    assert.match(r.text, /not a template id/);
  });

  it("slugs with slashes, dots or capitals are rejected before any request", async () => {
    h.api.requests.length = 0;
    for (const slug of ["../x", "a/b", "MRR-Growth", "mrr growth"]) {
      const r = await h.call("get_gallery_chart", { slug });
      assert.equal(r.isError, true, slug);
    }
    assert.equal(h.api.requests.filter((q) => q.path.startsWith("/gallery/")).length, 0);
  });

  it("an unknown slug says so and points at the list", async () => {
    const r = await h.call("get_gallery_chart", { slug: "no-such-chart" });
    assert.equal(r.isError, true);
    assert.match(r.text, /No gallery chart named no-such-chart\. Call list_gallery_charts/);
  });

  it("render image on Free: no brand is sent; the 403 resolution is retried once at 1× and the result says so", async () => {
    h.api.requests.length = 0;
    const r = await h.call("get_gallery_chart", { slug: "mrr-growth", render: "image" });
    assert.equal(r.isError, false, r.text);
    assert.ok(r.image);
    const renders = requestsTo(h.api, RENDER);
    assert.equal(renders.length, 2, "exactly one retry");
    assert.equal(renders[0].body.devicePixelRatio, 2);
    assert.equal(renders[1].body.devicePixelRatio, 1);
    for (const q of renders) assert.equal("brand" in q.body, false);
    assert.match(r.text, /Rendered at 1× because your plan's size limit/);
    assert.match(r.text, /header and kpiStrip hold numbers too/);
  });

  it("the render goes to the configured API host, never to the endpoint named in the gallery JSON", async () => {
    // The fixture's endpoint.url is https://evil.example/...: if it were used the call would fail, not succeed here.
    h.api.requests.length = 0;
    const r = await h.call("get_gallery_chart", { slug: "mrr-growth", render: "url" });
    assert.equal(r.isError, false, r.text);
    assert.equal(requestsTo(h.api, RENDER).length, 2);
    assert.match(r.text, /Gallery chart "mrr-growth" URL: https:\/\/cdn\.example\/x\.png/);
    assert.match(r.text, /Rendered at 1×/);
  });

  it("overrides replace only the top-level keys given; returnUrl never reaches the render", async () => {
    h.api.requests.length = 0;
    const r = await h.call("get_gallery_chart", {
      slug: "mrr-growth",
      render: "image",
      overrides: { header: { title: "$99" }, returnUrl: true, devicePixelRatio: 1 },
    });
    assert.equal(r.isError, false, r.text);
    const renders = requestsTo(h.api, RENDER);
    assert.equal(renders.length, 1, "already 1×, so no retry");
    const sent = renders[0].body;
    assert.deepEqual(sent.header, { title: "$99" }, "replaced, not deep-merged");
    assert.deepEqual(sent.kpiStrip, [{ label: "Customers", value: "312" }], "untouched keys stay");
    assert.equal(sent.width, 560);
    assert.equal("returnUrl" in sent, false);
    assert.doesNotMatch(r.text, /Rendered at 1×/);
  });

  it("any other 403 is not retried", async () => {
    h.api.requests.length = 0;
    const r = await h.call("get_gallery_chart", {
      slug: "mrr-growth",
      render: "image",
      overrides: { header: { title: "E403" } },
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /Feature: format:pdf/);
    assert.equal(requestsTo(h.api, RENDER).length, 1);
  });
});

describe("S5: gallery tools (Pro key and an unpublished site)", () => {
  it("a Pro key renders at 2× with a single request", async () => {
    const pro = await startHarness({ key: "pk_test_pro" });
    try {
      const r = await pro.call("get_gallery_chart", { slug: "mrr-growth", render: "image" });
      assert.equal(r.isError, false, r.text);
      const renders = requestsTo(pro.api, RENDER);
      assert.equal(renders.length, 1);
      assert.equal(renders[0].body.devicePixelRatio, 2);
      assert.doesNotMatch(r.text, /Rendered at 1×/);
    } finally {
      await pro.close();
    }
  });

  it("when the site has no gallery the list says it is not published yet", async () => {
    const h = await startHarness({ env: (api) => ({ CHART_OUTPUT_SITE_URL: `${api.baseUrl}/empty` }) });
    try {
      const list = await h.call("list_gallery_charts", {});
      assert.equal(list.isError, false);
      assert.equal(list.text, "The gallery index is not published on this site yet.");
      const one = await h.call("get_gallery_chart", { slug: "mrr-growth" });
      assert.equal(one.isError, true);
      assert.match(one.text, /not published on this site yet/);
    } finally {
      await h.close();
    }
  });
});
