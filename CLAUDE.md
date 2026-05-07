# CLAUDE.md

Guidance for Claude Code when working in this package (`wealthsimple-help-center-mcp`).

## What this package is

A standalone MCP server that exposes the **Wealthsimple Help Center** (https://help.wealthsimple.com/hc/en-ca) to AI agents over stdio. It depends on `@modelcontextprotocol/sdk` and `zod` from npm — no monorepo, no workspace coupling, no local SDK build required.

The data source is the **public Zendesk Help Center JSON API** (`https://help.wealthsimple.com/api/v2/help_center/...`) — there is no scraping, no auth, and no headless browser. If a future change requires data the Zendesk API does not expose, raise it with the user before introducing a scraping path.

## Build & test commands

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc → build/
npm start           # node build/index.js
npm run dev         # tsx watch src/index.ts
```

### Smoke test (stdio, no client needed)

```sh
{
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_help_center","arguments":{"query":"TFSA contribution","limit":2}}}'
  sleep 6
} | node build/index.js
```

## Architecture

Single-process stdio MCP server. Layered, not framework-y:

```
src/index.ts        ── entry: env config → setupTelemetry → HelpCenterClient → McpServer → StdioServerTransport
src/tools.ts        ── 7 tool registrations (input + output Zod schemas, structuredContent), each wrapped in traceTool()
src/zendesk.ts      ── HelpCenterClient: typed fetch, retries, timeouts, cache, pagination, getJson wrapped in traceZendeskRequest()
src/telemetry.ts    ── opt-in Datadog APM + LLM Obs (lazy-loaded dd-trace, no-op when disabled)
src/schemas.ts      ── Zod schemas + inferred types for every Zendesk response shape
src/cache.ts        ── TTL + LRU cache (no deps)
src/html.ts         ── HTML → Markdown for article bodies (no deps)
```

### Boundary rule

`zendesk.ts` is the only file that touches the network. `tools.ts` consumes typed domain objects; if a tool needs new data, extend the client and its schemas first, then the tool. Do not call `fetch` from `tools.ts` or `index.ts`.

`telemetry.ts` is the only file that imports `dd-trace`. The rest of the codebase calls `traceTool()` / `traceZendeskRequest()`, which transparently degrade to a direct call when telemetry is off. If you need a new instrumentation point, add a wrapper in `telemetry.ts` rather than reaching into `dd-trace` from elsewhere.

### stdio caveat for telemetry

The MCP server speaks JSON-RPC over **stdout**. Anything that writes to stdout corrupts the protocol. `dd-trace` v5 logs to stderr by default — keep it that way. Never enable a tracer logger that targets stdout.

### Why every tool has an `outputSchema`

MCP clients can render `structuredContent` with confidence when the tool ships a JSON Schema. Every tool returns both `content[]` (human-readable) and `structuredContent` (machine-readable). When adding a new tool, keep both — do not return only text.

## Code style

- **TypeScript strict** is on. `Node16` resolution, ES modules, `.js` import extensions.
- **No new runtime dependencies** without a strong reason. The runtime deps are Zod, `@modelcontextprotocol/sdk`, and (opt-in) `dd-trace` for Datadog APM + LLM Observability. Adding `cheerio`, `axios`, `node-html-parser`, etc. is unnecessary and out of scope.
- **No `any`**. If a Zendesk response shape isn't covered, add it to `schemas.ts` first.
- **Validate at the boundary**. Every Zendesk response goes through `schema.safeParse(...)` in `HelpCenterClient.getJson`. If parsing fails, throw a `HelpCenterError` with the URL — never return loosely-typed data to tools.
- **Errors**: throw `HelpCenterError` for known-bad responses (with `status` and `url` set). The entry point catches and logs to stderr; do not `console.log` to stdout — stdio transport hijacks it.
- **`registerTool` schema shape**: `inputSchema` and `outputSchema` take a **`ZodRawShape`** (a plain object of zod fields), NOT a `z.object({...})`. Nested schemas inside arrays still use `z.object({...})`. See `src/tools.ts` for examples.

## Adding a new tool

1. Confirm the data is reachable via a Zendesk Help Center endpoint that returns JSON.
2. Add a Zod schema to `src/schemas.ts` for the response shape.
3. Add a method to `HelpCenterClient` that calls `getJson` (single resource) or `depaginate` (collection), returning a typed domain object.
4. Register the tool in `src/tools.ts` with both `inputSchema` and `outputSchema` as `ZodRawShape` objects.
5. Return `{ content: [{ type: 'text', text: ... }], structuredContent: ... }`.
6. Run `npm run typecheck` and add a smoke-test invocation against a live request.

## Adding a new Zendesk endpoint

The Zendesk Help Center API is documented at https://developer.zendesk.com/api-reference/help_center/help-center-api/. The fields it returns are not always stable — when adding a new schema, default optional fields (`.optional()` or `.nullable().default(...)`) so a single missing field on one record doesn't fail the whole response. Bias towards permissive parsing of records we don't deeply use, strict parsing of records we expose.

## Caching & rate limits

- The default cache TTL is 30 min (256 entries, LRU). The help center mutates slowly; this is plenty for an interactive agent session and is safe to raise.
- Retries are 0–2 with exponential backoff + jitter on 408 / 425 / 429 / 5xx. Do not set `maxRetries` higher than 4 without a real reason — the upstream API is fast and 429s under normal use are rare.
- The User-Agent identifies the server. If the user wants to anonymize, override via `WEALTHSIMPLE_HELP_USER_AGENT` rather than removing it.

## Locale

Defaults to `en-ca`. The help center also publishes `fr` content via the same API; setting `WEALTHSIMPLE_HELP_LOCALE=fr` swaps every `/{locale}/...` path.

## Out of scope

- HTML scraping of `help.wealthsimple.com/hc/...` pages.
- Anything that requires a Wealthsimple session / OAuth — this is the **public help center**, not user data.
- Writing back to Zendesk (creating articles, votes, comments). Public API is read-only and that is intentional.
- Browser/Cloudflare Workers transport. This is a stdio server; if remote transport is needed, add a sibling package rather than complicating this one.

## Notes on the `typescript-sdk/` sibling directory

The directory `typescript-sdk/` next to this package is a clone of the upstream MCP TypeScript SDK monorepo (the v2-alpha source tree). It is **reference material only** — this package consumes the published `@modelcontextprotocol/sdk` from npm, not anything in `typescript-sdk/`. Do not introduce dependencies on the local SDK clone; do not modify files inside `typescript-sdk/` as part of work on this package.
