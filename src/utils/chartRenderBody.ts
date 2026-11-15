/** Named optional inputs -> request fields. Drops undefined and renames `repair` to the API's `repair_mode`. */
export function extrasToBody(extras?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extras ?? {})) {
    if (value === undefined) continue;
    out[key === "repair" ? "repair_mode" : key] = value;
  }
  return out;
}

export function buildChartRenderBody(args: {
  extensions?: Record<string, unknown>;
  /** Named optional inputs (brand, annotations, header, repair...). They override `extensions` but never the core fields. */
  extras?: Record<string, unknown>;
  type: string;
  labels: string[];
  datasets: unknown[];
  width: number;
  height: number;
  format: string;
  scale?: number;
  title?: string;
  returnUrl?: boolean;
}): Record<string, unknown> {
  const { extensions, extras, type, labels, datasets, width, height, format, scale, title, returnUrl } = args;
  const body: Record<string, unknown> = {
    ...(extensions ?? {}),
    ...extrasToBody(extras),
    type,
    width,
    height,
    format,
    data: { labels, datasets },
  };
  if (scale !== undefined) {
    body.scale = scale;
  }
  if (returnUrl) {
    body.returnUrl = true;
  }
  if (title) {
    const opts = (body.options as Record<string, unknown> | undefined) ?? {};
    const plugins = (opts.plugins as Record<string, unknown> | undefined) ?? {};
    body.options = {
      ...opts,
      plugins: {
        ...plugins,
        title: { display: true, text: title },
      },
    };
  }
  return body;
}
