# Wealthsimple Help Center MCP Server

A standalone **Model Context Protocol** server that exposes the [Wealthsimple Help Center](https://help.wealthsimple.com/hc/en-ca) to AI agents. Built on `@modelcontextprotocol/sdk` and the public Zendesk Help Center JSON API — no scraping, no auth, fully typed responses.

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
| `WEALTHSIMPLE_HELP_USER_AGENT` | `wealthsimple-help-center-mcp/0.1 (+https://help.wealthsimple.com)` | User-Agent header. |
| `WEALTHSIMPLE_HELP_TIMEOUT_MS` | `15000` | Per-request timeout in ms. |
| `WEALTHSIMPLE_HELP_CACHE_TTL_MS` | `1800000` (30 min) | Response cache TTL in ms. |

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
