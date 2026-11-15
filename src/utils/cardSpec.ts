import { isRecord } from "./object.js";

/**
 * Common agent mistake: a render_chart-style payload (root `labels` + `datasets`) pasted into a card spec.
 * Move them into `data` before the first request. Nothing else is rewritten: every header, badge, theme
 * and KPI field is sent exactly as given, so a real 400 reaches the agent with the API's own `details`.
 */
export function moveRootLabelsIntoData(spec: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(spec.data)) return spec;
  const { labels, datasets, ...rest } = spec;
  if (Array.isArray(labels) && Array.isArray(datasets)) {
    return { ...rest, data: { labels, datasets } };
  }
  return spec;
}

/** Add the API's repair_mode when the caller opted in. The caller's `repair` input wins over a repair_mode inside the spec. */
export function withRepairMode(body: Record<string, unknown>, repair?: "safe" | "off"): Record<string, unknown> {
  return repair ? { ...body, repair_mode: repair } : body;
}
