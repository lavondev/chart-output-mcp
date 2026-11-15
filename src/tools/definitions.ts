import { z } from "zod";

const SIZE_CAP_NOTE =
  "The longest edge × scale must fit your plan: 1200 px on Free, 3000 px on Pro and Agency (the API answers 403 above that).";

export const extensionsSchema = z
  .record(z.unknown())
  .optional()
  .describe(
    'Optional extra POST /api/v1/render fields, merged first and then overridden by type/labels/datasets/width/height/format. Shapes: header {eyebrow?, title?, subtitle?, badge? {text, backgroundColor?, color?, borderRadius?, position? "start"|"end"}, align?, logoUrl?}, kpiStrip [{label, value, color?}] (max 12, value is a string), footer {left?, right?, borderTop?}, theme {palette?, backgroundColor?, fontFamily?, fontSize?, gridColor?, mode? "light"|"dark", textPrimary?, textSecondary?} (an object, never a string), legend, border {color, width}, borderRadius, backgroundColor, padding, brandKitId, brand, options (partial Chart.js options). Do not send returnUrl.'
  );

const chartTypeSchema = z
  .enum(["line", "bar", "pie", "doughnut", "radar", "polarArea"])
  .describe(
    'Chart type. Use "bar" or "line" for time-series and comparisons. Use "pie" or "doughnut" for proportions (best with ≤7 categories). Use "radar" for multi-axis comparisons across uniform scales. Use "polarArea" for relative magnitude without a common baseline. Example: "bar".'
  );

const chartTypeUrlSchema = z
  .enum(["line", "bar", "pie", "doughnut", "radar", "polarArea"])
  .describe(
    'Chart type. Use "bar" or "line" for time-series and comparisons. Use "pie" or "doughnut" for proportions (best with ≤7 categories). Use "radar" for multi-axis comparisons. Use "polarArea" for relative magnitude. Example: "line".'
  );

const labelsSchema = z
  .array(z.string())
  .describe(
    'Category labels or x-axis tick labels (1–1000). Keep the array the same length as every dataset\'s data array. The API does not reject a mismatch by default; the chart renders with gaps or missing labels. Example: ["Jan", "Feb", "Mar"] or ["Product A", "Product B", "Product C"].'
  );

const labelsUrlSchema = z
  .array(z.string())
  .describe(
    'Category labels or x-axis tick labels (1–1000). Keep the array the same length as every dataset\'s data array (a mismatch is not rejected by default; the chart renders with gaps). Example: ["Jan", "Feb", "Mar"] or ["Product A", "Product B"].'
  );

const colorOrColors = z.union([z.string(), z.array(z.string())]);
const pointSchema = z
  .object({ x: z.union([z.string(), z.number()]), y: z.number().nullable() })
  .passthrough();
const dataValueSchema = z.union([z.number(), z.null(), pointSchema, z.tuple([z.number(), z.number()])]);

// One dataset schema for the inline and URL tools. It must NOT strip unknown keys: fill, tension,
// stack, yAxisID, dataset-level type and per-dataset datalabels are what make stacked bars, area
// lines and bar + line mixes possible.
const chartDatasetSchema = z
  .object({
    label: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Series name shown in the chart legend. Example: "Revenue" or "Active Users". Omit for single-series pie/doughnut charts.'
      ),
    data: z
      .array(dataValueSchema)
      .min(1)
      .max(1000)
      .describe(
        "Values, one per label entry (same length as the top-level labels array, up to 1000). Each item is a number, null (a gap), {x, y}, or [from, to] (a floating bar, used for ranges, bridges and waterfalls). Example: [12000, 15000, 18000, 22000]."
      ),
    backgroundColor: colorOrColors
      .optional()
      .describe(
        'Fill color(s). Pass a single CSS color string for bar/line series or an array of colors (one per slice) for pie/doughnut. Accepts hex, rgb(), rgba(), or named colors. In a stacked bar, series after the first with a plain #rrggbb color are drawn at 70% opacity; use rgba(r,g,b,1) for the exact color. Example: "#4F81BD" or ["#FF6384","#36A2EB","#FFCE56"].'
      ),
    borderColor: colorOrColors
      .optional()
      .describe(
        'Border/stroke color(s). Same format as backgroundColor. Commonly used for line charts to set the line color. Example: "#2c5f8a".'
      ),
    borderWidth: z.number().min(0).max(20).optional().describe("Border / line width in pixels (0–20)."),
    fill: z
      .union([z.boolean(), z.number(), z.string()])
      .optional()
      .describe("Line charts: true fills the area under the line (an area chart)."),
    tension: z.number().min(0).max(1).optional().describe("Line charts: curve smoothing, 0 (straight) to 1."),
    borderDash: z
      .array(z.number())
      .optional()
      .describe("Dashed line pattern, e.g. [6, 4]. The second line series is dashed automatically; set [] to keep it solid."),
    pointRadius: z.union([z.number(), z.array(z.number())]).optional().describe("Line charts: point size in pixels; 0 hides points."),
    borderRadius: z
      .number()
      .optional()
      .describe(
        "Corner radius in pixels for bar chart bars. Use 4–8 for a modern rounded look. Ignored for non-bar chart types. Example: 6."
      ),
    stack: z.string().optional().describe('Bar charts: datasets with the same stack id are stacked together. Example: "a".'),
    yAxisID: z.string().optional().describe('Which y axis the series uses, e.g. "y1" for a second axis in a bar + line mix.'),
    hidden: z.boolean().optional().describe("Hide the series."),
    type: z
      .enum(["line", "bar"])
      .optional()
      .describe('Dataset-level type for a bar + line mix (usually with a second yAxisID). Example: "line".'),
  })
  .passthrough();

