#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupTelemetry } from './telemetry.js';
import { registerTools } from './tools.js';
import { HelpCenterClient, HelpCenterError } from './zendesk.js';

const SERVER_NAME = 'wealthsimple-help-center';
const SERVER_VERSION = '0.1.0';

function readNumberEnv(name: string): number | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(
            `Environment variable ${name} must be a positive finite number; got ${JSON.stringify(raw)}`
        );
    }
    return value;
}

async function main(): Promise<void> {
    await setupTelemetry(SERVER_VERSION);

    const timeoutMs = readNumberEnv('WEALTHSIMPLE_HELP_TIMEOUT_MS');
    const cacheTtlMs = readNumberEnv('WEALTHSIMPLE_HELP_CACHE_TTL_MS');

    const client = new HelpCenterClient({
        ...(process.env.WEALTHSIMPLE_HELP_BASE_URL !== undefined && {
            baseUrl: process.env.WEALTHSIMPLE_HELP_BASE_URL
        }),
        ...(process.env.WEALTHSIMPLE_HELP_LOCALE !== undefined && {
            locale: process.env.WEALTHSIMPLE_HELP_LOCALE
        }),
        ...(process.env.WEALTHSIMPLE_HELP_USER_AGENT !== undefined && {
            userAgent: process.env.WEALTHSIMPLE_HELP_USER_AGENT
        }),
        ...(timeoutMs !== undefined && { requestTimeoutMs: timeoutMs }),
        ...(cacheTtlMs !== undefined && { cacheTtlMs })
    });

    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            instructions:
                'Provides search, taxonomy, and full-text retrieval over the Wealthsimple Help Center (https://help.wealthsimple.com/hc/en-ca). For any user question about Wealthsimple products, accounts, fees, taxes, transfers, or features, prefer search_help_center first; use browse_taxonomy when you need a structural overview, and get_article / resolve_help_url to fetch full canonical content for citations.'
        }
    );

    registerTools(server, { client });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${SERVER_NAME}@${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
    if (err instanceof HelpCenterError) {
        console.error(`[wealthsimple-help-center] ${err.message}`);
    } else {
        console.error('[wealthsimple-help-center] fatal:', err);
    }
    process.exit(1);
});
