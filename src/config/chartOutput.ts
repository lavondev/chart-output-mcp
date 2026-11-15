const DEFAULT_BASE_URL = "https://www.chart-output.com";

/**
 * Read a base URL from the environment. Plain http is only allowed for localhost / 127.0.0.1
 * so an API key can never be sent over the network in clear text by mistake.
 */
function resolveBaseUrl(envName: string): string {
  const raw = process.env[envName]?.trim();
  if (!raw) return DEFAULT_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${envName} must be a full URL such as ${DEFAULT_BASE_URL} (got "${raw}").`);
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const allowed = parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocal);
  if (!allowed) {
    throw new Error(
      `${envName} must use https (plain http is only allowed for localhost and 127.0.0.1). Got "${raw}".`
    );
  }

  return raw.replace(/\/+$/, "");
}

// Use www host: apex chart-output.com returns 308 with body "Redirecting..."; clients that
// don't follow redirects save that text as if it were image bytes.
// Override with CHART_OUTPUT_BASE_URL for self-hosting or for offline tests against a local server.
export const API_BASE = resolveBaseUrl("CHART_OUTPUT_BASE_URL");

// The marketing site (gallery index, llms.txt) can live on a different host than the API when the app is
// self-hosted or previewed. Only the three read-only gallery fetches use this; renders always use API_BASE.
export const SITE_BASE = resolveBaseUrl("CHART_OUTPUT_SITE_URL");

export const apiKey = process.env.CHART_OUTPUT_API_KEY ?? null;
// The app allows 30 s for a render, 30 s for a waterfall and 60 s for a plain-English (AI) chart.
export const REQUEST_TIMEOUT_MS = Number(process.env.CHART_OUTPUT_TIMEOUT_MS ?? 35000);
export const AI_TIMEOUT_MS = Number(process.env.CHART_OUTPUT_AI_TIMEOUT_MS ?? 65000);
export const WATERFALL_TIMEOUT_MS = 35000;
export const FROM_URL_TIMEOUT_MS = 35000;
export const MAX_RETRIES = Number(process.env.CHART_OUTPUT_MAX_RETRIES ?? 2);
export const RETRY_BASE_DELAY_MS = Number(process.env.CHART_OUTPUT_RETRY_BASE_MS ?? 500);