const chartDatasetsSchema = z
  .array(chartDatasetSchema)
  .describe(
    'Array of data series (1–20). Each entry represents one line, bar group, or set of slices. Other Chart.js dataset keys (pointBackgroundColor, barPercentage, datalabels, …) pass through. Example: [{ label: "Revenue", data: [100, 200, 150], backgroundColor: "#4F81BD" }]. For pie/doughnut, use one dataset with an array of backgroundColor values.'
  );

const widthSchema = z
  .number()
  .min(100)
  .max(4000)
  .default(800)
  .optional()
  .describe(
    `Output image width in pixels. Range: 100–4000. Default: 800. ${SIZE_CAP_NOTE} Common values: 400 for thumbnails, 800 for standard dashboards, 1200 for wide layouts.`
  );

const widthUrlSchema = z
  .number()
  .min(100)
  .max(4000)
  .default(800)
  .optional()
  .describe(
    `Output image width in pixels. Range: 100–4000. Default: 800. ${SIZE_CAP_NOTE} Use 1200 for widescreen, 400 for thumbnail embeds.`
  );

const heightSchema = z
  .number()
  .min(100)
  .max(4000)
  .default(400)
  .optional()
  .describe(
    `Output image height in pixels. Range: 100–4000. Default: 400. ${SIZE_CAP_NOTE} Common values: 400 for landscape charts, 500–600 for portrait or square pie charts, 300 for compact sparklines.`
  );

const heightUrlSchema = z
  .number()
  .min(100)
  .max(4000)
  .default(400)
  .optional()
  .describe(
    `Output image height in pixels. Range: 100–4000. Default: 400. ${SIZE_CAP_NOTE} Use 400 for landscape, 500–600 for square or portrait charts.`
  );

const scaleSchema = z
  .number()
  .min(1)
  .max(4)
  .optional()
  .describe(
    `Pixel density multiplier for sharper (retina) output, 1–4. Default: 1. ${SIZE_CAP_NOTE} On a Free plan keep scale at 1 unless width and height are both 600 or less.`
  );

const titleSchema = z
  .string()
  .optional()
  .describe(
    'Optional chart title rendered at the top of the chart. Omit if no title is needed. Example: "Monthly Active Users 2024".'
  );

const titleUrlSchema = z
  .string()
  .optional()
  .describe(
    'Optional chart title rendered at the top of the image. Example: "Q1–Q4 Revenue 2024". Omit if untitled.'
  );

const formatSchema = z
  .enum(["png", "jpeg", "webp", "svg"])
  .default("png")
  .optional()
  .describe(
    'Output image format. "png" (default) — lossless, best for general use and screenshots. "jpeg" — smaller file size, lossy, good for photo-heavy backgrounds. "webp" — modern format, smaller than png with good quality. "svg" — scalable vector, ideal for embedding in web pages where resolution independence matters. (PDF is only available through render_chart_url.)'
  );

const formatUrlSchema = z
  .enum(["png", "jpeg", "webp", "svg", "pdf"])
  .default("png")
  .optional()
  .describe(
    'Output format of the file at the returned URL. "png" (default) — lossless, universally supported. "jpeg" — smaller file, lossy. "webp" — modern, compact. "svg" — scalable vector, ideal for web embeds. "pdf" — needs a Pro or Agency plan.'
  );

const brandSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(48)
  .optional()
  .describe(
    'Slug of a saved brand kit (call list_brand_kits to see them), for example "acme-dark". Applies the kit\'s palette, fonts and logo. Colors you send yourself (dataset colors, theme) win over the kit. An unknown slug is a 404 that lists the real ones. Preset kits (obsidian, linen, polar, studio, ember, harbor) go in extensions.brandKitId instead.'
  );

const textScaleSchema = z
  .number()
  .min(1)
  .max(2)
  .optional()
  .describe("Makes all text on a card bigger (header, legend, ticks, KPIs, footer), 1–2. Use for small charts or low vision.");

const annotationsSchema = z
  .array(z.record(z.unknown()))
  .max(25)
  .optional()
  .describe(
    'Event markers. Works only on line and bar charts with a category x-axis (not pie, doughnut, radar or polarArea, and not options.indexAxis "y"). Shapes: {x: "Mar", label: "Spring sale"} (vertical line), {x_start: "May", x_end: "Jun", style: "band", label: "Outage"} (shaded band), {y: 30000, label: "Target"} (horizontal line). Labels are cut at 30 characters. At most 10 per chart on Free, 25 on paid plans (more is a 400). Markers that cannot be placed are skipped and reported as warnings.'
  );

const dataLabelsSchema = z
  .boolean()
  .optional()
  .describe(
    "true draws value labels on the chart. Number style (prefix, suffix, signed, share, maximumFractionDigits) goes in options.plugins.datalabels.numberFormat; pass options through extensions."
  );

const colorblindSchema = z.boolean().optional().describe("true switches to a color-blind-safe palette.");

const altTextSchema = z
  .union([z.boolean(), z.literal("ai")])
  .optional()
  .describe(
    'true returns a free template description of the chart (alt text) with the result. "ai" asks for a written description, which uses the plan\'s AI alt-text allowance and falls back to the template with a warning when it is used up. Useful when the reader cannot see the image.'
  );

const langSchema = z.string().max(35).optional().describe('BCP 47 language tag for generated text such as alt text, e.g. "en".');

const headerSchema = z
  .object({
    eyebrow: z.string().max(200).optional(),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(200).optional(),
    badge: z.object({ text: z.string().max(100) }).passthrough().optional(),
    align: z.enum(["left", "center"]).optional(),
    logoUrl: z.string().optional(),
    logoHeight: z.number().optional(),
    logoAlign: z.enum(["left", "right"]).optional(),
  })
  .passthrough()
  .optional()
  .describe(
    'Card header: {eyebrow?, title?, subtitle? (each up to 200 chars), badge? {text, backgroundColor?, color?, borderRadius?, position? "start"|"end"} (an object, never a string), align? "left"|"center", logoUrl? (https), logoHeight?, logoAlign? "left"|"right"}. Any header, kpiStrip, footer, border or legend turns the output into a card (always PNG).'
  );

const kpiStripSchema = z
  .array(
    z
      .object({ label: z.string().max(100), value: z.string().max(100), color: z.string().optional() })
      .passthrough()
  )
  .max(12)
  .optional()
  .describe('KPI row under the header: up to 12 items {label, value, color?}. value is a string such as "$29,840". There is no delta field.');

const footerSchema = z
  .object({ left: z.string().max(500).optional(), right: z.string().max(500).optional(), borderTop: z.unknown().optional() })
  .passthrough()
  .optional()
  .describe("Card footer: {left?, right?, borderTop?}. There is no text field.");

const repairSchema = z
  .enum(["safe", "off"])
  .optional()
  .describe(
    'Opt in to the API\'s own repair mode (sent as repair_mode). "safe" fixes harmless problems without losing data (sorts {x,y} points, normalises colors, applies a default palette) and reports each repair. "off" only checks and returns a precise error with a suggested fix; it is the only way to catch labels/data length mismatches. Leave unset for the normal behavior. Set "safe" when you are unsure about your data. If an error says a decision is needed, ask the user.'
  );

/** Optional chart inputs shared by render_chart and render_chart_url. Names match the API. */
export const chartExtraFields = {
  header: headerSchema,
  kpiStrip: kpiStripSchema,
  footer: footerSchema,
  brand: brandSchema,
  textScale: textScaleSchema,
  annotations: annotationsSchema,
  dataLabels: dataLabelsSchema,
  colorblind_safe: colorblindSchema,
  alt_text: altTextSchema,
  lang: langSchema,
  repair: repairSchema,
};

