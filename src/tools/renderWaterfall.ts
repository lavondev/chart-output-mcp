import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callApiJson } from "../clients/chartOutputClient.js";
import { downloadImage } from "../clients/download.js";
import { mergeJsonMeta, metaLines, readResponseMeta } from "../clients/responseMeta.js";
import { WATERFALL_TIMEOUT_MS } from "../config/chartOutput.js";
import { isRecord } from "../utils/object.js";
import { findRenderUrl } from "../utils/url.js";
import { toolDefinitions } from "./definitions.js";

type NumberFormat = { prefix?: string; suffix?: string; maximumFractionDigits?: number };

function fmtNum(n: number, nf: NumberFormat | undefined, signed: boolean): string {
  const abs = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: nf?.maximumFractionDigits ?? 2 });
  const sign = n < 0 ? "-" : signed && n > 0 ? "+" : "";
  return `${sign}${nf?.prefix ?? ""}${abs}${nf?.suffix ?? ""}`;
}

const asNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const asStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Plain-text summary of the API's answer. The explanation says what changed, never why. */
export function waterfallText(json: Record<string, unknown>, nf: NumberFormat | undefined, imageUrl: string): string[] {
  const lines: string[] = [];
  const summary = isRecord(json.summary) ? json.summary : {};

  const explanation = asStr(json.explanation);
  if (explanation) {
    const source = asStr(json.explanation_source);
    lines.push(`Waterfall: ${explanation}${source ? `   (source: ${source})` : ""}`);
  }

  const startTotal = asNum(summary.start_total);
  const endTotal = asNum(summary.end_total);
  const change = asNum(summary.change);
  if (startTotal !== undefined && endTotal !== undefined) {
    // Work the percentage out from the totals rather than trusting how the API scales change_pct.
    const pct =
      change !== undefined && startTotal !== 0
        ? (change / Math.abs(startTotal)) * 100
        : asNum(summary.change_pct);
    const pctText = pct !== undefined ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)` : "";
    lines.push(
      `Start ${asStr(summary.start_label) ?? "Start"} ${fmtNum(startTotal, nf, false)} → End ${asStr(summary.end_label) ?? "End"} ${fmtNum(endTotal, nf, false)}; change ${change !== undefined ? fmtNum(change, nf, true) : "?"}${pctText}.`
    );
  }

  if (Array.isArray(summary.drivers) && summary.drivers.length > 0) {
    const drivers = summary.drivers
      .map((d) => {
        if (!isRecord(d)) return null;
        const name = asStr(d.name) ?? asStr(d.label);
        const delta = asNum(d.delta) ?? asNum(d.change);
        return name ? (delta !== undefined ? `${name} ${fmtNum(delta, nf, true)}` : name) : null;
      })
      .filter((x): x is string => x !== null);
    if (drivers.length > 0) lines.push(`Drivers, largest first: ${drivers.join(", ")}`);
  }

  lines.push(`Image: ${imageUrl}`);
  return lines;
}

export function registerWaterfallTool(server: McpServer): void {
  server.tool(
    toolDefinitions.renderWaterfall.name,
    toolDefinitions.renderWaterfall.description,
    toolDefinitions.renderWaterfall.inputSchema,
    async ({ output, scale, ...rest }) => {
      // `output` is ours and is never sent. The API field for density is devicePixelRatio, not scale.
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }
      body.returnUrl = true;
      if (scale !== undefined) body.devicePixelRatio = scale;

      const { json, headers } = await callApiJson("/api/v1/waterfall", {
        method: "POST",
        body,
        timeoutMs: WATERFALL_TIMEOUT_MS,
        maxRetries: 1,
      });
      if (!isRecord(json)) throw new Error("Chart-Output returned an unexpected waterfall response.");

      const imageUrl = findRenderUrl(json.image_url) ?? findRenderUrl(json);
      if (!imageUrl) {
        throw new Error(`Chart-Output did not return an image link for the waterfall. Response: ${JSON.stringify(json).slice(0, 400)}`);
      }

      const nf = isRecord(rest.number_format) ? (rest.number_format as NumberFormat) : undefined;
      const lines = waterfallText(json, nf, imageUrl);
      const meta = mergeJsonMeta(readResponseMeta(headers), json);
      const format = typeof rest.format === "string" ? rest.format : "png";

      const content: Array<
        { type: "image"; data: string; mimeType: string } | { type: "text"; text: string }
      > = [];

      if ((output ?? "image") === "image") {
        if (format === "pdf") {
          lines.push("The PDF is available at the link above; PDFs are not shown inline.");
        } else {
          try {
            const image = await downloadImage(imageUrl, format);
            content.push({ type: "image", data: image.base64, mimeType: image.mimeType });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            lines.push(`The image could not be downloaded here (${reason}). Open the link above.`);
          }
        }
      }

      content.push({ type: "text", text: [...lines, ...metaLines(meta)].join("\n") });
      return { content };
    }
  );
}
