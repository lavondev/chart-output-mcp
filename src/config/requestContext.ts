import { AsyncLocalStorage } from "node:async_hooks";
import { apiKey as envApiKey } from "./chartOutput.js";

type RequestContext = {
  chartOutputApiKey?: string;
  /** True for the HTTP transport: the server's own env key is then not used unless MCP_ALLOW_SERVER_KEY=true. */
  httpMode?: boolean;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContext.run(context, callback);
}

/**
 * The key for the current call. Over HTTP the caller must bring their own key: falling back to the server's
 * CHART_OUTPUT_API_KEY would let anyone who finds a public /mcp endpoint spend the owner's renders.
 * Set MCP_ALLOW_SERVER_KEY=true to opt in (private deployments only). stdio always uses the env key.
 */
export function getChartOutputApiKey(): string | null {
  const store = requestContext.getStore();
  if (store?.chartOutputApiKey) return store.chartOutputApiKey;
  if (store?.httpMode && process.env.MCP_ALLOW_SERVER_KEY !== "true") return null;
  return envApiKey;
}
