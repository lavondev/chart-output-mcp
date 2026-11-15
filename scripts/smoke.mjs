#!/usr/bin/env node
/**
 * Offline probe of the built server over stdio. No key, no network.
 *   npm run build && node scripts/smoke.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Keep in step with the tools the server registers.
const EXPECTED_TOOLS = [
  "create_brand_kit_from_url",
  "get_chart_example",
  "get_gallery_chart",
  "list_brand_kits",
  "list_chart_output_examples",
  "list_gallery_charts",
  "render_card",
  "render_card_url",
  "render_chart",
  "render_chart_ai",
  "render_chart_url",
  "render_waterfall",
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "build", "index.js")],
  env: { PATH: process.env.PATH ?? "", CHART_OUTPUT_API_KEY: "pk_test_dummy" },
  stderr: "ignore",
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

let failed = false;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failed = true;
};

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check(JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), `tools: ${names.join(", ")}`);

const { resources } = await client.listResources();
check(resources.length >= 8, `resources: ${resources.length}`);
check(resources.some((r) => r.uri === "chart-output://reference/request-fields"), "reference resource listed");

const version = client.getServerVersion()?.version;
check(version === pkg.version, `serverInfo.version ${version} equals package.json ${pkg.version}`);

check(Boolean(client.getInstructions()), "server instructions present");

await client.close();
process.exit(failed ? 1 : 0);
