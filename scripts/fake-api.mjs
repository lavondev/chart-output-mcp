#!/usr/bin/env node
/**
 * A tiny fake Chart-Output API (and marketing site) for offline tests. No network, no real key.
 *
 *   node scripts/fake-api.mjs [port]
 *   CHART_OUTPUT_BASE_URL=http://127.0.0.1:<port> CHART_OUTPUT_SITE_URL=http://127.0.0.1:<port> \
 *     CHART_OUTPUT_API_KEY=pk_test_dummy node build/index.js
 *
 * Behaviour is chosen by a marker anywhere in the request body (for example in header.title):
 *   E400 → 400 with details      E401 → 401           E402 → 402 quota_exceeded
 *   E403 → 403 plan_required     E404BRAND → 404 brand_kit_not_found
 *   E429 → 429 with Retry-After: 600                  E500 → 500
 *   FLAKY503 → 503 on the first call with that marker, then success
 *   E400REPAIR → repair_mode failure envelope          SLOWAI → /ai/render answers after 1.5 s
 *   NEARLIMIT → quota headers at 95%                  REDIRECTING → "Redirecting..." body
 * Without a marker the plan gate is emulated: a key containing "pro" is on Pro, any other key is Free,
 * and a request whose max(width, height) × scale is over the plan cap gets 403 resolution.
 * The site part serves /gallery.json and /gallery/<slug>/spec.json (only mrr-growth); anything under /empty/ is a 404 page.
 * Every request is recorded in `requests` so tests can assert which fields arrived.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

// 1x1 transparent PNG.
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const PLAN_CAP_PX = { free: 1200, pro: 3000 };
const UPGRADE = "https://www.chart-output.com/billing/upgrade?plan=pro";
const ALT = "A bar chart with 2 bars. B is higher than A.";

const GALLERY_REQUEST = {
  type: "line",
  width: 560,
  height: 640,
  devicePixelRatio: 2,
  format: "png",
  padding: "email",
  backgroundColor: "#0d1117",
  theme: { mode: "dark", textPrimary: "#f0f6fc" },
  header: { eyebrow: "MRR", title: "$29,840", subtitle: "Up 16% from last month" },
  kpiStrip: [{ label: "Customers", value: "312" }],
  data: { labels: ["Jan", "Feb", "Mar"], datasets: [{ label: "MRR", data: [14200, 17800, 20100], borderColor: "#6ee7b7" }] },
};

const GALLERY_INDEX = {
  name: "Chart-Output gallery",
  description: "Ready-made chart designs.",
  count: 3,
  note: "Fixture for tests.",
  // A hostile or stale endpoint: the MCP must never send the API key here.
  endpoint: { method: "POST", url: "https://evil.example/api/v1/render", auth: "Bearer", body: "request", freeRendersPerMonth: 1000 },
  jobs: [
    { id: "revenue", label: "Revenue", description: "Money in.", charts: ["mrr-growth", "revenue-by-plan"] },
    { id: "growth", label: "Growth", description: "Getting bigger.", charts: ["signups-by-channel"] },
  ],
  charts: [
    {
      slug: "mrr-growth",
      title: "MRR growth",
      job: "revenue",
      kind: "line",
      summary: "Monthly recurring revenue with a target line.",
      useWhen: "You want to show how MRR is trending.",
      shows: ["MRR by month", "target"],
      data: { columns: ["Month", "MRR", "Target"], rows: { min: 6, max: 12 }, numberColumns: { min: 1, max: 2 }, target: "optional", mustBeZeroOrMore: true, note: "Months in order." },
    },
    {
      slug: "revenue-by-plan",
      title: "Revenue by plan",
      job: "revenue",
      kind: "stacked bar",
      summary: "Revenue split by plan.",
      useWhen: "You compare plans over time.",
      shows: ["revenue per plan"],
      data: { columns: ["Month", "Starter", "Pro"], rows: { min: 3, max: 12 }, numberColumns: { min: 2, max: 4 } },
    },
    {
      slug: "signups-by-channel",
      title: "Signups by channel",
      job: "growth",
      kind: "bar",
      summary: "Where signups come from.",
      useWhen: "You want to compare channels.",
      shows: ["signups per channel"],
      data: { columns: ["Channel", "Signups"], rows: { min: 3, max: 8 }, numberColumns: { min: 1, max: 1 } },
    },
  ],
  links: { page: "https://www.chart-output.com/gallery", llms: "https://www.chart-output.com/llms.txt" },
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "x-request-id": "req_fake_123", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startFakeApi({ port = 0 } = {}) {
  const requests = [];
  const seen = new Map();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake.local");
    const origin = `http://${req.headers.host}`;
    const raw = req.method === "POST" ? await readBody(req) : "";
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* leave empty */
    }
    const auth = String(req.headers.authorization ?? "");
    requests.push({ method: req.method, path: url.pathname, body, authorization: auth, userAgent: req.headers["user-agent"] });
    const marker = raw;
    const plan = auth.includes("pro") ? "pro" : "free";
    const json = (status, payload, headers) => send(res, status, payload, headers);

    // ---- site: gallery ----------------------------------------------------------------------------
    if (url.pathname.startsWith("/empty/")) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<html>Not Found</html>");
    }
    if (req.method === "GET" && url.pathname === "/gallery.json") return json(200, GALLERY_INDEX);
    const spec = url.pathname.match(/^\/gallery\/([^/]+)\/spec\.json$/);
    if (req.method === "GET" && spec) {
      if (spec[1] !== "mrr-growth") return json(404, { error: `No gallery chart named ${spec[1]}` });
      const entry = GALLERY_INDEX.charts[0];
      return json(200, {
        ...entry,
        altText: "A line chart of MRR rising.",
        request: GALLERY_REQUEST,
        sampleData: { labels: ["Jan", "Feb", "Mar"], values: [14200, 17800, 20100] },
        howToChangeIt: "Replace data.labels and each datasets[].data, then update header and kpiStrip to match.",
        // Reference only: this one needs a saved kit that only the demo account has.
        brandKitRequest: { note: "reference only", request: { ...GALLERY_REQUEST, brand: "acme" }, withoutBrand: GALLERY_REQUEST },
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/cdn/")) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(TINY_PNG);
    }

    // ---- brand kits ---------------------------------------------------------------------------------
    if (req.method === "GET" && url.pathname === "/api/v1/brand-kits") {
      if (!auth) return json(401, { error: "Invalid API key" });
      return json(200, [
        { id: "k1", slug: "acme-dark", name: "Acme Dark", palette: ["#111111", "#6ee7b7", "#f59e0b"], fontFamily: "Inter", logoUrl: "https://cdn.example/logo.png", locked: false, warnings: [{ code: "low_contrast" }] },
        { id: "k2", slug: "acme-light", name: "Acme Light", palette: ["#ffffff", "#2563eb"], fontFamily: "Roboto", logoUrl: null, locked: true, warnings: [] },
      ]);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/brand-kits/from-url") {
      if (marker.includes("E402")) {
        return json(402, { error: "quota_exceeded", message: "No website extractions left this period.", metric: "url_extractions", limit: 1, used: 1, plan: "free", resets_at: "2026-12-01T00:00:00.000Z", upgrade_url: UPGRADE });
      }
      const draft = {
        draft: {
          name: { value: "Acme", confidence: 0.9, source: "og:site_name" },
          slug: { value: "acme", confidence: 0.7, source: "domain" },
          palette: { value: ["#111111", "#6ee7b7"], confidence: 0.8, source: "css variables" },
          fontFamily: { value: "Inter", confidence: 0.6, source: "font-family" },
        },
      };
      return body.save === true ? json(201, { ...draft, saved: true }) : json(200, draft);
    }

    // ---- waterfall ---------------------------------------------------------------------------------
    if (req.method === "POST" && url.pathname === "/api/v1/waterfall") {
      if (marker.includes("E_MISMATCH")) {
        return json(400, { error: "start_total_mismatch", message: "start_total 100 does not match the item starts (90).", expected: 90, actual: 100, difference: 10 });
      }
      if (body.explain && plan === "free") {
        return json(402, { error: "quota_exceeded", message: "Waterfall explanations are not included in the free plan.", metric: "waterfall", limit: 0, used: 0, plan: "free", resets_at: "2026-12-01T00:00:00.000Z", upgrade_url: UPGRADE });
      }
      const items = (body.items ?? []).map((i) => ({ name: i.name, delta: i.delta ?? i.end - i.start, start: i.start ?? 0 }));
      const startTotal = body.start_total ?? items.reduce((a, i) => a + i.start, 0);
      const change = items.reduce((a, i) => a + i.delta, 0);
      const drivers = [...items].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map((i) => ({ name: i.name, delta: i.delta }));
      return json(200, {
        image_url: `${origin}/cdn/w.png`,
        summary: {
          start_label: body.start_label ?? "Start",
          end_label: body.end_label ?? "End",
          start_total: startTotal,
          end_total: startTotal + change,
          change,
          change_pct: startTotal ? change / startTotal : 0, // a fraction, on purpose: the MCP computes its own percentage
          direction: change >= 0 ? "up" : "down",
          items,
          drivers,
          rises: drivers.filter((d) => d.delta > 0).length,
          falls: drivers.filter((d) => d.delta < 0).length,
        },
        ...(body.explain ? { explanation: `${body.metric ?? "The total"} rose by ${change}.`, explanation_source: "template" } : {}),
        warnings: body.explain === "ai" ? [{ code: "explanation_ai_unavailable", message: "AI wording was not available; template text used." }] : [],
      });
    }

    // ---- render + ai/render -------------------------------------------------------------------------
    if (req.method === "POST" && (url.pathname === "/api/v1/render" || url.pathname === "/api/v1/ai/render")) {
      const isAi = url.pathname.endsWith("/ai/render");

      if (marker.includes("E401")) return json(401, { error: "Invalid API key" });
      if (marker.includes("E429")) return json(429, { error: "Rate limit exceeded", retryAfter: 600 }, { "retry-after": "600" });
      if (marker.includes("FLAKY503")) {
        const count = (seen.get("FLAKY503") ?? 0) + 1;
        seen.set("FLAKY503", count);
        if (count === 1) return json(503, { error: "temporarily unavailable" });
      }
      if (marker.includes("E402")) {
        return json(
          402,
          {
            error: "quota_exceeded",
            message: "You have used 1000 of 1000 renders this period on the free plan.",
            metric: "renders",
            limit: 1000,
            used: 1000,
            plan: "free",
            resets_at: "2026-12-01T00:00:00.000Z",
            upgrade_url: UPGRADE,
          },
          { "x-quota-limit": "1000", "x-quota-used": "1000" }
        );
      }
      if (marker.includes("E403")) {
        return json(403, { error: "plan_required", message: "PDF output needs the Pro plan.", feature: "format:pdf", plan: "free", required_plan: "pro", upgrade_url: UPGRADE });
      }
      if (marker.includes("E404BRAND")) {
        return json(404, { error: "brand_kit_not_found", message: 'No brand kit with slug "does-not-exist".', brand: "does-not-exist", available: ["acme-dark", "acme-light"] });
      }
      if (marker.includes("E400REPAIR")) {
        return json(400, {
          ok: false,
          error: {
            code: "LABEL_DATA_LENGTH_MISMATCH",
            path: "data.datasets[0].data",
            message: "labels has 3 entries but the dataset has 2 values.",
            retryable: false,
            requires_decision: true,
            suggested_fix: "Add a third value or remove one label.",
          },
        });
      }
      if (marker.includes("E400")) {
        return json(400, {
          error: "Invalid chart specification",
          details: [
            { path: "theme", message: "Expected object, received string" },
            { path: ["data", "labels"], message: "At least 1 label is required" },
          ],
        });
      }
      if (marker.includes("E500")) return json(500, { error: "boom" });

      if (isAi) {
        if (plan === "free") {
          return json(403, { error: "plan_required", message: "Plain-English charts need the Pro plan.", feature: "ai_renders", plan: "free", required_plan: "pro", upgrade_url: UPGRADE });
        }
        if (marker.includes("SLOWAI")) await wait(1500);
        res.writeHead(200, {
          "content-type": "image/png",
          "x-ai-chart-type": "bar",
          "x-ai-generation-ms": "812",
          "x-ai-renders-used": "3",
          "x-ai-renders-limit": "100",
          "x-ai-renders-remaining": "97",
          "x-quota-limit": "25000",
          "x-quota-used": "412",
        });
        return res.end(TINY_PNG);
      }

      // Plan gate: max(width, height) × scale against the plan cap.
      const scale = Number(body.scale ?? body.devicePixelRatio ?? 1);
      const edge = Math.max(Number(body.width ?? 800), Number(body.height ?? 400)) * scale;
      if (edge > PLAN_CAP_PX[plan]) {
        return json(403, {
          error: "plan_required",
          message: `Output of ${edge}px is above the ${plan} plan limit of ${PLAN_CAP_PX[plan]}px.`,
          feature: "resolution",
          plan,
          required_plan: "pro",
          upgrade_url: UPGRADE,
        });
      }

      const used = marker.includes("NEARLIMIT") ? "950" : "412";
      const quotaHeaders = { "x-quota-limit": "1000", "x-quota-used": used, "x-quota-reset": "2026-12-01T00:00:00.000Z" };

      // repair_mode answers with a JSON envelope pointing at the image.
      if (body.repair_mode) {
        return json(
          200,
          {
            ok: true,
            image_url: `${origin}/cdn/r.png`,
            repairs_applied: [{ code: "DEFAULT_PALETTE_APPLIED", message: "A default palette was applied." }],
            warnings: [{ code: "low_contrast", path: "theme", message: "Low contrast between text and background.", action: "none" }],
            normalized_config: {},
          },
          quotaHeaders
        );
      }
      if (body.returnUrl === true) {
        return json(
          200,
          {
            url: "https://cdn.example/x.png",
            warnings: [{ code: "low_contrast", path: "theme", message: "Low contrast", action: "none" }],
            ...(body.alt_text ? { alt_text: ALT, alt_text_source: "template" } : {}),
          },
          quotaHeaders
        );
      }
      if (marker.includes("REDIRECTING")) {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end("Redirecting...");
      }
      // A card (header, kpiStrip, footer, border...) asked as svg comes back as PNG, like the real API.
      const headers = { "content-type": "image/png", "x-request-id": "req_fake_123", ...quotaHeaders };
      if (body.alt_text) {
        headers["x-chart-alt-text"] = encodeURIComponent(ALT);
        headers["x-chart-alt-text-source"] = "template";
        headers["x-chart-warnings"] = "low_contrast";
      }
      res.writeHead(200, headers);
      return res.end(TINY_PNG);
    }

    json(404, { error: "not found in fake api", path: url.pathname });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    port: actualPort,
    baseUrl: `http://127.0.0.1:${actualPort}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const api = await startFakeApi({ port: Number(process.argv[2] ?? 4010) });
  console.log(`fake Chart-Output API on ${api.baseUrl}`);
}
