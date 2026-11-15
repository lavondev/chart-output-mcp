import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFakeApi } from "../scripts/fake-api.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Start the fake API and the built MCP server over stdio, wired together. */
export async function startHarness({ key = "pk_test_dummy", env = {} } = {}) {
  const api = await startFakeApi();
  const extraEnv = typeof env === "function" ? env(api) : env;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "build", "index.js")],
    env: {
      PATH: process.env.PATH ?? "",
      CHART_OUTPUT_BASE_URL: api.baseUrl,
      CHART_OUTPUT_SITE_URL: api.baseUrl,
      CHART_OUTPUT_API_KEY: key,
      CHART_OUTPUT_RETRY_BASE_MS: "10",
      ...extraEnv,
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);

  return {
    api,
    client,
    /** Call a tool and return {isError, text, image}. */
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content = Array.isArray(result.content) ? result.content : [];
      return {
        isError: result.isError === true,
        text: content.filter((c) => c.type === "text").map((c) => c.text).join("\n"),
        image: content.find((c) => c.type === "image"),
        raw: result,
      };
    },
    async close() {
      await client.close();
      await api.close();
    },
  };
}

/** Requests the fake API received for a path. */
export function requestsTo(api, path) {
  return api.requests.filter((r) => r.path === path);
}
