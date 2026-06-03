import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../src/cache.js';

describe('TtlCache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('stores and retrieves a value', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
        cache.set('a', 1);
        expect(cache.get('a')).toBe(1);
    });

    it('returns undefined for a missing key', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
        expect(cache.get('missing')).toBeUndefined();
    });

    it('expires entries after the TTL elapses', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
        cache.set('a', 1);
        vi.setSystemTime(999);
        expect(cache.get('a')).toBe(1); // still alive just before expiry
        vi.setSystemTime(1001);
        expect(cache.get('a')).toBeUndefined(); // expired (expiresAt < now)
    });

    it('treats an entry as live exactly at expiresAt (strict less-than check)', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
        cache.set('a', 1);
        vi.setSystemTime(1000); // expiresAt === now, 1000 < 1000 is false
        expect(cache.get('a')).toBe(1);
    });

    it('evicts the least-recently-used entry when over capacity', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 2, ttlMs: 100000 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3); // exceeds cap -> evicts oldest insertion 'a'
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBe(2);
        expect(cache.get('c')).toBe(3);
    });

    it('a get() touch promotes an entry so it is not the next eviction victim', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 2, ttlMs: 100000 });
        cache.set('a', 1);
        cache.set('b', 2);
        // Touch 'a' so 'b' becomes least-recently-used.
        expect(cache.get('a')).toBe(1);
        cache.set('c', 3); // evicts 'b' (now LRU), keeps 'a'
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBe(1);
        expect(cache.get('c')).toBe(3);
    });

    it('re-setting an existing key refreshes its recency and TTL', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 2, ttlMs: 1000 });
        cache.set('a', 1);
        cache.set('b', 2);
        vi.setSystemTime(500);
        cache.set('a', 11); // moves 'a' to most-recent and resets expiry to 1500
        cache.set('c', 3); // evicts 'b' (oldest), keeps refreshed 'a'
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBe(11);
        vi.setSystemTime(1499);
        expect(cache.get('a')).toBe(11); // TTL was refreshed
    });

    it('clear() removes everything', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.clear();
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBeUndefined();
    });

    it('evicts multiple entries when capacity is exceeded by more than one', () => {
        const cache = new TtlCache<string, number>({ maxEntries: 1, ttlMs: 100000 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('c')).toBe(3);
    });
});
