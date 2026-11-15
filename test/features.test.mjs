// S1 waterfall, S2 new inputs, S4 usage/warnings/alt text, S6 brand kits, S7 repair mode.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { requestsTo, startHarness } from "./helpers.mjs";

const RENDER = "/api/v1/render";
const bar = { type: "bar", labels: ["A", "B"], datasets: [{ label: "S", data: [1, 2] }] };

describe("S2: named inputs reach the API under their API names", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("render_chart sends brand, textScale, annotations, dataLabels, colorblind_safe, alt_text, lang, header, kpiStrip, footer", async () => {
    h.api.requests.length = 0;
    const extras = {
      brand: "acme-dark",
      textScale: 1.5,
      annotations: [{ x: "A", label: "Spring sale" }, { y: 2, label: "Target" }],
      dataLabels: true,
      colorblind_safe: true,
      alt_text: true,
      lang: "en",
      header: { eyebrow: "E", title: "T", badge: { text: "On track", position: "end" }, align: "center" },
      kpiStrip: [{ label: "Customers", value: "312", color: "#fff" }],
      footer: { left: "L", right: "R", borderTop: true },
    };
    const r = await h.call("render_chart", { ...bar, ...extras });
    assert.equal(r.isError, false, r.text);
    const sent = requestsTo(h.api, RENDER)[0].body;
    for (const [key, value] of Object.entries(extras)) assert.deepEqual(sent[key], value, key);
    assert.equal("repair" in sent, false);
    assert.equal("repair_mode" in sent, false);
  });

  it("extensions merge first: named inputs win, core fields cannot be overridden", async () => {
    h.api.requests.length = 0;
    await h.call("render_chart", {
      ...bar,
      brand: "acme-dark",
      extensions: { brand: "other", type: "pie", theme: { mode: "dark" } },
    });
    const sent = requestsTo(h.api, RENDER)[0].body;
    assert.equal(sent.brand, "acme-dark");
    assert.equal(sent.type, "bar");
    assert.deepEqual(sent.theme, { mode: "dark" });
  });

  it("wrong shapes are refused locally (string badge, numeric KPI value)", async () => {
    h.api.requests.length = 0;
    const badge = await h.call("render_chart", { ...bar, header: { title: "T", badge: "On track" } });
    assert.equal(badge.isError, true);
    const kpi = await h.call("render_chart", { ...bar, kpiStrip: [{ label: "x", value: 12 }] });
    assert.equal(kpi.isError, true);
    assert.equal(requestsTo(h.api, RENDER).length, 0);
  });

  it("render_chart_ai sends brand", async () => {
    const pro = await startHarness({ key: "pk_test_pro" });
    try {
      const r = await pro.call("render_chart_ai", { description: "Pie chart: A 60%, B 40%", brand: "acme-dark" });
      assert.equal(r.isError, false, r.text);
      assert.equal(requestsTo(pro.api, "/api/v1/ai/render")[0].body.brand, "acme-dark");
    } finally {
      await pro.close();
    }
  });
});

describe("S4: usage, warnings and alt text in results", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("shows the usage line with the reset date", async () => {
    const r = await h.call("render_chart", bar);
    assert.match(r.text, /Usage: 412 of 1,000 renders this period \(resets 2026-12-01\)\./);
    assert.doesNotMatch(r.text, /Heads up/);
  });

  it("warns at 90% or more", async () => {
    const r = await h.call("render_chart", { ...bar, title: "NEARLIMIT" });
    assert.match(r.text, /Usage: 950 of 1,000/);
    assert.match(r.text, /Heads up: the allowance is almost used up\./);
  });

  it("decodes URL-encoded alt text and lists warnings", async () => {
    const r = await h.call("render_chart", { ...bar, alt_text: true });
    assert.match(r.text, /Alt text \(template\): A bar chart with 2 bars\. B is higher than A\./);
    assert.match(r.text, /Warnings: low_contrast/);
  });

  it("URL tools read warnings and alt text from the JSON", async () => {
    const r = await h.call("render_chart_url", { ...bar, alt_text: true });
    assert.match(r.text, /Chart URL: https:\/\/cdn\.example\/x\.png/);
    assert.match(r.text, /Alt text \(template\): A bar chart/);
    assert.match(r.text, /Warnings: low_contrast: Low contrast/);
  });
});

