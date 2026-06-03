/**
 * Optional Datadog APM + LLM Observability instrumentation.
 *
 * All telemetry is OPT-IN. If neither `DD_API_KEY` nor
 * `WEALTHSIMPLE_HELP_TELEMETRY_ENABLED=true` is set, this module is a no-op
 * and `dd-trace` is never even loaded — callers pay nothing.
 *
 * Boundary rule: this is the ONLY file in the package that imports `dd-trace`.
 * The rest of the codebase calls `traceTool()` / `traceZendeskRequest()`,
 * which transparently degrade to direct invocation when telemetry is off.
 *
 * stdio caveat: the MCP server speaks JSON-RPC over stdout. dd-trace v5 logs
 * to stderr by default, which is safe. We never enable any tracer logger that
 * targets stdout, since that would corrupt the protocol.
 */

import type ddTraceModule from 'dd-trace';

type Tracer = ReturnType<typeof ddTraceModule.init>;

const SERVICE_NAME = 'wealthsimple-help-center-mcp';

let tracer: Tracer | null = null;
let llmobsEnabled = false;
// Privacy redaction switches. Default OFF: full IO capture, full URLs.
// Operators with PII concerns flip these on via env. See README → Privacy.
let redactIo = false;
let redactUrls = false;

export function isTelemetryEnabled(): boolean {
    return tracer !== null;
}

/**
 * Normalize an arbitrary value into the `Record<string, unknown>` shape that
 * the LLM Obs annotate API expects. Plain objects pass through; anything else
 * (primitives, arrays, null) is wrapped under a `value` key so we never feed a
 * non-object to the tracer or rely on an unchecked cast.
 */
function toAnnotationData(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return { value };
}

/**
 * Initialize Datadog tracing if telemetry is enabled via env. Should be the
 * first await in `main()` so that all subsequent spans see an initialized
 * tracer. Safe to call repeatedly; subsequent calls are no-ops.
 */
export async function setupTelemetry(version: string): Promise<void> {
    if (tracer !== null) return;

    const explicit = process.env.WEALTHSIMPLE_HELP_TELEMETRY_ENABLED === 'true';
    const hasApiKey = Boolean(process.env.DD_API_KEY);
    if (!explicit && !hasApiKey) return;

    llmobsEnabled = process.env.DD_LLMOBS_ENABLED === 'true' || process.env.DD_LLMOBS_ML_APP !== undefined;

    redactIo = process.env.WEALTHSIMPLE_HELP_TELEMETRY_REDACT_IO === 'true';
    redactUrls = process.env.WEALTHSIMPLE_HELP_TELEMETRY_REDACT_URLS === 'true';

    const ddTrace = await import('dd-trace');

    const initOpts: Parameters<typeof ddTrace.default.init>[0] = {
        service: process.env.DD_SERVICE ?? SERVICE_NAME,
        version: process.env.DD_VERSION ?? version,
        runtimeMetrics: process.env.DD_RUNTIME_METRICS_ENABLED !== 'false',
        logInjection: false
    };
    if (process.env.DD_ENV !== undefined) {
        initOpts.env = process.env.DD_ENV;
    }
    // Pass DD_SITE explicitly when set. Without this, dd-trace defaults to
    // datadoghq.com (US1) for some integration paths even if DD_SITE is in
    // env — agentless LLM Obs spans in particular need this to reach the
    // correct regional intake (e.g. us5.datadoghq.com).
    if (process.env.DD_SITE !== undefined) {
        initOpts.site = process.env.DD_SITE;
    }
    if (llmobsEnabled) {
        initOpts.llmobs = {
            mlApp: process.env.DD_LLMOBS_ML_APP ?? SERVICE_NAME,
            agentlessEnabled: process.env.DD_LLMOBS_AGENTLESS_ENABLED === 'true'
        };
    }

    tracer = ddTrace.default.init(initOpts);

    process.stderr.write(
        `[telemetry] dd-trace initialized (service=${initOpts.service}, llmobs=${llmobsEnabled}, redactIo=${redactIo}, redactUrls=${redactUrls})\n`
    );

    process.on('beforeExit', flushTelemetry);
}

/**
 * Flush any buffered spans before the process exits. Safe to call when
 * telemetry is off (no-op).
 */
export function flushTelemetry(): void {
    const t = tracer;
    if (t === null) return;
    try {
        if (llmobsEnabled) t.llmobs.flush();
    } catch {
        // best-effort flush; nothing useful to do on error.
        // APM spans are flushed automatically by dd-trace on process exit.
    }
}

/**
 * Wrap an MCP tool handler. When LLM Observability is on, produces an LLM Obs
 * `tool` span (with inputData/outputData), letting upstream agent traces show
 * what this server did. Otherwise, produces a plain APM span.
 *
 * Privacy: when WEALTHSIMPLE_HELP_TELEMETRY_REDACT_IO=true, we still emit the
 * span (so latency / error / throughput signal is preserved) but we do NOT
 * annotate inputData / outputData. The free-text search query and the article
 * payload never leave the process. The span name + tool name are still tagged.
 */
export async function traceTool<T>(toolName: string, args: unknown, handler: () => Promise<T>): Promise<T> {
    const t = tracer;
    if (t === null) return handler();

    if (llmobsEnabled) {
        return t.llmobs.trace({ kind: 'tool', name: toolName }, async () => {
            try {
                const result = await handler();
                if (!redactIo) {
                    t.llmobs.annotate({
                        inputData: toAnnotationData(args),
                        outputData: toAnnotationData(result)
                    });
                }
                return result;
            } catch (err) {
                if (!redactIo) {
                    t.llmobs.annotate({
                        inputData: toAnnotationData(args),
                        outputData: { error: err instanceof Error ? err.message : String(err) }
                    });
                }
                throw err;
            }
        });
    }

    return t.trace(
        'mcp.tool.call',
        {
            resource: toolName,
            tags: {
                'mcp.tool.name': toolName,
                component: SERVICE_NAME
            }
        },
        async () => handler()
    );
}

/**
 * Wrap a Zendesk Help Center HTTP request. One span per logical request
 * (covers all retry attempts together).
 *
 * Privacy: when WEALTHSIMPLE_HELP_TELEMETRY_REDACT_URLS=true, the `http.url`
 * tag is also stripped of its query string (path-only). The `resource` is
 * always path-only for cardinality reasons. Search-term query strings
 * therefore never appear in the span when redactUrls is on.
 */
export async function traceZendeskRequest<T>(url: string, handler: () => Promise<T>): Promise<T> {
    const t = tracer;
    if (t === null) return handler();

    const tagUrl = redactUrls ? stripQuery(url) : url;

    return t.trace(
        'wealthsimple_help_center.request',
        {
            resource: stripQuery(url),
            tags: {
                'http.url': tagUrl,
                component: SERVICE_NAME
            }
        },
        async () => handler()
    );
}

function stripQuery(url: string): string {
    const i = url.indexOf('?');
    return i === -1 ? url : url.slice(0, i);
}
