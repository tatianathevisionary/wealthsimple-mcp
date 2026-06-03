import { describe, expect, it, vi } from 'vitest';
import { HelpCenterClient, HelpCenterError } from '../src/zendesk.js';

const BASE = 'https://help.wealthsimple.com/api/v2/help_center';

/** Build a minimal fetch-Response-like object. */
function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
    const status = init.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: init.statusText ?? 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body)
    } as unknown as Response;
}

/** A category page envelope with optional next_page pointer. */
function categoriesPage(opts: { page: number; pageCount: number; nextPage: string | null; ids: number[] }) {
    return {
        page: opts.page,
        page_count: opts.pageCount,
        per_page: 30,
        count: opts.ids.length,
        next_page: opts.nextPage,
        previous_page: null,
        categories: opts.ids.map((id) => ({
            id,
            name: `Category ${id}`,
            description: '',
            locale: 'en-ca',
            html_url: `https://help.wealthsimple.com/hc/en-ca/categories/${id}`,
            created_at: '2020-01-01T00:00:00Z',
            updated_at: '2020-01-01T00:00:00Z'
        }))
    };
}

describe('HelpCenterClient.parseArticleIdFromUrl', () => {
    it('extracts the numeric id from a full article URL', () => {
        expect(
            HelpCenterClient.parseArticleIdFromUrl(
                'https://help.wealthsimple.com/hc/en-ca/articles/4404053510299-Open-a-TFSA'
            )
        ).toBe(4404053510299);
    });

    it('extracts the id from a bare path', () => {
        expect(HelpCenterClient.parseArticleIdFromUrl('/articles/12345')).toBe(12345);
    });

    it('returns null when there is no article segment', () => {
        expect(HelpCenterClient.parseArticleIdFromUrl('https://help.wealthsimple.com/hc/en-ca')).toBeNull();
        expect(HelpCenterClient.parseArticleIdFromUrl('/sections/999')).toBeNull();
    });

    it('ignores trailing slug text after the id', () => {
        expect(HelpCenterClient.parseArticleIdFromUrl('/articles/777-some-slug-here')).toBe(777);
    });
});

describe('HelpCenterClient depagination', () => {
    it('follows next_page across pages and concatenates results', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/categories.json')) {
                return jsonResponse(
                    categoriesPage({
                        page: 1,
                        pageCount: 2,
                        nextPage: `${BASE}/en-ca/categories.json?page=2`,
                        ids: [1, 2]
                    })
                );
            }
            if (url.includes('page=2')) {
                return jsonResponse(categoriesPage({ page: 2, pageCount: 2, nextPage: null, ids: [3] }));
            }
            throw new Error(`unexpected url ${url}`);
        });

        const client = new HelpCenterClient({ fetchImpl });
        const categories = await client.listCategories();
        expect(categories.map((c) => c.id)).toEqual([1, 2, 3]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('serves a second identical request from cache (no extra fetch)', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse(categoriesPage({ page: 1, pageCount: 1, nextPage: null, ids: [1] }))
        );
        const client = new HelpCenterClient({ fetchImpl });
        await client.listCategories();
        await client.listCategories();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('trips the pagination safety guard on an infinite next_page loop', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse(
                categoriesPage({
                    page: 1,
                    pageCount: 99,
                    nextPage: `${BASE}/en-ca/categories.json?page=loop`,
                    ids: [1]
                })
            )
        );
        const client = new HelpCenterClient({ fetchImpl });
        await expect(client.listCategories()).rejects.toThrow(/safety guard tripped/);
    });
});

describe('HelpCenterClient retry/backoff', () => {
    it('retries after a 429 then succeeds', async () => {
        let calls = 0;
        const fetchImpl = vi.fn<typeof fetch>(async () => {
            calls++;
            if (calls === 1) {
                return jsonResponse(
                    { message: 'rate limited' },
                    { status: 429, statusText: 'Too Many Requests' }
                );
            }
            return jsonResponse(categoriesPage({ page: 1, pageCount: 1, nextPage: null, ids: [42] }));
        });

        // Small maxRetries keeps the real backoff delay short (~250ms once).
        const client = new HelpCenterClient({ fetchImpl, maxRetries: 1 });
        const categories = await client.listCategories();
        expect(categories.map((c) => c.id)).toEqual([42]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx then succeeds', async () => {
        let calls = 0;
        const fetchImpl = vi.fn<typeof fetch>(async () => {
            calls++;
            if (calls === 1) {
                return jsonResponse({}, { status: 503, statusText: 'Service Unavailable' });
            }
            return jsonResponse(categoriesPage({ page: 1, pageCount: 1, nextPage: null, ids: [7] }));
        });
        const client = new HelpCenterClient({ fetchImpl, maxRetries: 1 });
        const categories = await client.listCategories();
        expect(categories.map((c) => c.id)).toEqual([7]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('gives up after exhausting retries and throws HelpCenterError with the status', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse({}, { status: 429, statusText: 'Too Many Requests' })
        );
        const client = new HelpCenterClient({ fetchImpl, maxRetries: 1 });
        await expect(client.listCategories()).rejects.toMatchObject({
            name: 'HelpCenterError',
            status: 429
        });
        // initial attempt + 1 retry = 2 calls
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry on 404 and throws immediately', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse({}, { status: 404, statusText: 'Not Found' })
        );
        const client = new HelpCenterClient({ fetchImpl, maxRetries: 3 });
        await expect(client.getArticle(123)).rejects.toMatchObject({
            name: 'HelpCenterError',
            status: 404
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on a non-retryable 400', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
            jsonResponse({}, { status: 400, statusText: 'Bad Request' })
        );
        const client = new HelpCenterClient({ fetchImpl, maxRetries: 3 });
        await expect(client.listCategories()).rejects.toBeInstanceOf(HelpCenterError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