describe("S7: repair mode", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("sends repair_mode and reports repairs and warnings; the image is downloaded from image_url", async () => {
    h.api.requests.length = 0;
    const r = await h.call("render_chart", { ...bar, repair: "safe" });
    assert.equal(r.isError, false, r.text);
    assert.equal(requestsTo(h.api, RENDER)[0].body.repair_mode, "safe");
    assert.equal(r.image?.mimeType, "image/png");
    assert.match(r.text, /Repairs applied: DEFAULT_PALETTE_APPLIED: A default palette was applied\./);
    assert.match(r.text, /Warnings: low_contrast: Low contrast between text and background\./);
    assert.equal(requestsTo(h.api, "/cdn/r.png").length, 1);
  });

  it("the card tools take repair too", async () => {
    h.api.requests.length = 0;
    const spec = { type: "bar", data: { labels: ["A"], datasets: [{ data: [1] }] } };
    const url = await h.call("render_card_url", { spec, repair: "safe" });
    assert.equal(url.isError, false, url.text);
    assert.equal(requestsTo(h.api, RENDER)[0].body.repair_mode, "safe");
    const card = await h.call("render_card", { spec, repair: "off" });
    assert.equal(card.isError, false, card.text);
    assert.equal(requestsTo(h.api, RENDER)[1].body.repair_mode, "off");
  });

  it("a failure envelope shows code, path, fix, retryable and asks for a decision", async () => {
    const r = await h.call("render_card", {
      spec: { type: "bar", header: { title: "E400REPAIR" }, data: { labels: ["a", "b", "c"], datasets: [{ data: [1, 2] }] } },
      repair: "off",
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /400 LABEL_DATA_LENGTH_MISMATCH: labels has 3 entries but the dataset has 2 values\./);
    assert.match(r.text, /Path: data\.datasets\[0\]\.data/);
    assert.match(r.text, /Suggested fix: Add a third value or remove one label\./);
    assert.match(r.text, /Retryable: no\./);
    assert.match(r.text, /needs a decision from the user/);
  });

  it("without repair nothing is sent", async () => {
    h.api.requests.length = 0;
    await h.call("render_chart", bar);
    assert.equal("repair_mode" in requestsTo(h.api, RENDER)[0].body, false);
  });
});

