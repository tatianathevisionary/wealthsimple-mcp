# Wealthsimple Help Center MCP Server

A standalone **Model Context Protocol** server that exposes the [Wealthsimple Help Center](https://help.wealthsimple.com/hc/en-ca) to AI agents. Built on `@modelcontextprotocol/sdk` and the public Zendesk Help Center JSON API — no scraping, no auth, fully typed responses.

> **Independent, unofficial project.**
> This is a community-built MCP integration. It is **not** built, endorsed, sponsored, or maintained by [Wealthsimple Technologies Inc.](https://www.wealthsimple.com) or [@wealthsimple](https://github.com/wealthsimple) on GitHub. "Wealthsimple", the help center, and all article content remain the property of Wealthsimple Technologies Inc.; this server only fetches and surfaces what their **public, unauthenticated** [Zendesk Help Center API](https://help.wealthsimple.com/api/v2/help_center/) chooses to return. For account-specific or product support, please contact Wealthsimple directly via their [official channels](https://help.wealthsimple.com/hc/en-ca/requests/new).

## Why this exists

The Wealthsimple Help Center is the canonical source of truth for how Wealthsimple's products work — TFSA / RRSP / FHSA mechanics, transfer rules, fees, tax slips, supported countries, options trading, crypto, Cash, Trade, Invest, and more. Wiring an agent into the help center via this MCP server lets it answer Wealthsimple-related questions with cited, up-to-date, structured content rather than memorized snapshots.

## Quick start

```sh
npm install
npm run build
npm start            # runs build/index.js on stdio
```

For local development with hot reload:

```sh
npm run dev
```

Type-check only:

```sh
npm run typecheck
```

## Architecture

- **Transport**: stdio (local subprocess — the standard for local MCP integrations).
- **SDK**: `@modelcontextprotocol/sdk` (the published, production TypeScript SDK).
- **Source**: `https://help.wealthsimple.com/api/v2/help_center/...` (Zendesk Help Center public API).
- **Locale**: `en-ca` by default; switch to `fr` via env.
- **Validation**: every API response is parsed through Zod schemas before being returned to a tool.
- **Caching**: per-URL TTL+LRU cache (default 30 min, 256 entries). The help center mutates slowly; cache hit rates are very high.
- **Resilience**: 15 s request timeout via `AbortController`; up to 2 retries with exponential backoff + jitter on 408 / 425 / 429 / 5xx.
- **HTML rendering**: article bodies are converted to clean Markdown by default (headings, lists, links preserved). Raw HTML and plain-text modes are also available.

```
src/index.ts        ── entry: env config → HelpCenterClient → McpServer → StdioServerTransport
src/tools.ts        ── 7 tool registrations (input + output Zod schemas, structuredContent)
src/zendesk.ts      ── HelpCenterClient: typed fetch, retries, timeouts, cache, pagination
src/schemas.ts      ── Zod schemas + inferred types for every Zendesk response shape
src/cache.ts        ── TTL + LRU cache (no deps)
src/html.ts         ── HTML → Markdown for article bodies (no deps)
```

## Tools

| Tool | Purpose |
| --- | --- |
| `search_help_center` | Full-text search across every published article. The first thing an agent should reach for. |
| `list_categories` | Top-level taxonomy: Get Started, Move Money, Investing, Spending, File Taxes, Your Profile. |
| `list_sections` | Sections inside a category (or all sections). |
| `list_articles` | Article summaries inside a single section. |
| `get_article` | Fetch a single article body (Markdown / HTML / text). |
| `resolve_help_url` | Resolve a public help.wealthsimple.com article URL → full content. Useful for following user-pasted links. |
| `browse_taxonomy` | Hierarchical view of the entire help center: categories → sections → article titles. Big payload — prefer `search_help_center` for targeted lookups. |

Every tool ships with both an `inputSchema` and an `outputSchema` so MCP clients receive validated structured content alongside the human-readable text content.

## Configuration

All configuration is via environment variables. Sensible defaults are provided.

| Env var | Default | Description |
| --- | --- | --- |
| `WEALTHSIMPLE_HELP_BASE_URL` | `https://help.wealthsimple.com/api/v2/help_center` | Base URL for the Zendesk Help Center API. |
| `WEALTHSIMPLE_HELP_LOCALE` | `en-ca` | Locale for category / section / article queries. |
| `WEALTHSIMPLE_HELP_USER_AGENT` | `wealthsimple-help-center-mcp/0.1 (+https://github.com/tatianathevisionary/wealthsimple-mcp; unaffiliated community project)` | User-Agent header sent to the help center. Identifies the source as this project (not Wealthsimple itself), so the upstream operator can attribute traffic correctly. |
| `WEALTHSIMPLE_HELP_TIMEOUT_MS` | `15000` | Per-request timeout in ms. |
| `WEALTHSIMPLE_HELP_CACHE_TTL_MS` | `1800000` (30 min) | Response cache TTL in ms. |

### Optional: Datadog APM + LLM Observability

Telemetry is **off by default** and adds zero overhead unless explicitly enabled — `dd-trace` is bundled but lazy-loaded. Set either `DD_API_KEY` (for agentless) or `WEALTHSIMPLE_HELP_TELEMETRY_ENABLED=true` (when you have a local Datadog Agent) to turn it on.

| Env var | Default | Description |
| --- | --- | --- |
| `WEALTHSIMPLE_HELP_TELEMETRY_ENABLED` | _(unset)_ | Set to `true` to initialize `dd-trace` (e.g. when running alongside a Datadog Agent on `localhost:8126`). |
| `DD_API_KEY` | _(unset)_ | If set, telemetry initializes automatically (typical for agentless mode). |
| `DD_SITE` | `datadoghq.com` | Datadog site, e.g. `us5.datadoghq.com`, `datadoghq.eu`. |
| `DD_SERVICE` | `wealthsimple-help-center-mcp` | Service name shown in Datadog. |
| `DD_ENV` | _(unset)_ | Environment tag, e.g. `prod`, `staging`, `dev`. |
| `DD_VERSION` | server version (`0.1.0`) | Version tag for deployments. |
| `DD_RUNTIME_METRICS_ENABLED` | `true` | Set to `false` to disable Node runtime metrics. |
| `DD_LLMOBS_ENABLED` | `false` | Set to `true` to enable LLM Observability spans. Each MCP tool call produces a `tool` span with `inputData` and `outputData` annotated. |
| `DD_LLMOBS_ML_APP` | `wealthsimple-help-center-mcp` | Logical app name in LLM Obs (used to group related traces). Setting this also implicitly enables LLM Obs. |
| `DD_LLMOBS_AGENTLESS_ENABLED` | `false` | Set to `true` to send LLM Obs spans directly to Datadog (skipping a local Agent). Requires `DD_API_KEY` and `DD_SITE`. |

Note: when an upstream agent that *also* runs Datadog calls this MCP server's tools, span context propagation through stdio MCP is not automatic — agent spans and these tool spans may appear as related but not strictly parented. To get a fully linked trace you need both sides instrumented and a context-propagating bridge in the MCP client.

#### Local development with telemetry

For convenience, copy `.env.example` to `.env` and fill in your `DD_API_KEY`. Then:

```sh
npm run start:telemetry   # node --env-file=.env build/index.js
npm run dev:telemetry     # tsx watch --env-file=.env src/index.ts
```

`.env` is gitignored. **Do not commit it.**

#### Wiring telemetry into an MCP host config

When you add this server to a Claude Desktop / Cursor / similar MCP config, pass the same env vars in the `env` block of that server entry:

```json
{
  "mcpServers": {
    "wealthsimple-help-center": {
      "command": "node",
      "args": ["/absolute/path/to/wealthsimple-mcp/build/index.js"],
      "env": {
        "DD_API_KEY": "...",
        "DD_SITE": "us5.datadoghq.com",
        "DD_LLMOBS_ENABLED": "true",
        "DD_LLMOBS_AGENTLESS_ENABLED": "true",
        "DD_LLMOBS_ML_APP": "wealthsimple-help-center-mcp"
      }
    }
  }
}
```

## Wiring into an MCP host

After `npm run build`, point your MCP client config at the built entry script:

```json
{
  "mcpServers": {
    "wealthsimple-help-center": {
      "command": "node",
      "args": ["/absolute/path/to/wealthsimple-mcp/build/index.js"]
    }
  }
}
```

For Claude Code:

```sh
claude mcp add wealthsimple-help-center -- node /absolute/path/to/wealthsimple-mcp/build/index.js
```

## Notes on the Zendesk API

- All endpoints used here are public and require no authentication.
- Be a good citizen: keep the User-Agent identifiable, respect retry-after on 429 (the client already does this implicitly via backoff), and let the cache do its job.
- The help center is bilingual; pass `WEALTHSIMPLE_HELP_LOCALE=fr` to target the French content set.

## Acknowledgments

This project sits on top of work done by others — credit where due:

- **[Wealthsimple Technologies Inc.](https://www.wealthsimple.com)** ([@wealthsimple](https://github.com/wealthsimple)) — for publishing a comprehensive, well-organized [help center](https://help.wealthsimple.com/hc/en-ca) and exposing it through a stable, public Zendesk JSON API. **Every article this server returns is authored and maintained by their team.** This project is grateful for their open, well-documented public API and would not exist without it.
- **[Anthropic](https://www.anthropic.com)** and the broader [Model Context Protocol](https://modelcontextprotocol.io) community — for the protocol spec and the [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) TypeScript SDK that this server is built on.
- **[Zendesk](https://www.zendesk.com)** — for the [Help Center](https://developer.zendesk.com/api-reference/help_center/help-center-api/) platform whose public API this server consumes.
- **[Datadog](https://www.datadoghq.com)** — for the [`dd-trace`](https://github.com/DataDog/dd-trace-js) Node SDK and the [LLM Observability](https://docs.datadoghq.com/llm_observability/) product used for optional telemetry.
- **[Colin McDonnell](https://github.com/colinhacks)** — for [Zod](https://zod.dev), used at every Zendesk response boundary for runtime validation.

### Trademarks

"Wealthsimple" is a registered trademark of Wealthsimple Technologies Inc. All references in this repository are descriptive and nominative — used solely to indicate that this MCP server interfaces with Wealthsimple's public help center API. No affiliation, sponsorship, or endorsement by Wealthsimple Technologies Inc. is claimed or implied. "Datadog" and "Zendesk" are trademarks of their respective owners.

### Reporting issues

- Bugs in **this MCP server**, schema drift, missing tools → open an issue on this repo.
- Anything about the **content** of a help center article, accuracy, or product behavior → contact Wealthsimple support directly via their [official help portal](https://help.wealthsimple.com/hc/en-ca/requests/new). This project does not modify or republish article text; it only fetches what the upstream public API returns.

## License

[MIT](./LICENSE) © contributors. Article content fetched from the Wealthsimple Help Center is © Wealthsimple Technologies Inc. and is *not* covered by this license — it is surfaced via their public API for use by tools that consume this server.
