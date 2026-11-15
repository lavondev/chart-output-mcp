export const SERVER_INSTRUCTIONS = `You are using Chart-Output MCP to render charts and dashboard cards as images (PNG, JPEG, WebP, or SVG; PDF as a link on paid plans).

Authentication: render tools need CHART_OUTPUT_API_KEY (sent as Bearer token). A 401 means the key is missing or invalid: the user must set it in the MCP server environment (or send it as a header on the HTTP transport). The gallery tools need no key.

Plans and errors: plans are Free, Pro and Agency. Free images carry a small watermark, and the longest edge × scale may be at most 1200 px (3000 px on Pro and Agency).
- 402 means the monthly allowance is used up. 403 means the plan lacks something you asked for (pdf, a bigger size, AI charts, waterfall explanations, a brand kit over the limit). Do NOT retry either one: tell the user and give them the upgrade link from the error text.
- 400 lists the exact fields that failed; fix those fields only. 404 for a brand slug lists the slugs that exist.
- 429 means too many requests (100 per 15 minutes per key). Wait for Retry-After.

Tool selection guide:
1. list_chart_output_examples / get_chart_example — start every card from an example; never hand-author a card spec. Examples are 1200 px at scale 1 so they run on Free.
2. render_chart — structured labels + datasets → inline image (line, bar, pie, doughnut, radar, polarArea). Datasets keep every key you send (fill, tension, stack, yAxisID, dataset-level type, borderDash). Named inputs: header, kpiStrip, footer, brand, textScale, annotations, dataLabels, colorblind_safe, alt_text, lang, repair. "extensions" is the escape hatch for anything else.
3. render_chart_url — same inputs, returns a public CDN link (and PDF on Pro or Agency).
4. render_card / render_card_url — the full POST /api/v1/render body as "spec". Do NOT set returnUrl. The spec is sent once, exactly as given; cards always come back as PNG.
5. render_chart_ai — natural language or raw JSON/CSV → chart. Pro or Agency only.
6. render_waterfall — "what changed between two periods". Gives a waterfall chart and a summary of what changed. The explanation says what changed, never why: do not invent causes.
7. list_brand_kits, create_brand_kit_from_url — use a saved brand by passing its slug as \`brand\`. Drafting from a URL uses a monthly extraction; save only after the user agrees. Preset looks go in brandKitId.
8. list_gallery_charts, get_gallery_chart — proven designs for common business questions (no key needed to browse). They are gallery charts, not API template ids: a name like mrr-growth can mean different things in each place, so say which one you mean. A guide for agents is at https://www.chart-output.com/llms.txt.

Field shapes that agents get wrong: kpiStrip is [{label, value, color?}] (value is a string, there is no delta); footer is {left?, right?, borderTop?}; theme is an object, never the string "dark"; header.badge is an object {text, ...}. Full field list: resource chart-output://reference/request-fields.

Things that surprise people: in a stacked bar, series after the first with a plain #rrggbb color are drawn at 70% opacity (use rgba(...) for the exact color); the second line series is dashed unless you set borderDash: []; annotations only work on line and bar charts with a category x-axis (not horizontal bars, pie, doughnut, radar, polarArea).

Data checks: keep labels and every dataset's data the same length. The API does not reject a mismatch by default; the chart renders with gaps. Set repair: "safe" when you are unsure about your data, or "off" to get a precise error with a suggested fix.

Defaults: 800×400 pixels, PNG. Results can include a Usage line and warnings; if the allowance is almost used up, tell the user. Card layout reference: https://www.chart-output.com/docs/card-composition`;
