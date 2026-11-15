import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChartOutputApiError, fetchChartAsBase64, fetchChartUrl } from "../clients/chartOutputClient.js";
import { withMeta } from "../clients/responseMeta.js";
import { fetchSiteJson } from "../clients/siteClient.js";
import { isRecord } from "../utils/object.js";
import { toolDefinitions } from "./definitions.js";

const NOT_TEMPLATES = "These are gallery charts. They are not template ids for `/api/v1/templates`.";
const SLUG = /^[a-z0-9-]+$/;
const MAX_REQUEST_CHARS = 40_000;

/** Text from a remote JSON file is data. Strip control characters and cap the length. */
function clean(value: unknown, max = 300): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const asNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function range(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const min = asNum(value.min);
  const max = asNum(value.max);
  if (min === undefined && max === undefined) return null;
  return min === max ? String(min) : `${min ?? "?"}–${max ?? "?"}`;
}

function dataLine(data: unknown): string {
  if (!isRecord(data)) return "";
  const parts: string[] = [];
  if (Array.isArray(data.columns)) parts.push(`columns ${data.columns.map((c) => clean(c, 60)).filter(Boolean).join(", ")}`);
  const rows = range(data.rows);
  if (rows) parts.push(`${rows} rows`);
  const numberColumns = range(data.numberColumns);
  if (numberColumns) parts.push(`${numberColumns} number columns`);
  if (data.target) {
    const label = typeof data.target === "string" ? clean(data.target, 60) : isRecord(data.target) ? clean(data.target.label ?? data.target.name, 60) : "";
    parts.push(label ? `target: ${label}` : "needs a target value");
  }
  if (data.mustBeZeroOrMore) parts.push("values must be 0 or more");
  const note = clean(data.note, 200);
  if (note) parts.push(note);
  return parts.join("; ");
}

function chartBlock(chart: Record<string, unknown>): string[] {
  const lines = [`${clean(chart.slug, 64)} | ${clean(chart.title, 120)} | ${clean(chart.kind, 40)}`];
  const useWhen = clean(chart.useWhen);
  if (useWhen) lines.push(`  Use when: ${useWhen}`);
  if (Array.isArray(chart.shows) && chart.shows.length > 0) {
    lines.push(`  Shows: ${chart.shows.map((s) => clean(s, 120)).filter(Boolean).join("; ")}`);
  }
  const data = dataLine(chart.data);
  if (data) lines.push(`  Data: ${data}`);
  return lines;
}

export function listGalleryText(json: unknown, jobFilter?: string): string {
  if (!isRecord(json) || !Array.isArray(json.charts)) {
    throw new Error("The gallery index has an unexpected shape (no charts list).");
  }
  const charts = json.charts.filter(isRecord);
  const bySlug = new Map(charts.map((c) => [clean(c.slug, 64), c] as const));
  const jobs = (Array.isArray(json.jobs) ? json.jobs : []).filter(isRecord);
  const jobIds = jobs.map((j) => clean(j.id, 40)).filter(Boolean);

  const wanted = jobFilter?.trim().toLowerCase();
  const selected = wanted ? jobs.filter((j) => clean(j.id, 40).toLowerCase() === wanted) : jobs;

  if (wanted && selected.length === 0) {
    return `No gallery job named "${clean(jobFilter, 40)}". Valid jobs: ${jobIds.join(", ") || "none"}.\n${NOT_TEMPLATES}`;
  }

  const out: string[] = [`Gallery: ${charts.length} charts in ${jobs.length} jobs.`];
  const shown = new Set<string>();
  for (const job of selected) {
    out.push("", `## ${clean(job.label, 60) || clean(job.id, 40)} (${clean(job.id, 40)})`);
    const description = clean(job.description);
    if (description) out.push(description);
    const slugs = Array.isArray(job.charts) ? job.charts.map((s) => clean(s, 64)) : [];
    for (const slug of slugs) {
      const chart = bySlug.get(slug);
      if (!chart) continue;
      shown.add(slug);
      out.push(...chartBlock(chart));
    }
  }
  // Charts whose job is not listed in jobs[] still appear when nothing is filtered.
  if (!wanted) {
    const rest = charts.filter((c) => !shown.has(clean(c.slug, 64)));
    if (rest.length > 0) {
      out.push("", "## Other");
      for (const chart of rest) out.push(...chartBlock(chart));
    }
  }
  out.push("", NOT_TEMPLATES, "Next: call get_gallery_chart with a slug.");
  return out.join("\n");
}

