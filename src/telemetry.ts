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

export function isTelemetryEnabled(): boolean {
    return tracer !== null;
}

export function isLlmObsEnabled(): boolean {
    return llmobsEnabled;
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

    llmobsEnabled =
        process.env.DD_LLMOBS_ENABLED === 'true' ||
        process.env.DD_LLMOBS_ML_APP !== undefined;

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
    if (llmobsEnabled) {
        initOpts.llmobs = {
            mlApp: process.env.DD_LLMOBS_ML_APP ?? SERVICE_NAME,
            agentlessEnabled: process.env.DD_LLMOBS_AGENTLESS_ENABLED === 'true'
        };
    }

    tracer = ddTrace.default.init(initOpts);
}

/**
 * Wrap an MCP tool handler. When LLM Observability is on, produces an LLM Obs
 * `tool` span (with inputData/outputData), letting upstream agent traces show
 * what this server did. Otherwise, produces a plain APM span.
 */
export async function traceTool<T>(
    toolName: string,
    args: unknown,
    handler: () => Promise<T>
): Promise<T> {
    const t = tracer;
    if (t === null) return handler();

    if (llmobsEnabled) {
        return t.llmobs.trace(
            { kind: 'tool', name: toolName },
            async () => {
                try {
                    const result = await handler();
                    t.llmobs.annotate({
                        inputData: args as Record<string, unknown>,
                        outputData: result as Record<string, unknown>
                    });
                    return result;
                } catch (err) {
                    t.llmobs.annotate({
                        inputData: args as Record<string, unknown>,
                        outputData: { error: err instanceof Error ? err.message : String(err) }
                    });
                    throw err;
                }
            }
        );
    }

    return t.trace(
        'mcp.tool.call',
        {
            resource: toolName,
            tags: {
                'mcp.tool.name': toolName,
                'component': SERVICE_NAME
            }
        },
        async () => handler()
    );
}

/**
 * Wrap a Zendesk Help Center HTTP request. One span per logical request
 * (covers all retry attempts together).
 */
export async function traceZendeskRequest<T>(
    url: string,
    handler: () => Promise<T>
): Promise<T> {
    const t = tracer;
    if (t === null) return handler();

    return t.trace(
        'wealthsimple_help_center.request',
        {
            resource: stripQuery(url),
            tags: {
                'http.url': url,
                'component': SERVICE_NAME
            }
        },
        async () => handler()
    );
}

function stripQuery(url: string): string {
    const i = url.indexOf('?');
    return i === -1 ? url : url.slice(0, i);
}
