import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const REFERENCE_URI = "chart-output://reference/request-fields";

/** Fields accepted by POST /api/v1/render, as the app validates them. Unknown top-level keys are ignored; wrong types are a 400. */
export const REQUEST_FIELDS_REFERENCE = `# Chart-Output request fields (POST /api/v1/render)

Unknown top-level keys are ignored, but wrong types are 400 errors. Free plan images carry a small watermark.

## Core
- \`type\`: line | bar | pie | doughnut | radar | polarArea (required)
- \`data.labels\`: 1–1000 strings (up to 200 chars each). \`data.datasets\`: 1–20.
- Dataset: \`label\`, \`data\` (1–1000 items: number, null, {x,y}, or [from,to]), \`backgroundColor\`, \`borderColor\` (string or array), \`borderWidth\`, \`fill\`, \`tension\` (0–1), \`borderDash\`, \`pointRadius\`, \`pointBackgroundColor\`, \`pointBorderColor\`, \`pointBorderWidth\`, \`barPercentage\`, \`categoryPercentage\`, \`borderRadius\`, \`borderSkipped\`, \`stack\`, \`yAxisID\`, \`xAxisID\`, \`hidden\`, dataset-level \`type\` ("line" or "bar", for a bar + line mix, usually with a second yAxisID), \`datalabels\` (per-series label options). Other Chart.js dataset keys pass through.
- \`options\`: Chart.js options, passed through. No time scales (no date adapter).
- \`width\`, \`height\`: 100–4000, default 800×400. \`format\`: png (default) jpeg svg webp pdf.
- \`scale\` / \`devicePixelRatio\`: 1–4, default 1. Plan cap: max(width, height) × scale must be at most 1200 (Free) or 3000 (Pro, Agency). Over the cap is a 403 with feature "resolution".
- \`returnUrl\`: true returns JSON {url}. \`repair_mode\`: "off" | "safe" returns a JSON envelope (the tools expose this as \`repair\`).

## Look
- \`brand\`: saved brand kit slug (see list_brand_kits). \`brandKitId\`: preset (obsidian linen polar studio ember harbor) or a UUID.
- \`theme\`: {palette (up to 12), backgroundColor, fontFamily, fontSize 8–32, gridColor, mode "light"|"dark", textPrimary, textSecondary}. An object, never a string.
- \`padding\`: email | slack | pdf. \`colorblind_safe\`: true.
- \`logo\`: {url (https), height 8–120, position, margin 0–64, opacity 0–1} for plain charts.

## Card (any of header, kpiStrip, footer, border, legend, or borderRadius > 0 turns it on; a card is PNG even if svg is asked)
- \`header\`: {eyebrow, title, subtitle (each up to 200), badge {text up to 100, backgroundColor, color, borderRadius, position "start"|"end"}, align "left"|"center", logoUrl (https), logoHeight 16–120, logoAlign "left"|"right"}
- \`legend\`: {display, position "top"|"bottom", style "square"|"line"|"circle", fontSize 8–20, gap 0–48}
- \`kpiStrip\`: up to 12 × {label up to 100, value up to 100 (a string), color}. There is no delta.
- \`footer\`: {left up to 500, right up to 500, borderTop}. There is no text.
- \`border\`: {color, width 0–8}. \`borderRadius\`: 0–64. \`backgroundColor\`.
- \`textScale\`: 1–2 (bigger text everywhere on a card).

## Extras
- \`dataLabels\`: true draws value labels. Number style goes in options.plugins.datalabels.numberFormat (or a dataset's own datalabels.numberFormat): {prefix, suffix, signed, share, maximumFractionDigits}. signed adds a + sign; share shows each value as a share of the total.
- [from, to] data items draw floating bars (ranges, bridges, waterfalls).
- \`annotations\`: event shape {x, label?, color?} (vertical line), {y, label?} (horizontal line), {x_start, x_end, style: "band", label?}. Line and bar charts with a category x-axis only. Free 10 / paid 25 per chart. Labels are cut at 30 characters. The old shape {type:"line", value, axis?} and {type:"box", xMin, xMax} is also accepted.
- \`alt_text\`: true (free template) or "ai" (uses the AI alt-text allowance; falls back to the template with a warning). \`lang\`: BCP 47.

## Behaviours that surprise agents
- Stacked bars: every series after the first whose color is a plain hex string (#rrggbb) is drawn at 70% opacity. Use rgba(r,g,b,1) for the exact color.
- Line charts: the second line series is dashed automatically unless it sets borderDash: [].
- Annotations (event shape) are rejected (400 annotations_not_supported) when options.indexAxis is "y" (horizontal bars), when scales.x.type is not category, or when the chart is not line or bar.
- A card asked as svg comes back as PNG.
- labels and every dataset's data should be the same length. The API only checks this when repair_mode is set (LABEL_DATA_LENGTH_MISMATCH); otherwise the chart renders with gaps.

## Errors
400 invalid spec (details list each field) · 401 bad or missing key · 402 allowance used up (do not retry) · 403 plan lacks a feature (do not retry) · 404 unknown brand slug (lists available) · 422 AI chart could not be built · 429 rate limit (wait for Retry-After).
`;

export function registerReferenceResource(server: McpServer): void {
  server.registerResource(
    "reference-request-fields",
    REFERENCE_URI,
    {
      title: "Reference: request fields",
      description:
        "Every field POST /api/v1/render accepts (types, limits, plan caps) and the renderer behaviours agents trip on. Read before building a spec by hand.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [{ uri: REFERENCE_URI, mimeType: "text/markdown", text: REQUEST_FIELDS_REFERENCE }],
    })
  );
}
