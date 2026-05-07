# Contributing

Thanks for considering a contribution to the **Wealthsimple Help Center MCP server**. This file documents how to develop on the project, how issues and pull requests are organised, and what conventions are enforced. Read it before opening a substantive PR — it will save a review cycle.

> Reminder: this is an **independent, unofficial project**. It is not built, sponsored, or endorsed by Wealthsimple Technologies Inc. See the [README's disclaimer](./README.md) for the full attribution stance.

## Code of conduct

Be kind. Assume good faith. Disagree on technical merit, not personally. If a maintainer asks you to revise an issue or PR, that's not a rejection — it's the review.

## Before you open an issue

Three things to check first:

1. **Is it a bug in this MCP server?** If yes — open an issue here.
2. **Is it a question about the *content* of a help center article** (accuracy, product behavior, "is this still true")? Don't open an issue here. Contact Wealthsimple support directly via the [official help portal](https://help.wealthsimple.com/hc/en-ca/requests/new). This project does not author or modify article text; it only fetches what the upstream public Zendesk API returns.
3. **Is it a feature request that requires data not exposed by the public Zendesk Help Center API?** Open an issue and tag it `concern/upstream-api` — but expect the answer to be "we don't scrape, and we don't add a Wealthsimple-account-data path."

When you open an issue, please apply the appropriate labels yourself (see [Labelling system](#labelling-system) below). If you don't, a maintainer will triage and label.

## Development setup

Requirements:

- **Node ≥ 20** (the project uses `node --env-file` and other modern features).
- **npm** (no other package manager is supported in this repo).

```sh
git clone https://github.com/tatianathevisionary/wealthsimple-mcp.git
cd wealthsimple-mcp
npm install
npm run typecheck    # tsc --noEmit
npm run build        # tsc → build/
npm start            # runs build/index.js on stdio
```

For local development with hot reload:

```sh
npm run dev          # tsx watch src/index.ts
```

### Smoke test (no MCP client required)

The server speaks JSON-RPC over stdio. You can drive it from a shell to verify a change end-to-end:

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

You should see clean JSON-RPC responses on stdout and zero stderr noise (when telemetry is off).

## Architectural rules (please respect these)

The codebase is small but layered. A few rules are enforced by code review:

| Rule | Why |
| --- | --- |
| **`src/zendesk.ts` is the only file that touches the network.** | If a tool needs new data, extend the client + its schemas first, then the tool. Do not call `fetch` from `tools.ts` or `index.ts`. |
| **`src/telemetry.ts` is the only file that imports `dd-trace`.** | Telemetry is opt-in and reversible. Keeping `dd-trace` references in one file means swapping the observability vendor (or removing it) is a localised change. |
| **Every Zendesk response goes through a Zod schema in `src/schemas.ts`.** | Validate at the boundary; never return loosely-typed data to tools. |
| **No new runtime dependencies without strong justification.** | The whole server runs on Node ≥ 20 built-ins + Zod + `@modelcontextprotocol/sdk` (+ optional lazy-loaded `dd-trace`). Adding `cheerio`, `axios`, etc. is out of scope. |
| **No HTML scraping of `help.wealthsimple.com/hc/...` pages.** | If a feature requires data the Zendesk API doesn't expose, raise it before writing code. Scraping is not the answer this project will accept. |
| **No `console.log` to stdout from anywhere.** | The MCP transport hijacks stdout for JSON-RPC. Anything you want to print must go to stderr (`console.error` or `process.stderr.write`). |
| **`registerTool` schemas use `ZodRawShape`, not `z.object({...})`.** | See `src/tools.ts` for examples. Both `inputSchema` and `outputSchema` are required for every tool — clients render `structuredContent` from the output schema. |

If you're unsure whether a change crosses a boundary, file a `type/refactor` or `type/enhancement` issue first and we can talk about shape before you write code.

## Labelling system

Issues and pull requests are organised with a small **prefixed-namespace** label system. Each prefix answers one question.

### `type/*` — what kind of work is this? (apply one)

| Label | When to use |
| --- | --- |
| `bug` | Something is broken or behaves incorrectly. |
| `enhancement` | New capability or improvement to an existing capability. |
| `documentation` | Documentation only (README, CONTRIBUTING, code comments). |
| `type/refactor` | Internal restructuring; no behavior change. |
| `type/chore` | Deps, tooling, CI, build scripts, housekeeping. |
| `type/security` | Security-related work or vulnerability. |
| `type/test` | Tests only. |

Note: `bug`, `enhancement`, and `documentation` are GitHub's defaults — we use them as the type indicators for those three categories rather than introducing prefixed duplicates. Everything else is prefixed `type/*`.

### `priority/*` — how urgent? (apply at most one)

| Label | When to use |
| --- | --- |
| `priority/critical` | Drop everything: production-broken or security issue. |
| `priority/high` | Next up after current work. |
| `priority/normal` | Default; do when capacity allows. (You usually want this.) |
| `priority/low` | Nice-to-have; no time pressure. |

If you don't apply a priority, the maintainer will assume `priority/normal`.

### `concern/*` — cross-cutting concerns specific to this project (apply zero or more)

| Label | When to use |
| --- | --- |
| `concern/privacy` | Touches PII, data capture, redaction, or telemetry surface. Forces a privacy-review pass before merge. |
| `concern/upstream-api` | Behavior depends on the Zendesk Help Center API. Verify against the live API before merging. |
| `concern/legal` | Attribution, license, trademarks, content rights. |
| `concern/breaking-change` | Changes the public MCP tool surface (tool name, args, schema) or env-var contract. |
| `concern/performance` | Latency, memory, cache hit rate, retry budget. |

Apply concerns liberally — they're the maintainer's signal to slow down and check something extra.

### Lifecycle / community labels

These keep their GitHub-default meanings:

| Label | When to use |
| --- | --- |
| `good first issue` | Small, well-scoped, well-described — suitable for a first-time contributor. Maintainer-applied. |
| `help wanted` | Maintainer is actively looking for community contribution here. |
| `duplicate` | Already filed elsewhere. Closes with a link to the original. |
| `wontfix` | Acknowledged, but won't be worked on. Always paired with a comment explaining why. |
| `invalid` | Not actionable / not a real bug / out of scope for the project. |
| `question` | Q&A; no code change expected. |

### Common combinations

A few examples of how the system is meant to be used together:

| Scenario | Labels |
| --- | --- |
| New MCP tool that fetches a new Zendesk endpoint | `enhancement`, `concern/upstream-api` |
| Found a regex bug in the HTML→Markdown converter | `bug`, `priority/normal` |
| Bumping `dd-trace` to a new major version | `type/chore`, `concern/privacy` (telemetry surface), `priority/normal` |
| Renaming a tool's input field | `enhancement`, `concern/breaking-change`, `priority/high` |
| Wealthsimple sends a takedown / attribution request | `type/chore`, `concern/legal`, `priority/critical` |
| Help Center returns a new field in `articles` and our schema rejects it | `bug`, `concern/upstream-api`, `priority/high` |

## Pull request conventions

1. **Open a related issue first** for anything more substantial than a typo. Reference it in the PR with `Closes #N` so the merge auto-closes the issue.
2. **One concern per PR.** If a refactor and a feature naturally belong together, split them into stacked PRs rather than one big one.
3. **Run typecheck and a smoke test before pushing.** CI may not catch everything; the smoke test in this file is the minimum bar.
4. **Mark the PR as Draft** until it's ready for review. Flip it to "Ready for review" with the same labels as the linked issue (plus any additional concerns the implementation surfaced).
5. **PR description must include**:
   - A `Closes #N` line.
   - A short summary (one paragraph).
   - A test plan: how a reviewer can verify the change.
   - Any new env vars, breaking changes, or `concern/*` flags called out explicitly.

PR #2 is a worked example of the format the project uses.

## Commit message conventions

Loose, but with a few rules:

- **First line ≤ 72 characters.** Imperative mood. ("Add privacy redaction flags," not "Added" or "Adding.")
- **Body is optional but expected for non-trivial commits.** Explain *why*, not *what* (the diff shows what).
- **No conventional-commits prefixes** (`feat:`, `fix:`, etc.) are required. Plain English subjects are fine and arguably more readable.
- **Reference the issue in the body** when relevant: `Refs #1` or `Part of #1`.

## Privacy & data tracking

If your change touches `src/telemetry.ts` or any code path that may be captured by telemetry, **you must** apply the `concern/privacy` label and update the README's "Privacy & data tracking" section if the data inventory changes. The redaction defaults are sticky — propose a change to them in an issue before the PR.

## Releasing

There is no formal release process yet. The package is consumed directly from the GitHub repo (`git+https://github.com/tatianathevisionary/wealthsimple-mcp.git`) and pinned by commit. If a tagged release becomes useful, it'll be added here.

## Questions

Open an issue with the `question` label, or reach the maintainer via the GitHub profile linked in `package.json`.
