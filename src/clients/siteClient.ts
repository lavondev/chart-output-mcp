import { SITE_BASE } from "../config/chartOutput.js";
import { PACKAGE_VERSION } from "../config/version.js";
import { sleep } from "../utils/retry.js";

const SITE_TIMEOUT_MS = 10_000;
const SITE_MAX_BYTES = 1024 * 1024;

/**
 * Read-only GET of a JSON file from the marketing site (gallery index and specs). No API key is ever sent:
 * the only header is a User-Agent. 10 s timeout, at most one retry, 1 MB limit, redirects followed.
 * A 404 returns `{status: 404}` (with the JSON body when there is one) instead of throwing.
 */
export async function fetchSiteJson(path: string): Promise<{ status: number; json: unknown }> {
  const url = `${SITE_BASE}${path}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), SITE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": `chart-output-mcp/${PACKAGE_VERSION}` },
      });

      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt === 0) {
        clearTimeout(timer);
        await sleep(300);
        continue;
      }

      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > SITE_MAX_BYTES) throw new Error("The site's response is larger than 1 MB.");
      const chunks: Buffer[] = [];
      let total = 0;
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > SITE_MAX_BYTES) {
            controller.abort(new Error("too large"));
            throw new Error("The site's response is larger than 1 MB.");
          }
          chunks.push(Buffer.from(value));
        }
      }
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8");

      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (res.status === 404) return { status: 404, json };
      if (!res.ok) throw new Error(`The site answered HTTP ${res.status} for ${path}.`);
      if (json === null) throw new Error(`The site's answer for ${path} was not JSON.`);
      return { status: res.status, json };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (error instanceof Error && /larger than 1 MB|answered HTTP|was not JSON/.test(error.message)) throw error;
      if (attempt === 0) {
        await sleep(300);
        continue;
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not reach the Chart-Output site for ${path} (${reason}).`);
}