describe("S1: render_waterfall", () => {
  const items = [
    { name: "Paid search", start: 18000, end: 23100 },
    { name: "Email", start: 9000, end: 11300 },
    { name: "Organic", start: 14000, end: 13100 },
    { name: "Referral", start: 5000, end: 5100 },
  ];
  const base = {
    title: "Revenue: October to November",
    metric: "revenue",
    start_label: "October",
    end_label: "November",
    number_format: { prefix: "$", maximumFractionDigits: 0 },
    items,
  };
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

  it("works on Free without explain: image, totals, change and drivers; sends devicePixelRatio, not scale or output", async () => {
    free.api.requests.length = 0;
    const r = await free.call("render_waterfall", { ...base, scale: 1, output: "image" });
    assert.equal(r.isError, false, r.text);
    assert.ok(r.image, "expected an inline image");
    assert.match(r.text, /Start October \$46,000 → End November \$52,600; change \+\$6,600 \(\+14\.3%\)\./);
    assert.match(r.text, /Drivers, largest first: Paid search \+\$5,100, Email \+\$2,300, Organic -\$900, Referral \+\$100/);
    assert.match(r.text, /Image: http:\/\/127\.0\.0\.1:\d+\/cdn\/w\.png/);
    const sent = requestsTo(free.api, "/api/v1/waterfall")[0].body;
    assert.equal(sent.returnUrl, true);
    assert.equal(sent.devicePixelRatio, 1);
    assert.equal("scale" in sent, false);
    assert.equal("output" in sent, false);
    assert.deepEqual(sent.items, items);
  });

  it("explain on Free is the 402 text with the metric and an upgrade link", async () => {
    free.api.requests.length = 0;
    const r = await free.call("render_waterfall", { ...base, explain: "template" });
    assert.equal(r.isError, true);
    assert.match(r.text, /402 quota_exceeded/);
    assert.match(r.text, /Allowance: waterfall — 0 of 0 used on the free plan/);
    assert.match(r.text, /Upgrade: https:/);
    assert.equal(requestsTo(free.api, "/api/v1/waterfall").length, 1);
  });

  it("explain on Pro returns the explanation with its source", async () => {
    const r = await pro.call("render_waterfall", { ...base, explain: "template", output: "url" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.image, undefined);
    assert.match(r.text, /Waterfall: revenue rose by 6600\.   \(source: template\)/);
    assert.match(r.text, /Image: /);
  });

  it("ai explain warnings are shown", async () => {
    const r = await pro.call("render_waterfall", { ...base, explain: "ai", output: "url" });
    assert.match(r.text, /Warnings: explanation_ai_unavailable: AI wording was not available/);
  });

  it("a total mismatch is a 400 that keeps the numbers", async () => {
    const r = await free.call("render_waterfall", { ...base, title: "E_MISMATCH", start_total: 100 });
    assert.equal(r.isError, true);
    assert.match(r.text, /400 start_total_mismatch: start_total 100 does not match the item starts \(90\)\./);
    assert.match(r.text, /Other: expected=90, actual=100, difference=10/);
  });

  it("the delta form with start_total is sent as given; mixing keys in one item is refused locally", async () => {
    free.api.requests.length = 0;
    const ok = await free.call("render_waterfall", {
      start_total: 100,
      items: [{ name: "A", delta: 5 }, { name: "B", delta: -2 }],
      output: "url",
    });
    assert.equal(ok.isError, false, ok.text);
    assert.equal(requestsTo(free.api, "/api/v1/waterfall")[0].body.start_total, 100);

    free.api.requests.length = 0;
    const bad = await free.call("render_waterfall", { items: [{ name: "A", start: 1, end: 2, delta: 1 }] });
    assert.equal(bad.isError, true);
    assert.equal(requestsTo(free.api, "/api/v1/waterfall").length, 0);
  });

  it("pdf is returned as a link without a download", async () => {
    pro.api.requests.length = 0;
    const r = await pro.call("render_waterfall", { ...base, format: "pdf" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.image, undefined);
    assert.match(r.text, /PDFs are not shown inline/);
    assert.equal(requestsTo(pro.api, "/cdn/w.png").length, 0);
  });
});

describe("S6: brand kits", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(async () => h.close());

  it("list_brand_kits shows one line per kit and the slug hint", async () => {
    const r = await h.call("list_brand_kits", {});
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /acme-dark \| Acme Dark \| ok \| #111111 #6ee7b7 #f59e0b \| Inter \| logo yes \| low_contrast/);
    assert.match(r.text, /acme-light \| Acme Light \| LOCKED/);
    assert.match(r.text, /Pass the slug as `brand`/);
  });

  it("create_brand_kit_from_url is a draft by default and sends save: false", async () => {
    h.api.requests.length = 0;
    const r = await h.call("create_brand_kit_from_url", { url: "https://acme.example" });
    assert.equal(r.isError, false, r.text);
    const sent = requestsTo(h.api, "/api/v1/brand-kits/from-url")[0].body;
    assert.equal(sent.save, false);
    assert.equal(sent.url, "https://acme.example");
    assert.match(r.text, /palette: #111111, #6ee7b7 \(confidence 0\.8, from css variables\)/);
    assert.match(r.text, /Draft only: nothing was saved/);
  });

  it("save: true says it was saved", async () => {
    const r = await h.call("create_brand_kit_from_url", { url: "https://acme.example", save: true, slug: "acme" });
    assert.match(r.text, /Saved to the account/);
  });

  it("402 names the url_extractions metric and is not retried", async () => {
    h.api.requests.length = 0;
    const r = await h.call("create_brand_kit_from_url", { url: "https://E402.example" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Allowance: url_extractions/);
    assert.equal(requestsTo(h.api, "/api/v1/brand-kits/from-url").length, 1);
  });
});