const CARD_FIELDS = `Top-level fields: \`type\`, \`data {labels, datasets}\`, \`options\`, \`width\`/\`height\` (100–4000), \`format\`, \`scale\` (1–4), \`header {eyebrow?, title?, subtitle?, badge? {text, backgroundColor?, color?, borderRadius?, position? "start"|"end"}, align? "left"|"center", logoUrl?, logoHeight?, logoAlign?}\`, \`legend {display?, position? "top"|"bottom", style? "square"|"line"|"circle", fontSize?, gap?}\`, \`kpiStrip [{label, value, color?}]\` (max 12, value is a string), \`footer {left?, right?, borderTop?}\`, \`theme {palette?, backgroundColor?, fontFamily?, fontSize?, gridColor?, mode? "light"|"dark", textPrimary?, textSecondary?}\` (an object, never a string), \`border {color, width}\`, \`borderRadius\`, \`backgroundColor\`, \`padding\` ("email"|"slack"|"pdf"), \`brand\` (saved brand kit slug), \`brandKitId\` (preset name or UUID), \`textScale\` (1–2), \`annotations\`, \`dataLabels\` (true/false), \`alt_text\` (true or "ai"). ${SIZE_CAP_NOTE}`;

const cardSpecSchema = z
  .record(z.unknown())
  .describe(
    `Full POST /api/v1/render body. Start from get_chart_example and change values. ${CARD_FIELDS} Do not send \`returnUrl\`.`
  );

const cardUrlSpecSchema = z
  .record(z.unknown())
  .describe(
    `Full POST /api/v1/render body. Start from get_chart_example and change values. ${CARD_FIELDS} \`format\` may be "pdf" (Pro or Agency). returnUrl is handled by this tool automatically.`
  );

const ERRORS_TEXT = `Errors (the message is plain text and keeps the API's details): 400 — invalid spec; every failing field is listed with its path. 401 — API key missing or invalid. 402 — monthly allowance used up; do NOT retry, tell the user (the message has the reset date and an upgrade link). 403 — the plan does not include something you used (pdf, a size above the plan cap, a brand kit over the limit); do NOT retry the same request, tell the user. 404 — unknown brand slug (the message lists the available ones). 429 — rate-limited; wait for Retry-After. Network error — chart-output.com is unreachable or timed out.`;