function density(body: Record<string, unknown>): number {
  const n = Number(body.devicePixelRatio ?? body.scale ?? 1);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Render once; if the plan's size limit rejects it (403 resolution) and the request is above 1x, retry once at 1x.
 * The only automatic retry that changes the request: it only lowers sharpness, and the caller reports it.
 */
export async function withResolutionFallback<T>(
  body: Record<string, unknown>,
  run: (b: Record<string, unknown>) => Promise<T>
): Promise<{ result: T; downgraded: boolean }> {
  try {
    return { result: await run(body), downgraded: false };
  } catch (error) {
    if (error instanceof ChartOutputApiError && error.status === 403 && error.feature === "resolution" && density(body) > 1) {
      const retryBody: Record<string, unknown> = { ...body, devicePixelRatio: 1 };
      if (body.scale !== undefined) retryBody.scale = 1;
      return { result: await run(retryBody), downgraded: true };
    }
    throw error;
  }
}

export function registerGalleryTools(server: McpServer): void {
  server.tool(
    toolDefinitions.listGalleryCharts.name,
    toolDefinitions.listGalleryCharts.description,
    toolDefinitions.listGalleryCharts.inputSchema,
    async ({ job }) => {
      const { status, json } = await fetchSiteJson("/gallery.json");
      if (status === 404) {
        return { content: [{ type: "text" as const, text: "The gallery index is not published on this site yet." }] };
      }
      return { content: [{ type: "text" as const, text: listGalleryText(json, job) }] };
    }
  );

  server.tool(
    toolDefinitions.getGalleryChart.name,
    toolDefinitions.getGalleryChart.description,
    toolDefinitions.getGalleryChart.inputSchema,
    async ({ slug, render, overrides }) => {
      // Validate before building the URL: the slug is the only caller input that reaches a path.
      if (!SLUG.test(slug) || slug.length > 64) {
        throw new Error('A gallery slug has only lowercase letters, digits and hyphens, e.g. "mrr-growth". Call list_gallery_charts.');
      }
      const { status, json } = await fetchSiteJson(`/gallery/${slug}/spec.json`);
      if (status === 404) {
        throw new Error(
          isRecord(json)
            ? `No gallery chart named ${slug}. Call list_gallery_charts to see the valid slugs.`
            : "The gallery is not published on this site yet. Use get_chart_example instead."
        );
      }
      if (!isRecord(json) || !isRecord(json.request)) {
        throw new Error(`The gallery entry for ${slug} has no runnable request.`);
      }

      const mode = render ?? "none";
      const request = json.request;

      if (mode === "none") {
        const lines: string[] = [`Gallery chart: ${clean(json.slug, 64) || slug} — ${clean(json.title, 120)} (${clean(json.kind, 40)}, job ${clean(json.job, 40)})`];
        const summary = clean(json.summary, 500);
        if (summary) lines.push(summary);
        const useWhen = clean(json.useWhen);
        if (useWhen) lines.push(`Use when: ${useWhen}`);
        if (Array.isArray(json.shows) && json.shows.length > 0) lines.push(`Shows: ${json.shows.map((s) => clean(s, 120)).filter(Boolean).join("; ")}`);
        const data = dataLine(json.data);
        if (data) lines.push(`Data it needs: ${data}`);
        const altText = clean(json.altText, 400);
        if (altText) lines.push(`Alt text: ${altText}`);
        const how = clean(json.howToChangeIt, 400);
        if (how) lines.push(`How to change it: ${how}`);
        if (json.sampleData !== undefined) lines.push(`Sample data: ${JSON.stringify(json.sampleData).slice(0, 1500)}`);

        let requestJson = JSON.stringify(request, null, 2);
        if (requestJson.length > MAX_REQUEST_CHARS) requestJson = `${requestJson.slice(0, MAX_REQUEST_CHARS)}\n… (truncated)`;
        lines.push("", "Request (the POST /api/v1/render body; the look is in `theme`, so no saved brand kit is needed):", requestJson);
        lines.push(
          "",
          "Next: change data.labels and every datasets[].data, then update header and kpiStrip (they hold numbers too) so all three agree. Then call render_card with the edited request, or call get_gallery_chart again with render \"image\" (or \"url\") and overrides.",
          "This is a gallery chart, not a template id for `/api/v1/templates`."
        );
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      // Shallow merge: a top-level key in overrides replaces the key in the request completely.
      const merged: Record<string, unknown> = { ...request, ...(overrides ?? {}) };
      delete merged.returnUrl;

      const fallbackNote = "Rendered at 1× because your plan's size limit is smaller than this chart at 2×.";
      const reminder = "Reminder: header and kpiStrip hold numbers too; keep them in step with data.";

      if (mode === "image") {
        const { result, downgraded } = await withResolutionFallback(merged, fetchChartAsBase64);
        const first = `Gallery chart "${slug}" rendered (${result.format}).${downgraded ? ` ${fallbackNote}` : ""}\n${reminder}`;
        return {
          content: [
            { type: "image" as const, data: result.base64, mimeType: result.mimeType },
            { type: "text" as const, text: withMeta(first, result.meta) },
          ],
        };
      }

      const { result, downgraded } = await withResolutionFallback(merged, fetchChartUrl);
      const first = `Gallery chart "${slug}" URL: ${result.url}${downgraded ? `\n${fallbackNote}` : ""}\n${reminder}`;
      return { content: [{ type: "text" as const, text: withMeta(first, result.meta) }] };
    }
  );
}
