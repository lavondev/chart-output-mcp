# MCP directory listings: handoff

Written 2026-11-21 from the chart-output app session. Goal: get `@chartoutput/mcp` and the hosted endpoint listed where AI tools and developers look for MCP servers. Glama already sends a few visitors a month to chart-output.com with no effort, so directory listings are cheap traffic.

## Where things stand

| Directory | Listed? | How you get on it |
|---|---|---|
| Official MCP Registry (registry.modelcontextprotocol.io) | No | Self-serve CLI (`mcp-publisher`). Do this first: Glama, PulseMCP and others read from it. |
| Glama (glama.ai/mcp/servers/lavondev/chart-output-mcp) | Yes, claimed | Re-scan only. Last scored 2026-04-22 with 3 tools; the package now has 12. |
| mcp.so | No | Web form, free (reviewed) or $39 (immediate). |
| Smithery | No | No self-serve any more (see below). |

## Already changed in this repo (uncommitted)

Made by the app session, not yet committed:

- `server.json` (new): registry entry named `io.github.lavondev/chart-output-mcp`, version `1.1.1`, with the npm package (stdio, `CHART_OUTPUT_API_KEY` required and secret) and the hosted remote `https://www.chart-output.com/mcp` (streamable HTTP). Validated against the registry's 2025-12-11 schema.
- `package.json`: added `"mcpName": "io.github.lavondev/chart-output-mcp"` under `version`. Must equal `server.json` `name` exactly.
- `DIRECTORY-LISTINGS.md` (this file).

Already uncommitted before that, from earlier work and **not part of this task**: an edit in `src/tools/definitions.ts` and `CATCH-UP-WITH-APP.md`. Decide on those separately.

## To do in the MCP session

1. Commit `server.json`, the `package.json` change and this file on a branch, open a PR, merge.
2. Bump to 1.1.1 (`npm version patch`), so `package.json`, `server.json` (both `version` fields) and npm agree. The registry rejects a package version on npm that has no `mcpName`, which is why 1.1.0 can't be listed.
3. `npm run build && npm test`, then `npm publish --access public`.
4. Publish to the registry (steps below), then verify.
5. Optional cleanups noticed while checking:
   - The hosted endpoint reports `serverInfo.version` `1.0.0` and exposes only `render_chart`. It's served by the app repo (`app/mcp`), not this package, so listings should describe it as the no-install, no-key option, not as the full 12-tool server.
   - The GitHub account was renamed from `jgaddy95` to `lavondev` (the old name now 404s). Everything here, the README links, `glama.json`, `server.json` and `mcpName`, uses `lavondev`. `LICENSE` still says `jgaddy95`; that's a copyright holder line, so it was left for the owner to decide.

## Official MCP Registry

The registry hosts metadata only; npm must already have the version.

```bash
brew install mcp-publisher
```

```bash
mcp-publisher login github
```

Sign in as **lavondev** (a personal account, the one that owns the repo) with the device code it prints. That grants the `io.github.lavondev/*` namespace, which matches `server.json` and `mcpName`.

```bash
mcp-publisher publish
```

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.lavondev/chart-output-mcp"
```

The output should contain `"name":"io.github.lavondev/chart-output-mcp"`.

Errors: "Registry validation failed for package" means `mcpName` is missing from the published npm version. "You do not have permission" means the name prefix doesn't match the GitHub account you logged in as. "Invalid or expired Registry JWT" means run `login` again. The registry doesn't verify the remote URL's domain for `io.github` names.

## mcp.so

1. Go to https://mcp.so/submit?type=server (the "MCP Server" tab).
2. Repository URL: `https://github.com/lavondev/chart-output-mcp`. Name: `Chart-Output`.
3. Choose the free submission (reviewed, no stated timeline) or the $39 paid one (published immediately, verified badge, dofollow link).
4. Optionally submit the hosted endpoint as well under https://mcp.so/submit?type=remote-server with `https://www.chart-output.com/mcp`.

The page has a Sign In link; whether submitting needs it wasn't confirmed. Use the paste text below if it asks for a description. Support: support@mcp.so.

## Smithery

Smithery joined Arcade and shut down its accounts, CLI, proxy and self-serve publishing on 2026-10-31 (https://smithery.ai/future). smithery.ai is now a public directory with a curated set of verified servers, and there is no "add server" flow. The only route is to ask: the cofounder's note gives ani [at] smithery [dot] ai for questions. It may also pick servers up from the official registry; publish there first and search smithery.ai after a few weeks before emailing.

## Glama

Open https://glama.ai/mcp/servers/lavondev/chart-output-mcp while signed in as the maintainer (`glama.json` lists lavondev) and trigger a re-scan so the score and tool count reflect 1.1.x. Glama also syncs from the official registry.

## Paste text

**Name:** Chart-Output

**Short description (95 chars, registry limit is 100):** Render branded chart images (PNG, SVG, WebP, PDF) and KPI cards from a JSON spec or plain data.

**Long description:**
Chart-Output turns chart data into finished images an agent can show inline: line, bar, pie, doughnut, radar and polar-area charts, or full cards with a header, KPI strip, annotations and source line, in your brand kit's colours and logo. Output is PNG, SVG, WebP, or PDF on Pro and Agency.

Two ways to connect:
- Hosted (no install): `https://www.chart-output.com/mcp`, streamable HTTP. Works without a key (PNG, up to 1200px, shared daily budget); add `Authorization: Bearer <api_key>` for your plan's limits. Exposes `render_chart`.
- npm (stdio): `npx -y @chartoutput/mcp` with `CHART_OUTPUT_API_KEY` set. 12 tools: render_chart, render_card, render_waterfall, render_chart_ai, URL variants, brand kits, gallery and examples.

Free API key: https://www.chart-output.com/auth/sign-up
Docs: https://www.chart-output.com/docs/mcp

**Links:** repo https://github.com/lavondev/chart-output-mcp · npm https://www.npmjs.com/package/@chartoutput/mcp · site https://www.chart-output.com

**Tags:** charts, data-visualization, images, chart.js, reports
