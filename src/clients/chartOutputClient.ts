import { AI_TIMEOUT_MS, API_BASE, MAX_RETRIES, REQUEST_TIMEOUT_MS } from "../config/chartOutput.js";
import { getChartOutputApiKey } from "../config/requestContext.js";
import { assertChartImageBuffer, cleanContentType, resolveImageFormat } from "../utils/image.js";
import { isRecord } from "../utils/object.js";
import {
  MAX_RETRY_AFTER_MS,
  backoffDelayMs,
  isRetryableStatus,
  retryAfterMsFromHeader,
  sleep,
} from "../utils/retry.js";
import { findRenderUrl } from "../utils/url.js";
import { downloadImage } from "./download.js";
import { type ResponseMeta, mergeJsonMeta, readResponseMeta } from "./responseMeta.js";

/** An error response from the API. `status`, `code` and `feature` let callers react without parsing text. */
export class ChartOutputApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly feature?: string
  ) {
    super(message);
    this.name = "ChartOutputApiError";
  }
}

/** Auth header for calls that need a key. Throws a clear error before any network call when there is none. */
export function authHeaders(options: { json?: boolean } = { json: true }): Record<string, string> {
  const key = getChartOutputApiKey();
  if (!key) {
    throw new ChartOutputApiError(
      "Chart-Output 401 authentication_required: no API key was provided.\nSet CHART_OUTPUT_API_KEY in the MCP server environment (stdio), or send Authorization: Bearer <key> or x-chart-output-api-key on the HTTP transport. Get a key at https://www.chart-output.com/auth/sign-up.",
      401,
      "authentication_required"
    );
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (options.json !== false) headers["Content-Type"] = "application/json";
  return headers;
}

// ---------------------------------------------------------------------------
// Error text
// ---------------------------------------------------------------------------

function str(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function short(value: unknown, max = 300): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (isRecord(detail)) {
    const path = Array.isArray(detail.path)
      ? detail.path.join(".")
      : str(detail.path) ?? str(detail.field);
    const message = str(detail.message) ?? short(detail, 200);
    return path ? `${path}: ${message}` : message;
  }
  return short(detail, 200);
}

function formatAvailable(available: unknown[]): string {
  return available
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) return str(item.slug) ?? str(item.id) ?? str(item.name) ?? short(item, 60);
      return String(item);
    })
    .join(", ");
}

const HANDLED_KEYS = new Set([
  "error", "message", "details", "path", "suggested_fix", "metric", "used", "limit", "plan", "feature",
  "required_plan", "resets_at", "upgrade_url", "available", "retryable", "requires_decision", "retryAfter",
  "code", "ok", "brand",
]);

/** Remaining plain fields (numbers, short strings, booleans) from an error body, as `key=value`. */
function otherFields(body: Record<string, unknown>, envelope: Record<string, unknown> | null): string {
  const parts: string[] = [];
  for (const source of [body, envelope]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (HANDLED_KEYS.has(key)) continue;
      if (typeof value === "number" || typeof value === "boolean") parts.push(`${key}=${value}`);
      else if (typeof value === "string" && value.length <= 120) parts.push(`${key}=${JSON.stringify(value)}`);
    }
  }
  return parts.slice(0, 10).join(", ");
}

/**
 * Turn an API error response into plain text an agent can act on.
 * Shapes are documented at https://www.chart-output.com/docs/errors. This keeps the useful fields
 * (field paths, upgrade link, reset date, available slugs, request id) instead of only `error`.
 */
