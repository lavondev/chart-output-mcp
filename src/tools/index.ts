import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBrandKitTools } from "./brandKits.js";
import { registerExampleTools } from "./examples.js";
import { registerGalleryTools } from "./gallery.js";
import { registerRenderCardTools } from "./renderCard.js";
import { registerRenderChartTools } from "./renderChart.js";
import { registerRenderChartAiTool } from "./renderChartAi.js";
import { registerWaterfallTool } from "./renderWaterfall.js";

export function registerTools(server: McpServer, exampleIds: string[]): void {
  registerExampleTools(server, exampleIds);
  registerRenderChartTools(server);
  registerRenderCardTools(server);
  registerRenderChartAiTool(server);
  registerWaterfallTool(server);
  registerBrandKitTools(server);
  registerGalleryTools(server);
}
