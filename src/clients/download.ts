import { assertChartImageBuffer, cleanContentType, resolveImageFormat } from "../utils/image.js";
import { normalizeRenderUrl } from "../utils/url.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Plain GET of a public file (a rendered image on the CDN). Sends NO credentials: the URL comes from a
 * response body, so it must never receive the API key. Bounded in time and size.
 */
export async function downloadBytes(
  rawUrl: string,
  options: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const url = normalizeRenderUrl(rawUrl);
  if (!url) throw new Error(`Refusing to download from "${rawUrl}" (not an https link).`);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("download timeout")), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new Error(`file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);

    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("empty response body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort(new Error("too large"));
        throw new Error(`file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
      }
      chunks.push(Buffer.from(value));
    }
    return { buffer: Buffer.concat(chunks), contentType: cleanContentType(res.headers.get("content-type")) };
  } finally {
    clearTimeout(timer);
  }
}

/** Download a rendered image and check its bytes against what the CDN says it is. */
export async function downloadImage(
  url: string,
  requestedFormat: string
): Promise<{ base64: string; mimeType: string; format: string }> {
  const { buffer, contentType } = await downloadBytes(url);
  if (contentType === "application/pdf") throw new Error("the file is a PDF, which cannot be shown inline");
  const { format, mimeType } = resolveImageFormat(contentType, requestedFormat);
  assertChartImageBuffer(buffer, format);
  return { base64: buffer.toString("base64"), mimeType, format };
}