export function describeApiError(
  status: number,
  body: Record<string, unknown>,
  headers?: Headers | null,
  statusText = ""
): ChartOutputApiError {
  // `repair_mode` and /ai/render failures put the details in an `error` object.
  const envelope = isRecord(body.error) ? body.error : null;
  const pick = (key: string): unknown => (envelope && key in envelope ? envelope[key] : body[key]);

  const code = envelope ? str(envelope.code) : str(body.error);
  const message = envelope ? str(envelope.message) : str(body.message);
  const label = code ?? (statusText.trim() || "error");

  const lines: string[] = [];
  lines.push(`Chart-Output ${status} ${label}${message && message !== label ? `: ${message}` : ""}`);

  // 400: which fields failed.
  const details = pick("details");
  if (Array.isArray(details) && details.length > 0) {
    lines.push("Problems:");
    for (const detail of details.slice(0, 20)) lines.push(`  - ${formatDetail(detail)}`);
    if (details.length > 20) lines.push(`  - …and ${details.length - 20} more`);
  } else if (isRecord(details)) {
    lines.push(`Details: ${short(details)}`);
  }

  const path = str(pick("path"));
  if (path) lines.push(`Path: ${path}`);

  const suggestedFix = pick("suggested_fix");
  if (suggestedFix !== undefined && suggestedFix !== null) {
    lines.push(`Suggested fix: ${typeof suggestedFix === "string" ? suggestedFix : short(suggestedFix)}`);
  }

  // 402: allowance.
  const metric = str(pick("metric"));
  const used = num(pick("used"));
  const limit = num(pick("limit"));
  const plan = str(pick("plan"));
  if (metric) {
    const usage =
      used !== undefined && limit !== undefined
        ? ` — ${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} used`
        : "";
    lines.push(`Allowance: ${metric}${usage}${plan ? ` on the ${plan} plan` : ""}.`);
  }

  // 403: missing plan feature.
  const feature = str(pick("feature"));
  const requiredPlan = str(pick("required_plan"));
  if (feature) {
    lines.push(
      `Feature: ${feature}${requiredPlan ? ` (needs the ${requiredPlan} plan${plan ? `; you are on ${plan}` : ""})` : ""}.`
    );
  }

  const resetsAt = str(pick("resets_at"));
  if (resetsAt) lines.push(`Resets at ${resetsAt}.`);

  const upgradeUrl = str(pick("upgrade_url"));
  if (upgradeUrl) lines.push(`Upgrade: ${upgradeUrl}`);

  // 404 brand_kit_not_found.
  const available = pick("available");
  if (Array.isArray(available)) {
    lines.push(
      available.length > 0
        ? `Available brand kits (use one as "brand"): ${formatAvailable(available)}`
        : "This account has no saved brand kits. Remove `brand` or create a kit first."
    );
  }

  // Repair-mode / generation envelope flags.
  const retryable = pick("retryable");
  if (typeof retryable === "boolean") lines.push(`Retryable: ${retryable ? "yes" : "no"}.`);
  if (pick("requires_decision") === true) {
    lines.push("This needs a decision from the user. Ask them how to proceed before changing the request.");
  }

  // Anything else the API sent (for example the numbers behind a waterfall total mismatch).
  const other = otherFields(body, envelope);
  if (other) lines.push(`Other: ${other}`);

  // 429.
  if (status === 429) {
    const retryAfterHeader = headers?.get("retry-after") ?? null;
    const retryAfter = retryAfterHeader ?? (num(body.retryAfter) !== undefined ? String(body.retryAfter) : null);
    if (retryAfter) lines.push(`Retry-After: ${retryAfter}`);
  }

  // What the agent should do next.
  if (status === 401) {
    lines.push(
      "The API key is missing or invalid. Check CHART_OUTPUT_API_KEY (or the Authorization: Bearer header on the HTTP transport). See https://www.chart-output.com/docs/quick-start."
    );
  } else if (status === 402) {
    lines.push("Do not retry. Tell the user their allowance is used up and share the upgrade link.");
  } else if (status === 403) {
    lines.push(
      feature === "resolution"
        ? "Do not retry this same request. Tell the user their plan cannot render this size. A smaller width, height or scale would fit, or they can upgrade."
        : "Do not retry. Tell the user their plan does not include this feature and share the upgrade link."
    );
  } else if (status === 429) {
    lines.push("You are being rate-limited. Wait for Retry-After before calling again.");
  }

  const requestId = headers?.get("x-request-id");
  if (requestId) lines.push(`(request id: ${requestId})`);

  return new ChartOutputApiError(lines.join("\n"), status, code, feature);
}

/** Read an error response body as JSON; non-JSON bodies (HTML error pages, plain text) become `message`. */
async function readErrorBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) return parsed;
    return { message: short(String(parsed), 300) };
  } catch {
    return { message: short(text.replace(/\s+/g, " ").trim(), 300) };
  }
}

async function throwApiError(res: Response): Promise<never> {
  const body = await readErrorBody(res);
  throw describeApiError(res.status, body, res.headers, res.statusText);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type FetchOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  /** Set false for calls that run a model (AI chart): a timeout must not start the work a second time. */
  retryOnTimeout?: boolean;
};

class RateLimitedError extends ChartOutputApiError {}

export async function fetchWithRetry(path: string, init: RequestInit, options: FetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const retryOnTimeout = options.retryOnTimeout ?? true;
  const url = `${API_BASE}${path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (isRetryableStatus(res.status)) {
        const retryAfter = retryAfterMsFromHeader(res.headers.get("retry-after"));
        if (res.status === 429 && retryAfter !== null && retryAfter > MAX_RETRY_AFTER_MS) {
          // The rate-limit window is minutes long. Do not make the tool call hang for it.
          const seconds = Math.ceil(retryAfter / 1000);
          const requestId = res.headers.get("x-request-id");
          throw new RateLimitedError(
            `Chart-Output 429 rate_limited: Rate limited. Try again in about ${seconds} seconds. Do not call again before then.${requestId ? `\n(request id: ${requestId})` : ""}`,
            429,
            "rate_limited"
          );
        }
        if (attempt < maxRetries) {
          await sleep(backoffDelayMs(attempt + 1, retryAfter));
          continue;
        }
      }
      return res;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof RateLimitedError) throw error;
      lastError = error;
      if (controller.signal.aborted && !retryOnTimeout) {
        throw new Error(
          `Chart-Output request timed out after ${Math.round(timeoutMs / 1000)} s. It was not repeated, so the work is not done twice. Try again, or ask for something smaller.`
        );
      }
      if (attempt >= maxRetries) {
        break;
      }
      await sleep(backoffDelayMs(attempt + 1, null));
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`Chart-Output request failed after retries: ${errMsg}`);
}

async function readJsonAsError(res: Response): Promise<never> {
  const text = await res.text();
  let detail = text.slice(0, 200);
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      const err = parsed.error;
      detail = isRecord(err) ? (str(err.message) ?? short(err, 200)) : (str(err) ?? str(parsed.message) ?? detail);
    }
  } catch {
    // keep the raw slice
  }
  throw new Error(`Chart-Output returned JSON instead of an image: ${detail}`);
}

/** POST or GET a JSON endpoint (waterfall, brand kits). Errors come back as `describeApiError` text. */
export async function callApiJson(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } & FetchOptions
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const res = await fetchWithRetry(
    path,
    {
      method: init.method,
      headers: authHeaders({ json: init.method !== "GET" }),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    },
    { timeoutMs: init.timeoutMs, maxRetries: init.maxRetries, retryOnTimeout: init.retryOnTimeout }
  );
  if (!res.ok) await throwApiError(res);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Chart-Output returned a response that is not JSON: ${short(text.replace(/\s+/g, " "), 200)}`);
  }
  return { status: res.status, json, headers: res.headers };
}

