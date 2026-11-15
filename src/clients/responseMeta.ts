import { isRecord } from "../utils/object.js";

/** What a successful response tells us besides the image: usage, warnings, alt text, repairs. */
export type ResponseMeta = {
  quota?: { limit: number | "unlimited" | null; used: number | null; reset?: string };
  aiQuota?: { used: number | null; limit: number | null; remaining: number | null };
  warnings: string[];
  repairs: string[];
  altText?: string;
  altSource?: string;
  requestId?: string;
};

export function emptyMeta(): ResponseMeta {
  return { warnings: [], repairs: [] };
}

function numHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function decode(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Read the quota, warning and alt-text headers the app puts on successful responses. */
export function readResponseMeta(headers: Headers): ResponseMeta {
  const meta = emptyMeta();

  const limitRaw = headers.get("x-quota-limit");
  if (limitRaw !== null) {
    meta.quota = {
      limit: limitRaw.trim().toLowerCase() === "unlimited" ? "unlimited" : numHeader(headers, "x-quota-limit"),
      used: numHeader(headers, "x-quota-used"),
      reset: headers.get("x-quota-reset") ?? undefined,
    };
  }

  const aiUsed = numHeader(headers, "x-ai-renders-used");
  const aiLimit = numHeader(headers, "x-ai-renders-limit");
  const aiRemaining = numHeader(headers, "x-ai-renders-remaining");
  if (aiUsed !== null || aiLimit !== null || aiRemaining !== null) {
    meta.aiQuota = { used: aiUsed, limit: aiLimit, remaining: aiRemaining };
  }

  meta.warnings = (headers.get("x-chart-warnings") ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  meta.altText = decode(headers.get("x-chart-alt-text"));
  meta.altSource = headers.get("x-chart-alt-text-source") ?? undefined;
  meta.requestId = headers.get("x-request-id") ?? undefined;
  return meta;
}

function formatItem(item: unknown): string | null {
  if (typeof item === "string") return item.trim() || null;
  if (isRecord(item)) {
    const code = typeof item.code === "string" ? item.code : "";
    const message = typeof item.message === "string" ? item.message : "";
    const text = code && message ? `${code}: ${message}` : code || message;
    return text || null;
  }
  return null;
}

/** Add what a JSON body says (warnings, repairs, alt text); JSON is richer than the headers, so it wins. */
export function mergeJsonMeta(meta: ResponseMeta, json: unknown): ResponseMeta {
  if (!isRecord(json)) return meta;
  const out: ResponseMeta = { ...meta, warnings: [...meta.warnings], repairs: [...meta.repairs] };

  if (Array.isArray(json.warnings)) {
    const items = json.warnings.map(formatItem).filter((x): x is string => x !== null);
    if (items.length > 0) out.warnings = items;
  }
  if (Array.isArray(json.repairs_applied)) {
    out.repairs = json.repairs_applied.map(formatItem).filter((x): x is string => x !== null);
  }
  if (typeof json.alt_text === "string" && json.alt_text.trim()) out.altText = json.alt_text.trim();
  if (typeof json.alt_text_source === "string") out.altSource = json.alt_text_source;
  return out;
}

function formatReset(reset: string): string {
  const trimmed = reset.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const date = new Date(n < 1e12 ? n * 1000 : n);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return trimmed;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/** Extra text lines for a tool result. Empty when there is nothing worth saying. */
export function metaLines(meta: ResponseMeta): string[] {
  const lines: string[] = [];

  if (meta.altText) {
    lines.push(`Alt text${meta.altSource ? ` (${meta.altSource})` : ""}: ${meta.altText}`);
  }
  if (meta.repairs.length > 0) lines.push(`Repairs applied: ${meta.repairs.join(", ")}`);
  if (meta.warnings.length > 0) lines.push(`Warnings: ${meta.warnings.join(", ")}`);

  let nearLimit = false;
  const q = meta.quota;
  if (q && q.used !== null) {
    if (q.limit === "unlimited") {
      lines.push(`Usage: ${fmt(q.used)} renders this period (no limit on this plan).`);
    } else if (typeof q.limit === "number" && q.limit > 0) {
      const reset = q.reset ? ` (resets ${formatReset(q.reset)})` : "";
      lines.push(`Usage: ${fmt(q.used)} of ${fmt(q.limit)} renders this period${reset}.`);
      if (q.used / q.limit >= 0.9) nearLimit = true;
    }
  }
  const ai = meta.aiQuota;
  if (ai && ai.used !== null && ai.limit !== null && ai.limit > 0) {
    const left = ai.remaining !== null ? ` (${fmt(ai.remaining)} left)` : "";
    lines.push(`AI charts: ${fmt(ai.used)} of ${fmt(ai.limit)} used this period${left}.`);
    if (ai.used / ai.limit >= 0.9) nearLimit = true;
  }
  if (nearLimit) lines.push("Heads up: the allowance is almost used up.");

  return lines;
}

/** Join a first line with the meta lines. */
export function withMeta(first: string, meta: ResponseMeta): string {
  const extra = metaLines(meta);
  return extra.length > 0 ? `${first}\n${extra.join("\n")}` : first;
}
