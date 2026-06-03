import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { htmlToMarkdown } from './html.js';
import type { Article } from './schemas.js';
import { traceTool } from './telemetry.js';
import { HelpCenterClient, HelpCenterError } from './zendesk.js';

const HELP_CENTER_DOMAIN = 'help.wealthsimple.com';

type ArticleFormat = 'markdown' | 'html' | 'text';

interface ArticleStructured {
    [key: string]: unknown;
    id: number;
    title: string;
    url: string;
    section_id: number | null;
    locale: string;
    labels: string[];
    updated_at: string;
    format: ArticleFormat;
    body: string;
}

/**
 * Render a fetched article into the canonical structured payload shared by
 * `get_article` and `resolve_help_url`. Centralizes body formatting so the two
 * tools never drift.
 */
function toArticleStructured(article: Article, format: ArticleFormat): ArticleStructured {
    const rawBody = article.body ?? '';
    const body =
        format === 'html' ? rawBody : format === 'text' ? stripTags(rawBody).trim() : htmlToMarkdown(rawBody);
    return {
        id: article.id,
        title: article.title,
        url: article.html_url,
        section_id: article.section_id ?? null,
        locale: article.locale,
        labels: article.label_names ?? [],
        updated_at: article.updated_at,
        format,
        body
    };
}

/**
 * Run an async mapper over `items` with at most `concurrency` in flight at
 * once, preserving input order in the result. No external dependency.
 */
async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const current = next++;
            const item = items[current];
            if (item === undefined) break;
            results[current] = await mapper(item, current);
        }
    });
    await Promise.all(workers);
    return results;
}

const articleSummarySchema = z.object({
    id: z.number().int(),
    title: z.string(),
    url: z.string().url(),
    section_id: z.number().int().nullable(),
    locale: z.string(),
    labels: z.array(z.string()),
    updated_at: z.string()
});

const sectionSummarySchema = z.object({
    id: z.number().int(),
    name: z.string(),
    description: z.string(),
    category_id: z.number().int(),
    url: z.string().url(),
    locale: z.string()
});

const categorySummarySchema = z.object({
    id: z.number().int(),
    name: z.string(),
    description: z.string(),
    url: z.string().url(),
    locale: z.string()
});

export interface ToolDeps {
    client: HelpCenterClient;
}