export type ChartImage = {
  base64: string;
  mimeType: string;
  /** What the bytes really are (a card asked as svg is png). */
  format: string;
  requestedFormat: string;
  meta: ResponseMeta;
  /** Set when the API answered with a link (repair mode); the image was downloaded from it. */
  imageUrl?: string;
};

export async function fetchChartAsBase64(body: Record<string, unknown>): Promise<ChartImage> {
  const requestedFormat = typeof body.format === "string" ? body.format : "png";

  const res = await fetchWithRetry("/api/v1/render", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await throwApiError(res);
  }

  const contentType = cleanContentType(res.headers.get("content-type"));
  const headerMeta = readResponseMeta(res.headers);

  if (contentType === "application/json") {
    // `repair_mode` (or any JSON answer): {ok, image_url, repairs_applied, warnings, ...}. Download the image from the link.
    const json: unknown = await res.json().catch(() => null);
    const imageUrl = isRecord(json) ? findRenderUrl(json) : null;
    if (!imageUrl) {
      throw new Error(
        `Chart-Output returned JSON instead of an image: ${short(json ?? "unreadable body", 300)}`
      );
    }
    const meta = mergeJsonMeta(headerMeta, json);
    try {
      const image = await downloadImage(imageUrl, requestedFormat);
      return { ...image, requestedFormat, meta, imageUrl };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The chart was rendered but the image could not be downloaded (${reason}). Open it here instead: ${imageUrl}`
      );
    }
  }
  if (contentType === "application/pdf") {
    throw new Error(
      "The API returned a PDF, which cannot be shown inline. Use render_chart_url or render_card_url for PDF output."
    );
  }

  // Check the bytes against what the API says it sent, not what we asked for:
  // a card (header, KPI strip, footer, border...) asked as SVG comes back as PNG.
  const { format, mimeType } = resolveImageFormat(contentType, requestedFormat);
  const buffer = Buffer.from(await res.arrayBuffer());
  assertChartImageBuffer(buffer, format);
  return {
    base64: buffer.toString("base64"),
    mimeType,
    format,
    requestedFormat,
    meta: headerMeta,
  };
}

export async function fetchChartUrl(
  body: Record<string, unknown>
): Promise<{ url: string; meta: ResponseMeta }> {
  const res = await fetchWithRetry("/api/v1/render", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...body,
      returnUrl: true,
    }),
  });

  if (!res.ok) {
    await throwApiError(res);
  }

  const json = (await res.json()) as unknown;
  const url = findRenderUrl(json);
  if (!url) {
    throw new Error(
      `Chart-Output did not return a render URL. Response: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  return { url, meta: mergeJsonMeta(readResponseMeta(res.headers), json) };
}

export async function fetchAiChartAsBase64(body: Record<string, unknown>): Promise<{
  base64: string;
  mimeType: string;
  chartType: string;
  generationMs: string;
  meta: ResponseMeta;
}> {
  // 65 s timeout and no retry on timeout: a retry would run the model a second time.
  const res = await fetchWithRetry(
    "/api/v1/ai/render",
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
    { timeoutMs: AI_TIMEOUT_MS, retryOnTimeout: false }
  );

  if (!res.ok) {
    await throwApiError(res);
  }

  const contentType = cleanContentType(res.headers.get("content-type"));
  if (contentType === "application/json") {
    await readJsonAsError(res);
  }
  const chartType = res.headers.get("x-ai-chart-type") ?? "unknown";
  const generationMs = res.headers.get("x-ai-generation-ms") ?? "?";
  const requestedFormat = typeof body.format === "string" ? body.format : "png";
  const { format, mimeType } = resolveImageFormat(contentType, requestedFormat);
  const buffer = Buffer.from(await res.arrayBuffer());
  assertChartImageBuffer(buffer, format);

  return {
    base64: buffer.toString("base64"),
    mimeType,
    chartType,
    generationMs,
    meta: readResponseMeta(res.headers),
  };
}
