import { z } from 'zod';
import { TtlCache } from './cache.js';
import {
    ArticleEnvelopeSchema,
    ArticlesPageSchema,
    CategoriesPageSchema,
    CategoryEnvelopeSchema,
    SearchPageSchema,
    SectionEnvelopeSchema,
    SectionsPageSchema,
    type Article,
    type ArticleSearchHit,
    type ArticlesPage,
    type CategoriesPage,
    type Category,
    type Pagination,
    type Section,
    type SectionsPage
} from './schemas.js';

const DEFAULT_BASE = 'https://help.wealthsimple.com/api/v2/help_center';
const DEFAULT_LOCALE = 'en-ca';
const DEFAULT_USER_AGENT = 'wealthsimple-help-center-mcp/0.1 (+https://help.wealthsimple.com)';

export interface ZendeskClientOptions {
    baseUrl?: string;
    locale?: string;
    userAgent?: string;
    requestTimeoutMs?: number;
    maxRetries?: number;
    cacheTtlMs?: number;
    cacheMaxEntries?: number;
    fetchImpl?: typeof fetch;
}

export class HelpCenterError extends Error {
    readonly status?: number;
    readonly url?: string;

    constructor(message: string, status?: number, url?: string, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'HelpCenterError';
        this.status = status;
        this.url = url;
    }
}

/**
 * Strongly typed client for the Wealthsimple-hosted Zendesk Help Center API.
 *
 * - JSON-only, no auth required for public help center endpoints.
 * - Per-URL response caching with TTL+LRU eviction (the help center mutates
 *   slowly; cache hit rates are very high in practice).
 * - Retries on 429/5xx with exponential backoff plus jitter.
 * - AbortController-based request timeouts.
 */
export class HelpCenterClient {
    private readonly baseUrl: string;
    private readonly locale: string;
    private readonly userAgent: string;
    private readonly requestTimeoutMs: number;
    private readonly maxRetries: number;
    private readonly fetchImpl: typeof fetch;
    private readonly cache: TtlCache<string, unknown>;

    constructor(opts: ZendeskClientOptions = {}) {
        this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
        this.locale = opts.locale ?? DEFAULT_LOCALE;
        this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
        this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000;
        this.maxRetries = opts.maxRetries ?? 2;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.cache = new TtlCache<string, unknown>({
            maxEntries: opts.cacheMaxEntries ?? 256,
            ttlMs: opts.cacheTtlMs ?? 30 * 60 * 1000
        });
    }

    async listCategories(): Promise<Category[]> {
        return this.depaginate(
            `/${this.locale}/categories.json`,
            CategoriesPageSchema,
            (page: CategoriesPage) => page.categories
        );
    }

    async listSections(categoryId?: number): Promise<Section[]> {
        const path =
            categoryId === undefined
                ? `/${this.locale}/sections.json`
                : `/${this.locale}/categories/${categoryId}/sections.json`;
        return this.depaginate(path, SectionsPageSchema, (page: SectionsPage) => page.sections);
    }

    async listArticles(sectionId: number, limit?: number): Promise<Article[]> {
        return this.depaginate(
            `/${this.locale}/sections/${sectionId}/articles.json`,
            ArticlesPageSchema,
            (page: ArticlesPage) => page.articles,
            limit
        );
    }

    async getArticle(articleId: number): Promise<Article> {
        const data = await this.getJson(
            `/${this.locale}/articles/${articleId}.json`,
            ArticleEnvelopeSchema
        );
        return data.article;
    }

    async getCategory(categoryId: number): Promise<Category> {
        const data = await this.getJson(
            `/${this.locale}/categories/${categoryId}.json`,
            CategoryEnvelopeSchema
        );
        return data.category;
    }

    async getSection(sectionId: number): Promise<Section> {
        const data = await this.getJson(
            `/${this.locale}/sections/${sectionId}.json`,
            SectionEnvelopeSchema
        );
        return data.section;
    }

    async search(query: string, limit = 25): Promise<ArticleSearchHit[]> {
        const trimmed = query.trim();
        if (!trimmed) return [];
        const perPage = Math.min(100, Math.max(1, limit));
        const params = new URLSearchParams({
            query: trimmed,
            locale: this.locale,
            per_page: String(perPage)
        });
        const path = `/articles/search.json?${params.toString()}`;
        const page = await this.getJson(path, SearchPageSchema);
        return page.results.slice(0, limit);
    }

    /**
     * Resolve a public Wealthsimple help center article URL (e.g.
     * https://help.wealthsimple.com/hc/en-ca/articles/4404053510299-Open-a-TFSA)
     * to a numeric article ID.
     */
    static parseArticleIdFromUrl(url: string): number | null {
        const match = url.match(/\/articles\/(\d+)/);
        if (!match?.[1]) return null;
        const parsed = Number(match[1]);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private async depaginate<P extends Pagination, T>(
        path: string,
        schema: z.ZodType<P>,
        extract: (page: P) => readonly T[],
        limit?: number
    ): Promise<T[]> {
        const items: T[] = [];
        let nextUrl: string | null = path;
        let safetyCounter = 0;
        while (nextUrl) {
            if (++safetyCounter > 50) {
                throw new HelpCenterError(`Pagination safety guard tripped after 50 pages on ${path}`);
            }
            const page: P = await this.getJson(nextUrl, schema);
            items.push(...extract(page));
            if (limit !== undefined && items.length >= limit) {
                return items.slice(0, limit);
            }
            nextUrl = page.next_page;
            if (nextUrl && nextUrl.startsWith(this.baseUrl)) {
                nextUrl = nextUrl.slice(this.baseUrl.length);
            }
        }
        return items;
    }

    private async getJson<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        const cached = this.cache.get(url);
        if (cached !== undefined) return cached as z.infer<S>;
        const raw = await this.fetchWithRetry(url);
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            throw new HelpCenterError(
                `Help Center response failed schema validation for ${url}: ${parsed.error.message}`,
                undefined,
                url,
                parsed.error
            );
        }
        this.cache.set(url, parsed.data);
        return parsed.data;
    }

    private async fetchWithRetry(url: string): Promise<unknown> {
        let attempt = 0;
        let lastError: unknown;
        while (attempt <= this.maxRetries) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
            try {
                const res = await this.fetchImpl(url, {
                    headers: {
                        accept: 'application/json',
                        'user-agent': this.userAgent
                    },
                    signal: controller.signal
                });
                if (res.ok) {
                    return (await res.json()) as unknown;
                }
                if (res.status === 404) {
                    throw new HelpCenterError(`Resource not found: ${url}`, 404, url);
                }
                if (!isRetryable(res.status) || attempt === this.maxRetries) {
                    const text = await res.text().catch(() => '');
                    throw new HelpCenterError(
                        `Help Center request failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
                        res.status,
                        url
                    );
                }
                lastError = new HelpCenterError(`Retryable status ${res.status}`, res.status, url);
            } catch (err) {
                if (err instanceof HelpCenterError && err.status === 404) throw err;
                lastError = err;
                if (attempt === this.maxRetries) break;
            } finally {
                clearTimeout(timeout);
            }
            const backoffMs = Math.min(8_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 200);
            await delay(backoffMs);
            attempt++;
        }
        if (lastError instanceof HelpCenterError) throw lastError;
        throw new HelpCenterError(
            `Help Center request failed after ${this.maxRetries + 1} attempts: ${String(lastError)}`,
            undefined,
            url,
            lastError
        );
    }
}

function isRetryable(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
