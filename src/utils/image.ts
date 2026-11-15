/** Image formats the inline tools can show in chat. */
const MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** Strip parameters ("; charset=utf-8") and lower-case a Content-Type value. */
export function cleanContentType(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.split(";")[0]?.trim().toLowerCase();
  return cleaned ? cleaned : null;
}

/**
 * Work out what the response bytes really are. The response Content-Type is the truth, not the
 * format the caller asked for: a card asked as SVG comes back as PNG. Falls back to the requested
 * format only when the Content-Type says nothing useful.
 */
export function resolveImageFormat(
  contentType: string | null,
  requestedFormat: string
): { format: string; mimeType: string } {
  const type = cleanContentType(contentType);
  if (type === "image/png") return { format: "png", mimeType: "image/png" };
  if (type === "image/jpeg" || type === "image/jpg") return { format: "jpeg", mimeType: "image/jpeg" };
  if (type === "image/webp") return { format: "webp", mimeType: "image/webp" };
  if (type === "image/svg+xml") return { format: "svg", mimeType: "image/svg+xml" };

  const fallback = requestedFormat === "jpg" ? "jpeg" : requestedFormat;
  return { format: fallback, mimeType: MIME_BY_FORMAT[fallback] ?? "image/png" };
}

export function assertChartImageBuffer(buffer: Buffer, format: string): void {
  const headUtf8 = buffer.toString("utf8", 0, Math.min(buffer.length, 256)).trimStart();
  if (headUtf8.startsWith("Redirecting")) {
    throw new Error(
      "Got a redirect placeholder body instead of image bytes. Use https://www.chart-output.com or enable HTTP redirect following (308)."
    );
  }
  if (headUtf8.startsWith("{")) {
    try {
      const j = JSON.parse(buffer.toString("utf8")) as { error?: string };
      throw new Error(
        `Chart-Output returned JSON instead of an image: ${j.error ?? buffer.toString("utf8", 0, 200)}`
      );
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Chart-Output returned JSON")) {
        throw e;
      }
    }
  }

  const f = format === "jpeg" ? "jpeg" : format;
  if (f === "png") {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < sig.length || !buffer.subarray(0, sig.length).equals(sig)) {
      throw new Error(
        "Response is not a valid PNG (wrong file signature). Check the API URL and that you are not saving a redirect response."
      );
    }
  } else if (f === "jpeg") {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new Error(
        "Response is not a valid JPEG (wrong file signature). Check the API URL and that you are not saving a redirect response."
      );
    }
  } else if (f === "webp") {
    if (
      buffer.length < 12 ||
      buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
      buffer.subarray(8, 12).toString("ascii") !== "WEBP"
    ) {
      throw new Error(
        "Response is not a valid WebP (wrong file signature). Check the API URL and that you are not saving a redirect response."
      );
    }
  } else if (f === "svg") {
    const sample = buffer.toString("utf8", 0, Math.min(buffer.length, 8192)).trimStart().toLowerCase();
    if (!sample.includes("<svg")) {
      throw new Error(
        "Response is not valid SVG markup. Check the API URL and that you are not saving a redirect response."
      );
    }
  }
}
