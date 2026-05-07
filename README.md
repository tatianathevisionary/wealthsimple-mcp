# 💰 Wealthsimple Help Center MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
![MCP Server](https://img.shields.io/badge/MCP-Server-blue?style=for-the-badge)
![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white&style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white&style=for-the-badge)
![Datadog LLM Obs](https://img.shields.io/badge/Datadog-LLM%20Obs%20(optional)-632CA6?logo=datadog&logoColor=white&style=for-the-badge)

![GitHub Stars](https://img.shields.io/github/stars/tatianathevisionary/wealthsimple-mcp?style=social)
![GitHub Forks](https://img.shields.io/github/forks/tatianathevisionary/wealthsimple-mcp?style=social)
![GitHub Issues](https://img.shields.io/github/issues/tatianathevisionary/wealthsimple-mcp?style=social)
![Last Commit](https://img.shields.io/github/last-commit/tatianathevisionary/wealthsimple-mcp?style=social)

**Unofficial Model Context Protocol server that wires AI agents into the [Wealthsimple Help Center](https://help.wealthsimple.com/hc/en-ca) — 7 typed tools for full-text search, taxonomy browsing, and article retrieval. Public Zendesk JSON API only. No scraping. No account credentials. Opt-in observability with privacy redaction.**

> 🪙 **Independent, unofficial project.**
> This is a community-built MCP integration. It is **not** built, endorsed, sponsored, or maintained by [Wealthsimple Technologies Inc.](https://www.wealthsimple.com) or [@wealthsimple](https://github.com/wealthsimple) on GitHub. "Wealthsimple", the help center, and all article content remain the property of Wealthsimple Technologies Inc.; this server only fetches and surfaces what their **public, unauthenticated** [Zendesk Help Center API](https://help.wealthsimple.com/api/v2/help_center/) chooses to return. For account-specific or product support, please contact Wealthsimple directly via their [official channels](https://help.wealthsimple.com/hc/en-ca/requests/new).

## 💸 What it does

The Wealthsimple Help Center is the canonical source of truth for how Wealthsimple's products work — TFSA / RRSP / FHSA mechanics, transfer rules, fees, tax slips, supported countries, options trading, crypto, Cash, Trade, Invest, and more. Wiring an agent into the help center via this MCP server lets it answer Wealthsimple-related questions with **cited, up-to-date, structured content** rather than memorized snapshots from training data.

This MCP exposes the help center via 7 specialised tools, each with both an `inputSchema` and an `outputSchema` so MCP clients receive validated `structuredContent` alongside the human-readable text. Every Zendesk response is parsed through Zod schemas at the network boundary — tools never see loosely-typed data.

## 💡 Why it's useful

- **🪙 Cited, up-to-date answers** — every article a tool returns includes its public help-center URL, so the agent can ground claims in a real source rather than guessing.
- **📈 Type-safe end-to-end** — TypeScript strict mode + Zod boundary validation. A breaking change in the upstream API surfaces as a parse error, not corrupt agent context.
- **🏦 No auth, no scraping, no surprise costs** — runs entirely on the public, unauthenticated Zendesk Help Center API. Zero rate limits in normal use.
- **💰 Cache-friendly by default** — 30 min TTL + 256-entry LRU cache. The help center mutates slowly; cache hit rates are very high in interactive sessions.
- **⚡ Resilient client** — 15 s request timeouts, up to 2 retries with exponential backoff + jitter on 408 / 425 / 429 / 5xx.
- **🔒 Opt-in observability with privacy redaction** — Datadog LLM Observability built in but **off by default**. When on, two redaction flags let you keep latency / error / throughput signal without forwarding free-text user queries.
- **🇨🇦 Bilingual ready** — `WEALTHSIMPLE_HELP_LOCALE=fr` swaps to the French content set.
- **🧱 Boundary-clean architecture** — `zendesk.ts` is the only file that touches the network; `telemetry.ts` is the only file that imports `dd-trace`. Easy to reason about, easy to swap vendors.

## 🪙 Tools (7 total)

Every tool below ships with both `inputSchema` and `outputSchema` (Zod-validated). Clients render `structuredContent` alongside the human-readable text.

### Search & discovery

| Tool | Purpose |
| --- | --- |
| **`search_help_center`** | Full-text search across every published article. **Reach for this first.** Returns ranked results with title, URL, snippet, labels, section IDs. |
| **`browse_taxonomy`** | Hierarchical view of the entire help center: categories → sections → article titles. Big payload — prefer `search_help_center` for targeted lookups, this one for orientation. |

### Taxonomy navigation

| Tool | Purpose |
| --- | --- |
| **`list_categories`** | Top-level taxonomy: Get Started, Move Money, Investing, Spending, File Taxes, Your Profile. |
| **`list_sections`** | Sections inside a category (or all sections). |
| **`list_articles`** | Article summaries inside a single section. |

### Article retrieval

| Tool | Purpose |
| --- | --- |
| **`get_article`** | Fetch a single article body by ID. Returns Markdown by default; `format: "html"` or `"text"` available. |
| **`resolve_help_url`** | Resolve a public `help.wealthsimple.com` article URL → full content. Useful for following user-pasted links. |

## 💬 Example query

Once connected, try asking your AI assistant:

> "Use the wealthsimple-help-center MCP to explain how the FHSA contribution room carryover works. Search the help center for FHSA contribution rules, fetch the most relevant article in full, and cite the public URL in your answer."

Behind the scenes the agent calls `search_help_center({ query: "FHSA contribution carryover" })`, picks the top result, calls `get_article({ article_id: <id>, format: "markdown" })`, and grounds the answer in the Markdown body — with the original `help.wealthsimple.com` URL as the citation.

## 🏦 Get started

### Prerequisites

- **Node ≥ 20** (uses `node --env-file` and other modern features)
- **npm** (no other package manager supported in this repo)

### Quick start

```sh
git clone https://github.com/tatianathevisionary/wealthsimple-mcp.git
cd wealthsimple-mcp
npm install
npm run build
npm start            # runs build/index.js on stdio
```

For local development with hot reload:

```sh
npm run dev          # tsx watch src/index.ts
```

Type-check only:

```sh
npm run typecheck
```

### Smoke test (no MCP client required)

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

You should see clean JSON-RPC over stdout, all 7 tools listed, and 2 real Wealthsimple TFSA articles returned.

### Wire into an MCP host

After `npm run build`, point your MCP client config at the built entry script.

**Claude Desktop / Cursor / VS Code** (`mcp.json`):

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

**Claude Code:**

```sh
claude mcp add wealthsimple-help-center -- node /absolute/path/to/wealthsimple-mcp/build/index.js
```

## ⚙️ Configuration

All configuration is via environment variables. Sensible defaults are provided.

### Core

| Env var | Default | Description |
| --- | --- | --- |
| `WEALTHSIMPLE_HELP_BASE_URL` | `https://help.wealthsimple.com/api/v2/help_center` | Base URL for the Zendesk Help Center API. |
| `WEALTHSIMPLE_HELP_LOCALE` | `en-ca` | Locale for category / section / article queries. Set to `fr` for French. |
| `WEALTHSIMPLE_HELP_USER_AGENT` | `wealthsimple-help-center-mcp/0.1 (+https://github.com/tatianathevisionary/wealthsimple-mcp; unaffiliated community project)` | User-Agent header sent to the help center. Identifies traffic as this project (not Wealthsimple itself). |
| `WEALTHSIMPLE_HELP_TIMEOUT_MS` | `15000` | Per-request timeout in ms. |
| `WEALTHSIMPLE_HELP_CACHE_TTL_MS` | `1800000` (30 min) | Response cache TTL in ms. |

### Optional: Datadog APM + LLM Observability

Telemetry is **off by default** and adds zero overhead unless explicitly enabled — `dd-trace` is bundled but lazy-loaded. Set either `DD_API_KEY` (for agentless) or `WEALTHSIMPLE_HELP_TELEMETRY_ENABLED=true` (when you have a local Datadog Agent) to turn it on.

> 🚨 **Read [Privacy & data tracking](#-privacy--data-tracking) before turning telemetry on.** When LLM Observability is enabled, this MCP captures tool inputs (including free-text search queries) and outputs and ships them to Datadog. The default (off) sends nothing. Two opt-in redaction flags (`WEALTHSIMPLE_HELP_TELEMETRY_REDACT_IO`, `WEALTHSIMPLE_HELP_TELEMETRY_REDACT_URLS`) let you keep telemetry on without forwarding content.

| Env var | Default | Description |
| --- | --- | --- |
| `WEALTHSIMPLE_HELP_TELEMETRY_ENABLED` | _(unset)_ | Set to `true` to initialize `dd-trace` (e.g. when running alongside a Datadog Agent on `localhost:8126`). |
| `DD_API_KEY` | _(unset)_ | If set, telemetry initializes automatically (typical for agentless mode). |
| `DD_SITE` | `datadoghq.com` | Datadog site, e.g. `us5.datadoghq.com`, `datadoghq.eu`. |
| `DD_SERVICE` | `wealthsimple-help-center-mcp` | Service name shown in Datadog. |
| `DD_ENV` | _(unset)_ | Environment tag, e.g. `prod`, `staging`, `dev`. |
| `DD_VERSION` | server version | Version tag for deployments. |
| `DD_RUNTIME_METRICS_ENABLED` | `true` | Set to `false` to disable Node runtime metrics. |
| `DD_LLMOBS_ENABLED` | `false` | Set to `true` to enable LLM Observability spans. Each MCP tool call produces a `tool` span. |
| `DD_LLMOBS_ML_APP` | `wealthsimple-help-center-mcp` | Logical app name in LLM Obs. Setting this implicitly enables LLM Obs. |
| `DD_LLMOBS_AGENTLESS_ENABLED` | `false` | Send LLM Obs spans directly to Datadog (no local Agent). Requires `DD_API_KEY` + `DD_SITE`. |
| `WEALTHSIMPLE_HELP_TELEMETRY_REDACT_IO` | `false` | Skip annotating `inputData` / `outputData` on tool spans. Span structure (name, latency, error status) is preserved; only the *content* is dropped. |
| `WEALTHSIMPLE_HELP_TELEMETRY_REDACT_URLS` | `false` | Strip query strings from the `http.url` tag on Zendesk request spans. Use alongside `_REDACT_IO` to remove all search-term content. |

#### Local development with telemetry

Copy `.env.example` to `.env`, fill in `DD_API_KEY`, then:

```sh
npm run start:telemetry   # node --env-file=.env build/index.js
npm run dev:telemetry     # tsx watch --env-file=.env src/index.ts
```

`.env` is gitignored. **Do not commit it.**

#### Wiring telemetry into an MCP host

When adding this server to a Claude Desktop / Cursor / similar MCP config, pass the env vars in the `env` block:

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

## 🔒 Privacy & data tracking

When telemetry is on (and only then), this server sends data over the network to Datadog. Be deliberate about enabling it — what follows is the **full inventory** of what gets shipped, what does not, and how to redact further.

### What is sent to Datadog (only when telemetry is on)

- **Per tool call** — tool name (e.g. `search_help_center`), latency, success/error status. With `DD_LLMOBS_ENABLED=true`, also:
  - `inputData` — the **full arguments the upstream agent passed in**. For most tools (`list_categories`, `list_sections`, `get_article`, `browse_taxonomy`) this is just numeric/string IDs and is low-risk. For `search_help_center` it includes the **free-text query string**, which agents typically forward verbatim from a user prompt. **If your user types personal information into their agent — name, email, account number, government IDs, financial details — it can end up in this field.**
  - `outputData` — the tool's response. Help Center articles are **public content** authored by Wealthsimple, so no Wealthsimple user PII flows out this way; the worst case is a verbose article body.
- **Per outbound Zendesk request** — full URL (including the search-term query string), HTTP status, retry count, latency.
- **`dd-trace` defaults** — Node runtime metrics (CPU, RSS memory, GC, event-loop), process info (pid, hostname), error stack traces (which include local file paths from your machine).

### What is NOT sent (and structurally cannot be)

- Any **Wealthsimple account data** — balances, holdings, transactions, KYC info, session tokens, identity documents. **This server only talks to the public, unauthenticated help center API.** It has no path to user-account endpoints; Wealthsimple PII is structurally out of reach.
- Your `DD_API_KEY` — used by `dd-trace` for transport, never logged or serialized into spans.
- The contents of `.env` as a file — only the env vars `dd-trace` and this module explicitly read are used.
- Anything from other processes on your machine — telemetry instrumentation is scoped to this server's own code.

### Where the data goes

To the Datadog regional intake set in `DD_SITE` (e.g. `us5.datadoghq.com`). It is then governed by your [Datadog data retention and privacy settings](https://docs.datadoghq.com/data_security/). Data does **not** flow to Wealthsimple, to this project's maintainers, or to any other third party. Wealthsimple has no visibility into your telemetry — it's a separate channel.

### Mitigations available

| Knob | Effect |
| --- | --- |
| Leave telemetry off (default) | Nothing sent anywhere. |
| `WEALTHSIMPLE_HELP_TELEMETRY_REDACT_IO=true` | Tool spans still emit (latency, error counts, throughput preserved) but `inputData` and `outputData` are **never annotated**. Recommended if your agent forwards free-text from external users. |
| `WEALTHSIMPLE_HELP_TELEMETRY_REDACT_URLS=true` | Strips query strings from the `http.url` tag on Zendesk request spans. Path remains tagged for routing analysis; the search term is removed. |
| `DD_TRACE_OBFUSCATION_QUERY_STRING_REGEXP=...` | Native `dd-trace` flag for finer-grained query-string redaction across all HTTP integrations. See the [`dd-trace` data security docs](https://docs.datadoghq.com/tracing/configure_data_security/). |
| `DD_RUNTIME_METRICS_ENABLED=false` | Stop emitting Node runtime metrics. Useful if you want zero machine fingerprinting. |

### Recommended posture

- **Solo / personal use** where you control every query → enabling telemetry with full IO capture is fine and gives the best signal.
- **Shared device, team, or anyone-but-you typing the queries** → set `WEALTHSIMPLE_HELP_TELEMETRY_REDACT_IO=true` and `WEALTHSIMPLE_HELP_TELEMETRY_REDACT_URLS=true`. You still get latency, error rates, and throughput; you do not ship user content.
- **Production / customer-facing deployment** → keep telemetry off, or run with both redaction flags **plus** a privacy review of `dd-trace`'s default capture set against your DPA / privacy policy. This project's authors have not done a formal DPIA — that is on the operator.

This server does not, and is structurally unable to, send the Wealthsimple Help Center any of its telemetry data — telemetry is a separate channel to Datadog only.

## 🤝 Acknowledgments

This project sits on top of work done by others — credit where due:

- **[Wealthsimple Technologies Inc.](https://www.wealthsimple.com)** ([@wealthsimple](https://github.com/wealthsimple)) — for publishing a comprehensive, well-organised [help center](https://help.wealthsimple.com/hc/en-ca) and exposing it through a stable, public Zendesk JSON API. **Every article this server returns is authored and maintained by their team.** This project is grateful for their open, well-documented public API and would not exist without it.
- **[Anthropic](https://www.anthropic.com)** and the broader [Model Context Protocol](https://modelcontextprotocol.io) community — for the protocol spec and the [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) TypeScript SDK that this server is built on.
- **[Zendesk](https://www.zendesk.com)** — for the [Help Center](https://developer.zendesk.com/api-reference/help_center/help-center-api/) platform whose public API this server consumes.
- **[Datadog](https://www.datadoghq.com)** — for the [`dd-trace`](https://github.com/DataDog/dd-trace-js) Node SDK and the [LLM Observability](https://docs.datadoghq.com/llm_observability/) product used for optional telemetry.
- **[Colin McDonnell](https://github.com/colinhacks)** — for [Zod](https://zod.dev), used at every Zendesk response boundary for runtime validation.
- **[damionrashford/RivalSearchMCP](https://github.com/damionrashford/RivalSearchMCP)** — for the README structure inspiration (badges row, FAQ, "give it a star" pattern). A solid example of a community-built MCP server presenting itself professionally.

## ❓ FAQ

### Do I need a Wealthsimple account?

**No.** This server only talks to the **public, unauthenticated** [Zendesk Help Center API](https://help.wealthsimple.com/api/v2/help_center/). No Wealthsimple credentials, no OAuth, no session — there's literally no code path here that touches Wealthsimple-account data.

### Do I need any API keys?

**No, not for the MCP itself.** The Zendesk Help Center API is unauthenticated. The only API key that matters is **optional**: `DD_API_KEY` if you want to enable Datadog telemetry. Without it, the server runs as a pure local process and `dd-trace` is never even loaded.

### Is this an official Wealthsimple project?

**No.** This is an independent, community-built integration. It is not built, sponsored, endorsed, or maintained by Wealthsimple Technologies Inc. or [@wealthsimple](https://github.com/wealthsimple). For account-specific or product support, contact Wealthsimple directly via their [official help portal](https://help.wealthsimple.com/hc/en-ca/requests/new).

### Will my account balance / transactions / personal info be sent anywhere?

**Structurally no.** This MCP only fetches public help center articles. There is no code path here that can read account balances, transactions, KYC info, session tokens, or any other Wealthsimple-side personal data — the upstream API doesn't expose it and this project doesn't authenticate. The only PII risk is if **your prompts to the agent** include personal information that the agent then forwards verbatim into a `search_help_center.query`. The Privacy section above explains how to redact even that.

### Does this scrape `help.wealthsimple.com`?

**No.** The server uses the public Zendesk Help Center JSON API exclusively. No HTML parsing of `/hc/...` pages, no headless browser, no anti-bot circumvention. If a feature requires data the Zendesk API doesn't expose, the answer will be "we won't add it" rather than "let's scrape."

### What MCP clients work with this?

Any MCP-compatible client. Tested locally with **Claude Desktop**, **Cursor**, **Claude Code**, and **VS Code MCP** via stdio transport. See [Wire into an MCP host](#-get-started) for config snippets.

### Why TypeScript / why Zod / why this much ceremony for a help-center search?

Because the Zendesk API's response shapes occasionally change a field, and an agent corrupting on a silent shape drift is a much worse failure mode than a parse error at the boundary. Zod's `safeParse` at every response converts upstream surprises into typed errors that surface in stderr instead of malformed `structuredContent` poisoning a tool result. The TypeScript-strict + Zod combination is doing real work, not aesthetic work.

### Can I self-host / fork / change the locale?

Yes. MIT-licensed; clone freely. Set `WEALTHSIMPLE_HELP_LOCALE=fr` to switch to the French content set (the help center is bilingual). All other env vars are documented above.

### How do I contribute?

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev setup, architectural rules, labelling system, and PR conventions. TL;DR: open an issue first, work on a branch, PR with `Closes #N`.

### How do I report a bug vs. a problem with article content?

- **Bug in this MCP server** (schema drift, broken tool, missing feature) → [open an issue](https://github.com/tatianathevisionary/wealthsimple-mcp/issues) on this repo.
- **Problem with the *content* of a help center article** (accuracy, product behavior, "is this still true") → contact Wealthsimple support via their [official help portal](https://help.wealthsimple.com/hc/en-ca/requests/new). This project does not author or modify article text.

## 📜 License & Trademarks

[MIT License](./LICENSE) © contributors. Article content fetched from the Wealthsimple Help Center is © Wealthsimple Technologies Inc. and is **not** covered by this license — it is surfaced via their public API for use by tools that consume this server, never redistributed or bundled.

"Wealthsimple" is a registered trademark of Wealthsimple Technologies Inc. All references in this repository are descriptive and nominative — used solely to indicate that this MCP server interfaces with Wealthsimple's public help center API. No affiliation, sponsorship, or endorsement by Wealthsimple Technologies Inc. is claimed or implied. "Datadog", "Zendesk", "Anthropic", and "Model Context Protocol" are trademarks of their respective owners.

## ⭐ Like this project? Give it a star!

If you find this MCP useful — for grounding agent answers in Wealthsimple's actual help center, for studying how to build a typed MCP server, for learning what opt-in privacy-aware telemetry looks like — please consider giving it a star. It helps others discover the project and motivates continued maintenance.

[![Star this repo](https://img.shields.io/github/stars/tatianathevisionary/wealthsimple-mcp?style=social)](https://github.com/tatianathevisionary/wealthsimple-mcp)
