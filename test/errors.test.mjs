// M1 (real error text), M3 (no lossy retry), M7 (check bytes against Content-Type).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { requestsTo, startHarness } from "./helpers.mjs";

const RENDER = "/api/v1/render";
const baseCard = (marker = "") => ({
  type: "bar",
  width: 800,
  height: 400,
  format: "png",
  data: { labels: ["A", "B"], datasets: [{ label: "S", data: [1, 2] }] },
  header: { title: `Report ${marker}` },
});

describe("M1: describeApiError", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("402 keeps the message, reset date, upgrade link, request id and is tried once", async () => {
    h.api.requests.length = 0;
    const r = await h.call("render_card", { spec: baseCard("E402") });
    assert.equal(r.isError, true);
    assert.match(r.text, /402 quota_exceeded/);
    assert.match(r.text, /1000 of 1000 renders/);
    assert.match(r.text, /Resets at 2026-12-01T00:00:00\.000Z/);
    assert.match(r.text, /Upgrade: https:\/\/www\.chart-output\.com\/billing\/upgrade\?plan=pro/);
    assert.match(r.text, /Allowance: renders — 1,000 of 1,000 used on the free plan/);
    assert.match(r.text, /Do not retry/);
    assert.match(r.text, /\(request id: req_fake_123\)/);
    assert.equal(requestsTo(h.api, RENDER).length, 1);
  });

  it("403 plan_required names the feature and plan, and is tried once", async () => {
    h.api.requests.length = 0;
    const r = await h.call("render_card_url", { spec: baseCard("E403") });
    assert.equal(r.isError, true);
    assert.match(r.text, /403 plan_required: PDF output needs the Pro plan/);
    assert.match(r.text, /Feature: format:pdf \(needs the pro plan; you are on free\)/);
    assert.match(r.text, /Upgrade: https:/);
    assert.match(r.text, /Do not retry/);
    assert.equal(requestsTo(h.api, RENDER).length, 1);
  });

  it("400 lists every failing field path", async () => {
    const r = await h.call("render_card", { spec: baseCard("E400") });
    assert.equal(r.isError, true);
    assert.match(r.text, /400 Invalid chart specification/);
    assert.match(r.text, /- theme: Expected object, received string/);
    assert.match(r.text, /- data\.labels: At least 1 label is required/);
  });

  it("404 brand_kit_not_found lists the available slugs", async () => {
    const r = await h.call("render_card", { spec: { ...baseCard("E404BRAND"), brand: "does-not-exist" } });
    assert.equal(r.isError, true);
    assert.match(r.text, /404 brand_kit_not_found/);
    assert.match(r.text, /acme-dark, acme-light/);
  });

  it("401 explains how to set the key", async () => {
    const r = await h.call("render_card", { spec: baseCard("E401") });
    assert.equal(r.isError, true);
    assert.match(r.text, /401 Invalid API key/);
    assert.match(r.text, /CHART_OUTPUT_API_KEY/);
  });

  it("render_chart_ai on a Free key shows ai_renders and says Pro or Agency, never Business", async () => {
    const r = await h.call("render_chart_ai", { description: "Pie chart: Android 72%, iOS 27%, Other 1%" });
    assert.equal(r.isError, true);
    assert.match(r.text, /403 plan_required/);
    assert.match(r.text, /Feature: ai_renders/);
    assert.doesNotMatch(r.text, /Business/);
  });

  it("a size over the Free cap says resolution and suggests a smaller size", async () => {
    const r = await h.call("render_card", { spec: { ...baseCard(), width: 1200, height: 840, scale: 2 } });
    assert.equal(r.isError, true);
    assert.match(r.text, /Feature: resolution/);
    assert.match(r.text, /smaller width, height or scale/);
  });
});

describe("M3: no lossy normalize-and-retry", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("a 400 makes exactly one request and returns the API's details, not a re-rendered image", async () => {
    h.api.requests.length = 0;
    const spec = {
      ...baseCard("E400"),
      theme: "dark",
      header: { eyebrow: "X", title: "E400", badge: { text: "On track" } },
    };
    const r = await h.call("render_card", { spec });
    assert.equal(r.isError, true);
    assert.equal(r.image, undefined);
    assert.match(r.text, /theme: Expected object/);
    assert.doesNotMatch(r.text, /normaliz/i);
    assert.equal(requestsTo(h.api, RENDER).length, 1);
  });

  it("valid header fields (eyebrow, object badge, align) are sent untouched", async () => {
    h.api.requests.length = 0;
    const header = { eyebrow: "MRR", title: "$29,840", badge: { text: "On track", position: "end" }, align: "center" };
    const r = await h.call("render_card", { spec: { ...baseCard(), header } });
    assert.equal(r.isError, false);
    assert.deepEqual(requestsTo(h.api, RENDER)[0].body.header, header);
  });

  it("root labels/datasets are moved into data before the first request", async () => {
    h.api.requests.length = 0;
    const spec = {
      type: "bar",
      width: 800,
      height: 400,
      labels: ["Jan", "Feb"],
      datasets: [{ label: "S", data: [1, 2] }],
    };
    const r = await h.call("render_card", { spec });
    assert.equal(r.isError, false);
    const sent = requestsTo(h.api, RENDER);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.data, { labels: ["Jan", "Feb"], datasets: [{ label: "S", data: [1, 2] }] });
    assert.equal("labels" in sent[0].body, false);
    assert.equal("datasets" in sent[0].body, false);
  });

  it("render_card refuses format pdf before calling the API", async () => {
    h.api.requests.length = 0;
    const r = await h.call("render_card", { spec: { ...baseCard(), format: "pdf" } });
    assert.equal(r.isError, true);
    assert.match(r.text, /render_card_url/);
    assert.equal(requestsTo(h.api, RENDER).length, 0);
  });
});

describe("M7: bytes are checked against the response Content-Type", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("a card asked as svg that comes back as PNG is returned, not rejected", async () => {
    const r = await h.call("render_card", { spec: { ...baseCard("SVGCARD"), format: "svg" } });
    assert.equal(r.isError, false);
    assert.equal(r.image?.mimeType, "image/png");
    assert.match(r.text, /Asked for svg; cards are always returned as png/);
  });

  it("a redirect placeholder body is still rejected", async () => {
    const r = await h.call("render_card", { spec: baseCard("REDIRECTING") });
    assert.equal(r.isError, true);
    assert.match(r.text, /redirect placeholder/i);
  });
});
