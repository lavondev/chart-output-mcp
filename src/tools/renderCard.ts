import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchChartAsBase64, fetchChartUrl } from "../clients/chartOutputClient.js";
import { withMeta } from "../clients/responseMeta.js";
import { moveRootLabelsIntoData, withRepairMode } from "../utils/cardSpec.js";
import { toolDefinitions } from "./definitions.js";

export function registerRenderCardTools(server: McpServer): void {
  server.tool(
    toolDefinitions.renderCard.name,
    toolDefinitions.renderCard.description,
    toolDefinitions.renderCard.inputSchema,
    async ({ spec, repair }) => {
      const body = withRepairMode(moveRootLabelsIntoData(spec as Record<string, unknown>), repair);
      if (body.returnUrl === true) {
        throw new Error(
          "render_card only returns inline images. Omit returnUrl from the spec for binary responses, or use render_card_url."
        );
      }
      if (body.format === "pdf") {
        throw new Error(
          'render_card returns inline images and cannot show a PDF. Use render_card_url with format "pdf" (needs a Pro or Agency plan).'
        );
      }

      // Sent once, exactly as given. A 400 shows the API's own `details` so the agent can fix the real problem.
      const { base64, mimeType, format, requestedFormat, meta } = await fetchChartAsBase64(body);

      const w = typeof body.width === "number" ? body.width : "?";
      const h = typeof body.height === "number" ? body.height : "?";
      const note =
        requestedFormat !== format
          ? ` Asked for ${requestedFormat}; cards are always returned as ${format}.`
          : "";
      return {
        content: [
          {
            type: "image" as const,
            data: base64,
            mimeType,
          },
          {
            type: "text" as const,
            text: withMeta(`Card rendered successfully (${w}×${h} ${format}).${note}`, meta),
          },
        ],
      };
    }
  );

  server.tool(
    toolDefinitions.renderCardUrl.name,
    toolDefinitions.renderCardUrl.description,
    toolDefinitions.renderCardUrl.inputSchema,
    async ({ spec, repair }) => {
      const body = withRepairMode(moveRootLabelsIntoData(spec as Record<string, unknown>), repair);
      const { url, meta } = await fetchChartUrl(body);

      return {
        content: [
          {
            type: "text" as const,
            text: withMeta(`Card URL: ${url}`, meta),
          },
        ],
      };
    }
  );
}