export function registerTools(server: McpServer, { client }: ToolDeps): void {
    server.registerTool(
        'search_help_center',
        {
            title: 'Search the Wealthsimple Help Center',
            description:
                'Full-text search across every public Wealthsimple Help Center article. Returns a ranked list of articles with titles, URLs, snippets, labels, and section IDs. Use this whenever the user asks anything about Wealthsimple products (Trade, Invest, Cash, Crypto, Tax, registered accounts like TFSA / RRSP / FHSA, transfers, deposits, etc.) — the help center is the canonical source of truth.',
            inputSchema: {
                query: z
                    .string()
                    .min(1)
                    .max(256)
                    .describe(
                        'Free-text search query, e.g. "TFSA contribution limit", "options trading fees".'
                    ),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .optional()
                    .describe('Max results to return (default 10, hard cap 50).')
            },
            outputSchema: {
                query: z.string(),
                count: z.number().int(),
                results: z.array(
                    articleSummarySchema.extend({
                        snippet: z.string()
                    })
                )
            }
        },
        async ({ query, limit }) =>
            traceTool('search_help_center', { query, limit }, async () => {
                const max = limit ?? 10;
                const hits = await client.search(query, max);
                const results = hits.map((h) => ({
                    id: h.id,
                    title: h.title,
                    url: h.html_url,
                    section_id: h.section_id ?? null,
                    locale: h.locale,
                    labels: h.label_names ?? [],
                    updated_at: h.updated_at,
                    snippet: stripTags(h.snippet ?? '').slice(0, 400)
                }));
                const structured = { query, count: results.length, results };
                return {
                    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
                    structuredContent: structured
                };
            })
    );

    server.registerTool(
        'list_categories',
        {
            title: 'List Wealthsimple Help Center categories',
            description:
                'List the top-level categories (Get Started, Move Money, Investing, Spending, File Taxes, Your Profile) of the Wealthsimple Help Center. Useful as the entry point for taxonomy-driven exploration before drilling into sections and articles.',
            inputSchema: {},
            outputSchema: {
                count: z.number().int(),
                categories: z.array(categorySummarySchema)
            }
        },
        async () =>
            traceTool('list_categories', {}, async () => {
                const categories = await client.listCategories();
                const summaries = categories.map((c) => ({
                    id: c.id,
                    name: c.name,
                    description: c.description ?? '',
                    url: c.html_url,
                    locale: c.locale
                }));
                const structured = { count: summaries.length, categories: summaries };
                return {
                    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
                    structuredContent: structured
                };
            })
    );

    server.registerTool(
        'list_sections',
        {
            title: 'List sections within the Wealthsimple Help Center',
            description:
                'List sections, optionally filtered to one category. Sections group related articles (e.g. "TFSA", "Crypto deposits"). Pass a `category_id` from `list_categories` to scope.',
            inputSchema: {
                category_id: z
                    .number()
                    .int()
                    .optional()
                    .describe(
                        'If provided, only return sections inside this category. Obtain via list_categories.'
                    )
            },
            outputSchema: {
                count: z.number().int(),
                sections: z.array(sectionSummarySchema)
            }
        },
        async ({ category_id }) =>
            traceTool('list_sections', { category_id }, async () => {
                const sections = await client.listSections(category_id);
                const summaries = sections.map((s) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description ?? '',
                    category_id: s.category_id,
                    url: s.html_url,
                    locale: s.locale
                }));
                const structured = { count: summaries.length, sections: summaries };
                return {
                    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
                    structuredContent: structured
                };
            })
    );

    server.registerTool(
        'list_articles',
        {
            title: 'List articles in a Wealthsimple Help Center section',
            description:
                'Return article summaries (no body) inside a single section. Use after `list_sections` to discover specific articles, then call `get_article` for full content.',
            inputSchema: {
                section_id: z.number().int().describe('Section ID returned by list_sections.'),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .optional()
                    .describe('Max number of articles (default 50, hard cap 200).')
            },
            outputSchema: {
                section_id: z.number().int(),
                count: z.number().int(),
                articles: z.array(articleSummarySchema)
            }
        },
        async ({ section_id, limit }) =>
            traceTool('list_articles', { section_id, limit }, async () => {
                const articles = await client.listArticles(section_id, limit ?? 50);
                const summaries = articles.map((a) => ({
                    id: a.id,
                    title: a.title,
                    url: a.html_url,
                    section_id: a.section_id ?? section_id,
                    locale: a.locale,
                    labels: a.label_names ?? [],
                    updated_at: a.updated_at
                }));
                const structured = { section_id, count: summaries.length, articles: summaries };
                return {
                    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
                    structuredContent: structured
                };
            })
    );

    server.registerTool(
        'get_article',
        {
            title: 'Fetch the full body of a Wealthsimple Help Center article',
            description:
                'Fetch the full content of one article. By default returns a clean Markdown rendering of the article body (HTML stripped, links and headings preserved). Pass `format: "html"` for the raw HTML if needed.',
            inputSchema: {
                article_id: z
                    .number()
                    .int()
                    .describe('Numeric article ID. Obtain via search_help_center or list_articles.'),
                format: z
                    .enum(['markdown', 'html', 'text'])
                    .optional()
                    .describe('Body rendering. Default `markdown`.')
            },
            outputSchema: {
                id: z.number().int(),
                title: z.string(),
                url: z.string().url(),
                section_id: z.number().int().nullable(),
                locale: z.string(),
                labels: z.array(z.string()),
                updated_at: z.string(),
                format: z.enum(['markdown', 'html', 'text']),
                body: z.string()
            }
        },
        async ({ article_id, format }) =>
            traceTool('get_article', { article_id, format }, async () => {
                const fmt = format ?? 'markdown';
                const article = await client.getArticle(article_id);
                const structured = toArticleStructured(article, fmt);
                return {
                    content: [{ type: 'text', text: structured.body }],
                    structuredContent: structured
                };
            })
    );

    server.registerTool(
        'resolve_help_url',
        {
            title: 'Resolve a Wealthsimple Help Center URL to article content',
            description:
                'Given a public help.wealthsimple.com article URL (e.g. https://help.wealthsimple.com/hc/en-ca/articles/4404053510299-Open-a-TFSA), fetch and return the full article. Useful for following citations or links the user has pasted.',
            inputSchema: {
                url: z.string().url().describe('A help.wealthsimple.com article URL.'),
                format: z.enum(['markdown', 'html', 'text']).optional()
            },
            outputSchema: {
                id: z.number().int(),
                title: z.string(),
                url: z.string().url(),
                section_id: z.number().int().nullable(),
                locale: z.string(),
                labels: z.array(z.string()),
                updated_at: z.string(),
                format: z.enum(['markdown', 'html', 'text']),
                body: z.string()
            }
        },
        async ({ url, format }) =>
            traceTool('resolve_help_url', { url, format }, async () => {
                let parsed: URL;
                try {
                    parsed = new URL(url);
                } catch {
                    throw new HelpCenterError(`Invalid URL: ${url}`);
                }
                const host = parsed.hostname.toLowerCase();
                if (host !== HELP_CENTER_DOMAIN && !host.endsWith(`.${HELP_CENTER_DOMAIN}`)) {
                    throw new HelpCenterError(
                        `URL host ${parsed.hostname} is not a Wealthsimple Help Center URL (expected ${HELP_CENTER_DOMAIN} or a subdomain).`
                    );
                }
                const id = HelpCenterClient.parseArticleIdFromUrl(parsed.pathname);
                if (id === null) {
                    throw new HelpCenterError(`Could not extract an article ID from ${url}.`);
                }
                const fmt = format ?? 'markdown';
                const article = await client.getArticle(id);
                const structured = toArticleStructured(article, fmt);
                return {
                    content: [{ type: 'text', text: structured.body }],
                    structuredContent: structured
                };
            })
    );

    server.registerTool(
        'browse_taxonomy',
        {
            title: 'Browse the full Wealthsimple Help Center taxonomy',
            description:
                'Return a hierarchical map of the entire help center: every category → its sections → its article titles and IDs (no bodies). Use this to give an agent a holistic picture of what the help center covers, as a precursor to targeted retrieval. Result can be large (~hundreds of articles) — prefer search_help_center for narrow queries.',
            inputSchema: {
                include_articles: z
                    .boolean()
                    .optional()
                    .describe(
                        'If true (default), include article titles under each section. If false, return only categories→sections.'
                    ),
                articles_per_section: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .optional()
                    .describe('Cap on articles per section (default 50).')
            },
            outputSchema: {
                category_count: z.number().int(),
                section_count: z.number().int(),
                article_count: z.number().int(),
                truncated: z.boolean(),
                categories: z.array(
                    categorySummarySchema.extend({
                        sections: z.array(
                            sectionSummarySchema.extend({
                                articles: z.array(
                                    z.object({
                                        id: z.number().int(),
                                        title: z.string(),
                                        url: z.string().url(),
                                        updated_at: z.string()
                                    })
                                )
                            })
                        )
                    })
                )
            }
        },
        async ({ include_articles, articles_per_section }) =>
            traceTool('browse_taxonomy', { include_articles, articles_per_section }, async () => {
                const includeArticles = include_articles ?? true;
                const perSection = articles_per_section ?? 50;
                const [categories, allSections] = await Promise.all([
                    client.listCategories(),
                    client.listSections()
                ]);
                const sectionsByCategory = new Map<number, typeof allSections>();
                for (const s of allSections) {
                    const list = sectionsByCategory.get(s.category_id) ?? [];
                    list.push(s);
                    sectionsByCategory.set(s.category_id, list);
                }

                let articleCount = 0;
                let truncated = false;
                // Bounded fan-out: throttle the per-section article fetches to
                // at most MAX_CONCURRENCY in flight across the whole taxonomy so
                // we never open hundreds of simultaneous connections.
                const MAX_CONCURRENCY = 5;
                const sectionResults = includeArticles
                    ? await mapWithConcurrency(allSections, MAX_CONCURRENCY, (s) =>
                          client.listArticles(s.id, perSection)
                      )
                    : allSections.map(() => [] as Awaited<ReturnType<typeof client.listArticles>>);
                const articlesBySection = new Map<number, (typeof sectionResults)[number]>();
                allSections.forEach((s, i) => {
                    articlesBySection.set(s.id, sectionResults[i] ?? []);
                });

                const tree = categories.map((c) => {
                    const sections = sectionsByCategory.get(c.id) ?? [];
                    const sectionPayloads = sections.map((s) => {
                        const articles = articlesBySection.get(s.id) ?? [];
                        articleCount += articles.length;
                        // A full page back means we hit the per-section cap and
                        // there may be more articles we didn't surface.
                        if (includeArticles && articles.length >= perSection) truncated = true;
                        return {
                            id: s.id,
                            name: s.name,
                            description: s.description ?? '',
                            category_id: s.category_id,
                            url: s.html_url,
                            locale: s.locale,
                            articles: articles.map((a) => ({
                                id: a.id,
                                title: a.title,
                                url: a.html_url,
                                updated_at: a.updated_at
                            }))
                        };
                    });
                    return {
                        id: c.id,
                        name: c.name,
                        description: c.description ?? '',
                        url: c.html_url,
                        locale: c.locale,
                        sections: sectionPayloads
                    };
                });
                const structured = {
                    category_count: categories.length,
                    section_count: allSections.length,
                    article_count: articleCount,
                    truncated,
                    categories: tree
                };
                return {
                    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
                    structuredContent: structured
                };
            })
    );
}

function stripTags(html: string): string {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