export const toolDefinitions = {
  renderChart: {
    name: "render_chart",
    description: `Render a Chart.js-style chart from structured labels and datasets and return it as an inline base64-encoded image.

Use this tool when: you have pre-structured numeric data with explicit labels and datasets; you want a simple chart (line, bar, pie, doughnut, radar, polarArea) returned directly as an image in chat; you want to optionally add Chart-Output dashboard extras (dark background, KPI strip, header, footer) via the extensions field without building a full card spec by hand.
Do NOT use this tool when: you need a public link to embed in HTML or email → use render_chart_url instead; you have raw or natural-language data without structured labels/datasets → use render_chart_ai instead; you need a full branded card with header, footer, KPI strip, and theme → use render_card instead.
Behavior: this tool makes a remote API call to Chart-Output and may consume render credits. Free-plan images carry a small watermark.

Datasets keep every key you send (fill, tension, borderDash, stack, yAxisID, a dataset-level type for bar + line mixes, per-dataset datalabels). Data items can be numbers, null (a gap), {x, y} or [from, to] (floating bars).

Returns: an inline base64 image at the requested dimensions and format, plus a confirmation text string showing actual width×height and format.
${ERRORS_TEXT}
Example: render_chart({ type: "bar", labels: ["Q1","Q2","Q3","Q4"], datasets: [{ label: "Revenue", data: [12000, 15000, 18000, 22000], backgroundColor: "#4F81BD" }], title: "2024 Revenue", width: 800, height: 400 })`,
    inputSchema: {
      type: chartTypeSchema,
      labels: labelsSchema,
      datasets: chartDatasetsSchema,
      width: widthSchema,
      height: heightSchema,
      scale: scaleSchema,
      title: titleSchema,
      format: formatSchema,
      ...chartExtraFields,
      extensions: extensionsSchema,
    },
  },
  renderChartUrl: {
    name: "render_chart_url",
    description: `Render a Chart.js-style chart from structured labels and datasets and return a public CDN link instead of image bytes.

Use this tool when: you need to embed a chart in an HTML page, markdown document, or email via an <img> src attribute; you need to pass a chart URL to another tool or API; you want a PDF (Pro or Agency); you want to avoid sending large base64 image blobs in the conversation.
Do NOT use this tool when: you want the image displayed inline in chat → use render_chart instead; you have raw or natural-language data → use render_chart_ai instead; you need a full branded card → use render_card_url instead.
Behavior: this tool makes a remote API call to Chart-Output, may consume render credits, and returns a publicly accessible CDN link. Free-plan images carry a small watermark.

Datasets keep every key you send (fill, tension, borderDash, stack, yAxisID, a dataset-level type for bar + line mixes, per-dataset datalabels). Data items can be numbers, null (a gap), {x, y} or [from, to] (floating bars).

Returns: a plain text string containing a single HTTPS link to the rendered chart (e.g. "https://cdn.chart-output.com/..."). The link is publicly accessible.
${ERRORS_TEXT}
Example: render_chart_url({ type: "line", labels: ["Jan","Feb","Mar"], datasets: [{ label: "MAU", data: [12000, 18000, 24000] }], title: "Monthly Active Users" }) → "https://cdn.chart-output.com/abc123.png"`,
    inputSchema: {
      type: chartTypeUrlSchema,
      labels: labelsUrlSchema,
      datasets: chartDatasetsSchema,
      width: widthUrlSchema,
      height: heightUrlSchema,
      scale: scaleSchema,
      title: titleUrlSchema,
      format: formatUrlSchema,
      ...chartExtraFields,
      extensions: extensionsSchema,
    },
  },
  renderCard: {
    name: "render_card",
    description: `Render a full branded card composition — header, KPI strip, chart, and footer — and return it as an inline base64-encoded image.

Use this tool when: you need a production-grade dashboard layout with a header (title, subtitle, badge), KPI metric row, themed background, footer, or brand kit; you want to send the full /api/v1/render JSON body verbatim to Chart-Output.
Do NOT use this tool when: you only need a simple chart without branding → use render_chart instead; you need a link rather than inline bytes (or a PDF) → use render_card_url for full branded cards or render_chart_url for simple charts; you have natural-language data → use render_chart_ai instead.
Behavior: this tool makes a remote API call to Chart-Output and may consume render credits. The spec is sent once, exactly as you give it; nothing is rewritten or retried. Cards are always returned as PNG, even if you ask for svg. Free-plan images carry a small watermark.

IMPORTANT — start from an example spec: call get_chart_example("mrr-breakdown") (or list_chart_output_examples to browse all ids) and change values only. Do not hand-write the full spec from memory. Keep labels and every dataset's data the same length (a mismatch is not rejected by default; the chart renders with gaps).

Returns: an inline base64 image at the format and dimensions defined in the spec, plus a confirmation text string with dimensions and format.
${ERRORS_TEXT} A 400 for a field such as theme means that exact field is wrong; fix it and call again.
Limitations: does not support returnUrl or format "pdf"; inline image only. For the full field reference see https://www.chart-output.com/docs/card-composition.
Example: render_card({ spec: { ...get_chart_example("mrr-breakdown"), header: { title: "Q1 Report" } } })`,
    inputSchema: {
      spec: cardSpecSchema,
      repair: repairSchema,
    },
  },
  renderCardUrl: {
    name: "render_card_url",
    description: `Render a full branded card composition — header, KPI strip, chart, and footer — and return a public CDN link instead of image bytes.

Use this tool when: you need an openable, shareable, or downloadable link (or a PDF) for a production-grade dashboard layout with a header, KPI metric row, themed background, footer, or brand kit; you want to send the full /api/v1/render JSON body verbatim to Chart-Output.
Do NOT use this tool when: you want the image displayed inline in chat → use render_card instead; you only need a simple Chart.js labels/datasets chart → use render_chart_url instead; you have natural-language data → use render_chart_ai instead.
Behavior: this tool makes a remote API call to Chart-Output, may consume render credits, and returns a publicly accessible CDN link. The spec is sent once, exactly as you give it; nothing is rewritten or retried. Free-plan images carry a small watermark.

IMPORTANT — start from an example spec: call get_chart_example("mrr-breakdown") (or list_chart_output_examples to browse all ids) and change values only. Do not hand-write the full spec from memory. Keep labels and every dataset's data the same length (a mismatch is not rejected by default; the chart renders with gaps).

Returns: a plain text string containing a single HTTPS link to the rendered card. The link is publicly accessible.
${ERRORS_TEXT} A 400 for a field such as theme means that exact field is wrong; fix it and call again.
Example: render_card_url({ spec: { ...get_chart_example("mrr-breakdown"), header: { title: "Q1 Report" } } }) → "https://cdn.chart-output.com/abc123.png"`,
    inputSchema: {
      spec: cardUrlSpecSchema,
      repair: repairSchema,
    },
  },
  renderChartAi: {
    name: "render_chart_ai",
    description: `Generate a chart from a natural language description and optional raw data, and return it as an inline base64-encoded image. Chart-Output's AI layer selects the chart type, builds the spec, and renders automatically.

Use this tool when: you have natural-language data or a plain description without pre-structured labels/datasets; you want Chart-Output to pick the best chart type automatically; you have raw tabular data (JSON array or CSV) and want a chart without manually extracting labels and datasets.
Do NOT use this tool when: you already have structured labels and datasets → use render_chart or render_chart_url instead; you need SVG or PDF output → those formats are not exposed by this tool; you need custom Chart.js options or extensions → use render_chart with extensions instead.
Behavior: this tool makes a remote API call to Chart-Output's AI endpoint and may consume render credits. Requires a Pro or Agency plan; it also has its own monthly allowance.

Returns: an inline base64 image. The response text reports the AI-selected chart type and generation time in milliseconds.
Errors: 401 — CHART_OUTPUT_API_KEY is missing or invalid. 403 — the plan does not include plain-English charts (the Free plan does not; Pro and Agency do); do NOT retry, tell the user and share the upgrade link. 402 — the monthly allowance for AI charts is used up; do NOT retry, tell the user. 400 — description is empty or data is malformed. 422 — the AI could not build a chart from this description; rephrase it or pass data. 429 — rate-limited; wait for Retry-After. Network error — chart-output.com is unreachable or timed out.
Limitations: only png, jpeg or webp. Custom Chart.js options, extensions, headers, and KPI strips are not available — use render_chart or render_card for those. Requires a Pro or Agency plan.
Example: render_chart_ai({ description: "Monthly revenue for 2024 as a green bar chart, growing from 12k in Jan to 28k in Dec", width: 800, height: 400 })`,
    inputSchema: {
      description: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          'Natural-language description of the desired chart. Be specific about chart type, colors, and key trends for best results. Optionally specify axis labels and units. Examples: "Monthly revenue for 2024 growing from 12k to 28k, use a green bar chart" or "Pie chart of market share: Android 72%, iOS 27%, Other 1%". Max 2000 characters.'
        ),
      data: z
        .union([z.array(z.record(z.unknown())), z.string()])
        .optional()
        .describe(
          'Optional raw data for the AI to use when building the chart. Accepts either a JSON array of objects (e.g. [{"month":"Jan","revenue":12000},{"month":"Feb","revenue":15000}]) or a CSV string (e.g. "month,revenue\\nJan,12000\\nFeb,15000"). If omitted, the AI generates plausible data from the description alone. Providing real data yields more accurate charts.'
        ),
      width: widthUrlSchema.describe(
        `Output image width in pixels. Range: 100–4000. Default: 800. ${SIZE_CAP_NOTE} Use 1200 for widescreen dashboards, 400 for compact embeds.`
      ),
      height: heightUrlSchema.describe(
        `Output image height in pixels. Range: 100–4000. Default: 400. ${SIZE_CAP_NOTE} Use 400 for landscape, 500–600 for square or portrait layouts.`
      ),
      format: z
        .enum(["png", "jpeg", "webp"])
        .default("png")
        .optional()
        .describe(
          'Output image format. "png" (default) — lossless, best for general use. "jpeg" — smaller file size, lossy. "webp" — modern format with good compression. SVG and PDF are not exposed by this tool; use render_chart or render_chart_url for those.'
        ),
      brand: brandSchema,
    },
  },
  renderWaterfall: {
    name: "render_waterfall",
    description: `Explain a change between two periods as a waterfall chart plus a plain-language summary. The chart shows the start total, the 8 biggest movers (the rest become one "Other (n)" bar) and the end total, inside a card with a start / end / change KPI strip.

Use this tool when: the user asks what changed between two periods (revenue October to November, headcount, signups by channel) and you have a before and after value for each item, or the change of each item.
Do NOT use this tool when: you just want a chart of values → use render_chart; you need a reason. The explanation says WHAT changed, never WHY. Do not add causes the data does not show.

Items: give every item as {name, start, end}, OR every item as {name, delta} together with start_total. Do not mix the two. Names must be unique (case-insensitive), 1–100 items. start_total and end_total are optional checks when items use start/end. Numbers that do not add up are a 400 that shows the numbers and the difference; nothing is silently fixed.
explain: true, "template" or "ai" adds a written explanation and uses one waterfall allowance. The Free plan has none, so explain on Free is a 402. The chart alone works on Free. "ai" text is checked against the data; if it is rejected you get the template text and a warning. Template wording is English only.
output: "image" (default) returns the chart inline plus the text; "url" returns text with the image link. PDF is always returned as a link (Pro or Agency).

Returns: text with the explanation, start and end totals, the change, the drivers (largest first), the image link and any warnings; plus the image unless output is "url".
${ERRORS_TEXT}
Example: render_waterfall({ title: "Revenue: October to November", metric: "revenue", start_label: "October", end_label: "November", number_format: { prefix: "$", maximumFractionDigits: 0 }, items: [{ name: "Paid search", start: 18000, end: 23100 }, { name: "Email", start: 9000, end: 11300 }, { name: "Organic", start: 14000, end: 13100 }] })`,
    inputSchema: {
      title: z.string().max(120).optional().describe("Chart title."),
      metric: z.string().max(40).optional().describe('What is measured, e.g. "revenue". Used in the explanation sentence.'),
      start_label: z.string().min(1).max(40).optional().describe('Label of the first period. Default "Start".'),
      end_label: z.string().min(1).max(40).optional().describe('Label of the second period. Default "End".'),
      items: z
        .array(
          z.union([
            z.object({ name: z.string().min(1).max(60), start: z.number(), end: z.number() }).strict(),
            z.object({ name: z.string().min(1).max(60), delta: z.number() }).strict(),
          ])
        )
        .min(1)
        .max(100)
        .describe(
          "1–100 items. Either all {name, start, end} or all {name, delta} (then start_total is required). Names unique, up to 60 characters."
        ),
      start_total: z.number().optional().describe("Required when items use delta. Optional check when items use start/end."),
      end_total: z.number().optional().describe("Optional check that the items add up to this."),
      number_format: z
        .object({
          prefix: z.string().max(4).optional(),
          suffix: z.string().max(8).optional(),
          maximumFractionDigits: z.number().int().min(0).max(4).optional(),
        })
        .strict()
        .optional()
        .describe('How numbers are written, e.g. {prefix: "$", maximumFractionDigits: 0}.'),
      explain: z
        .union([z.boolean(), z.enum(["template", "ai"])])
        .optional()
        .describe("Add a written explanation. Uses one waterfall allowance (none on Free: that is a 402)."),
      lang: z.string().max(35).optional().describe("BCP 47 language tag. Template wording is English only."),
      brand: brandSchema,
      format: z.enum(["png", "jpeg", "webp", "svg", "pdf"]).optional().describe("Image format. Default png. pdf needs Pro or Agency and is returned as a link."),
      width: z.number().int().min(320).max(4000).optional().describe(`Width in pixels, 320–4000. Default 800. ${SIZE_CAP_NOTE}`),
      height: z.number().int().min(240).max(4000).optional().describe("Height in pixels, 240–4000. Default 480."),
      scale: z
        .number()
        .min(1)
        .max(4)
        .optional()
        .describe("Pixel density 1–4 (sent as devicePixelRatio). If you leave it out the API uses 2 where your plan allows, else 1."),
      textScale: textScaleSchema,
      output: z.enum(["image", "url"]).optional().describe('"image" (default) returns the chart inline. "url" returns only text and the link.'),
    },
  },
  listBrandKits: {
    name: "list_brand_kits",
    description: `List the saved brand kits on the Chart-Output account that owns the API key.

Use this tool when: the user wants charts in their own brand, or you need a valid slug for the "brand" field. Read-only; it does not use any render allowance.

Returns: one line per kit: slug | name | locked | palette | font | logo | warnings. Pass the slug as "brand" in render_chart, render_chart_url, render_card, render_card_url, render_chart_ai or render_waterfall. A locked kit is over the plan's kit limit; rendering with it is a 403. The list can be empty (the Free plan has one kit).
${ERRORS_TEXT}`,
  },
  createBrandKitFromUrl: {
    name: "create_brand_kit_from_url",
    description: `Draft a brand kit from a company website: reads its colors, fonts and logo and returns a draft with a confidence and a source for each field.

Use this tool when: the user gives a website and wants charts in that brand and has no saved kit yet.
Behavior: by default nothing is saved (save is false) and you only get a draft. Each extraction that finds something uses one of the plan's small monthly website-extraction allowance; blocked, failed or empty lookups are not counted. save: true stores the kit on the account and counts toward the plan's kit limit, so confirm with the user before you save. Private and internal addresses are refused (400 url_not_allowed); other failures are 422.

Returns: the draft in readable form (name, slug, palette, background, text and grid colors, font, logo) with confidence and source where the API gave them, and whether it was saved.
${ERRORS_TEXT} For 402 the metric is url_extractions.`,
    inputSchema: {
      url: z.string().min(3).max(2048).describe('Website address, for example "https://example.com".'),
      slug: z.string().regex(/^[a-z0-9-]+$/).max(48).optional().describe("Slug to use if the kit is saved: lowercase letters, digits and hyphens."),
      name: z.string().max(80).optional().describe("Name for the kit."),
      save: z.boolean().optional().describe("true stores the kit on the account. Default false (draft only). Ask the user first."),
    },
  },
  listGalleryCharts: {
    name: "list_gallery_charts",
    description: `List the Chart-Output gallery: ready-made chart designs for common business questions, grouped by job (revenue, growth, customers, sales, efficiency). No API key needed.

Use this tool when: the user describes a business question ("show how MRR is growing", "which channels bring signups") and you want a proven design to start from, before get_chart_example or hand-building a spec.
Each entry says when to use it, what it shows and what data it needs (columns, row and number-column counts, whether a target is needed).
Important: these are gallery charts. They are NOT template ids for the /api/v1/templates endpoint. A name such as mrr-growth can be both a gallery chart and a template id, and they are different charts.

Returns: text grouped by job: slug | title | kind, then Use when, Shows and Data lines. Pass a slug to get_gallery_chart.
Errors: if the site has not published the gallery yet you are told so. Network error — the site is unreachable or timed out.`,
    inputSchema: {
      job: z
        .string()
        .max(40)
        .optional()
        .describe('Only list one job, such as "revenue". An unknown job returns an empty list plus the valid job ids.'),
    },
  },
  getGalleryChart: {
    name: "get_gallery_chart",
    description: `Get one gallery chart by slug: what it shows, the data it needs, sample data, and the exact runnable POST /api/v1/render request. Optionally render it in the same call. The look is written into the request's theme, so no saved brand kit is needed.

Use this tool when: list_gallery_charts showed a chart that fits and you want its request body, or want it rendered with your own data.
Modes: render "none" (default) returns the description, data shape, sample data and the request JSON. Change data.labels, every datasets[].data, and then header and kpiStrip (they hold numbers too) so they all agree, then call render_card, or call this tool again with render "image" or "url" and overrides. Overrides are a shallow merge: a top-level key you give replaces that key in the request completely.
This is a gallery chart, not a template id for /api/v1/templates.
Behavior: render "image" or "url" makes a Chart-Output API call and uses a render. If your plan's size limit is smaller than the chart at 2x, it is retried once at 1x and the result says so.

Returns: text (and the image for render "image").
${ERRORS_TEXT}
Errors specific to this tool: unknown slug — "No gallery chart named X"; call list_gallery_charts.`,
    inputSchema: {
      slug: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(64)
        .describe('Gallery slug from list_gallery_charts, for example "mrr-growth".'),
      render: z
        .enum(["none", "image", "url"])
        .optional()
        .describe('"none" (default) returns the request JSON only. "image" renders it inline. "url" renders it and returns a link.'),
      overrides: z
        .record(z.unknown())
        .optional()
        .describe("Top-level request fields that replace the same fields in the gallery request, e.g. {data: {...}, header: {...}, kpiStrip: [...]}."),
    },
  },
  listExamples: {
    name: "list_chart_output_examples",
    description: `Return the ids of all built-in chart/card JSON specs shipped with this MCP package.

Use this tool when: you are about to call render_card and are unsure of the spec shape; you have received a 400 error from render_card; you want to browse available example layouts before choosing one.
Do NOT skip this step when building full card compositions — guessing field names causes 400 errors.

Returns: a plain-text list of example ids (one per line). Pass any id to get_chart_example to retrieve the full, API-ready JSON body.
Example invocation: list_chart_output_examples() → ["mrr-breakdown", "weekly-sales-by-plan", ...]`,
  },
  getExample: {
    name: "get_chart_example",
    description: `Return the complete JSON body for a named built-in example spec — identical to examples/<id>.json on disk.

Use this tool when: you need a valid API body to start from before calling render_card; render_card returned HTTP 400; you want to verify the exact field names for header, kpiStrip, footer, data, options, or theme.
Do NOT hand-author a full card spec from memory — always start from this example and edit values only. Examples are 1200 px at scale 1 so they run on a Free key.

Returns: the full JSON text of the example, ready to pass as the \`spec\` argument to render_card. Field structure must be preserved; only values should change.
Errors: throws if the id is not found — call list_chart_output_examples first to see valid ids.
Example invocation: get_chart_example({ example: "mrr-breakdown" }) → { type: "bar", data: {...}, header: {...}, ... }`,
    inputSchema: {
      example: z
        .string()
        .min(1)
        .describe(
          'Id of the example to retrieve (filename without .json extension). Call list_chart_output_examples to see all valid ids. Examples: "mrr-breakdown", "weekly-sales-by-plan", "api-analytics".'
        ),
    },
  },
} as const;
