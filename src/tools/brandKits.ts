import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callApiJson } from "../clients/chartOutputClient.js";
import { FROM_URL_TIMEOUT_MS } from "../config/chartOutput.js";
import { isRecord } from "../utils/object.js";
import { toolDefinitions } from "./definitions.js";

const asStr = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function clip(text: string, max = 200): string {
  const clean = text.replace(/[\u0000-\u001f]+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function kitsFrom(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (isRecord(json)) {
    for (const key of ["brandKits", "brand_kits", "kits", "data", "items"]) {
      if (Array.isArray(json[key])) return json[key] as unknown[];
    }
  }
  return [];
}

export function formatKitLine(kit: unknown): string {
  if (!isRecord(kit)) return clip(String(kit));
  const slug = asStr(kit.slug) ?? asStr(kit.id) ?? "?";
  const name = asStr(kit.name) ?? "-";
  const state = kit.locked === true ? "LOCKED (over the plan's kit limit)" : "ok";
  const palette = Array.isArray(kit.palette) && kit.palette.length > 0 ? kit.palette.slice(0, 6).join(" ") : "-";
  const font = asStr(kit.fontFamily) ?? asStr(kit.font) ?? "-";
  const logo = asStr(kit.logoUrl) ? "logo yes" : "logo no";
  const warnings =
    Array.isArray(kit.warnings) && kit.warnings.length > 0
      ? kit.warnings.map((w) => (isRecord(w) ? asStr(w.code) ?? asStr(w.message) ?? "warning" : String(w))).join(", ")
      : "-";
  return clip(`${slug} | ${name} | ${state} | ${palette} | ${font} | ${logo} | ${warnings}`, 300);
}

const DRAFT_FIELDS = ["name", "slug", "palette", "background", "textColor", "gridColor", "fontFamily", "logoUrl"] as const;

function showValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "-";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Readable form of a from-url draft. Tolerant: the API may wrap each field as {value, confidence, source}. */
export function formatDraft(json: unknown, status: number): string {
  const root = isRecord(json) ? json : {};
  const draftSource = [root.draft, root.kit, root.brandKit, root.brand_kit].find(isRecord) ?? root;
  const lines: string[] = [];

  for (const field of DRAFT_FIELDS) {
    if (!(field in draftSource)) continue;
    const raw = draftSource[field];
    let value = raw;
    let confidence: unknown;
    let source: unknown;
    if (isRecord(raw) && "value" in raw) {
      value = raw.value;
      confidence = raw.confidence;
      source = raw.source;
    }
    const conf = confidence ?? (isRecord(root.confidence) ? root.confidence[field] : undefined);
    const src = source ?? (isRecord(root.sources) ? root.sources[field] : isRecord(root.source) ? root.source[field] : undefined);
    const extra = [conf !== undefined ? `confidence ${showValue(conf)}` : "", src !== undefined ? `from ${showValue(src)}` : ""]
      .filter(Boolean)
      .join(", ");
    lines.push(`${field}: ${clip(showValue(value), 300)}${extra ? ` (${clip(extra, 120)})` : ""}`);
  }

  const saved = status === 201 || root.saved === true || (isRecord(draftSource) && typeof draftSource.id === "string");
  const head = lines.length > 0 ? lines.join("\n") : `Draft (raw): ${clip(JSON.stringify(json), 1500)}`;
  const slug = asStr(draftSource.slug);
  const tail = saved
    ? `Saved to the account${slug ? ` as "${slug}"` : ""}. Use it with brand: "${slug ?? "<slug>"}".`
    : "Draft only: nothing was saved. To store it, call again with save: true (ask the user first).";
  return `${head}\n${tail}`;
}

export function registerBrandKitTools(server: McpServer): void {
  server.tool(toolDefinitions.listBrandKits.name, toolDefinitions.listBrandKits.description, async () => {
    const { json } = await callApiJson("/api/v1/brand-kits", { method: "GET" });
    const kits = kitsFrom(json);
    const text =
      kits.length === 0
        ? "No brand kits on this account yet. Use create_brand_kit_from_url to draft one from a website, or create one in the Chart-Output dashboard."
        : [
            `Brand kits (${kits.length}): slug | name | status | palette | font | logo | warnings`,
            ...kits.map(formatKitLine),
            "Pass the slug as `brand` in the render tools.",
          ].join("\n");
    return { content: [{ type: "text" as const, text }] };
  });

  server.tool(
    toolDefinitions.createBrandKitFromUrl.name,
    toolDefinitions.createBrandKitFromUrl.description,
    toolDefinitions.createBrandKitFromUrl.inputSchema,
    async ({ url, slug, name, save }) => {
      const body: Record<string, unknown> = { url, save: save ?? false };
      if (slug) body.slug = slug;
      if (name) body.name = name;

      // One try only: an extraction that finds something uses allowance, so it must not be repeated.
      const { json, status } = await callApiJson("/api/v1/brand-kits/from-url", {
        method: "POST",
        body,
        timeoutMs: FROM_URL_TIMEOUT_MS,
        maxRetries: 0,
      });
      return { content: [{ type: "text" as const, text: formatDraft(json, status) }] };
    }
  );
}
