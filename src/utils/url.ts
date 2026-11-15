import { API_BASE } from "../config/chartOutput.js";
import { isRecord } from "./object.js";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function normalizeRenderUrl(value: string): string | null {
  const url = value.trim();
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  if (url.startsWith("/")) {
    return new URL(url, API_BASE).toString();
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      return parsed.toString();
    }
    if (parsed.protocol === "http:" && parsed.hostname.endsWith("chart-output.com")) {
      parsed.protocol = "https:";
      return parsed.toString();
    }
    // Plain http is only accepted for a local development server (CHART_OUTPUT_BASE_URL on localhost).
    if (parsed.protocol === "http:" && isLocalHost(parsed.hostname) && isLocalHost(new URL(API_BASE).hostname)) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function findRenderUrl(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeRenderUrl(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findRenderUrl(item);
      if (url) return url;
    }
  }
  if (isRecord(value)) {
    for (const key of ["url", "image_url", "cdnUrl", "imageUrl", "renderUrl", "href", "src"]) {
      const url = findRenderUrl(value[key]);
      if (url) return url;
    }
    for (const nested of Object.values(value)) {
      const url = findRenderUrl(nested);
      if (url) return url;
    }
  }

  return null;
}
