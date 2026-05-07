interface Entry<V> {
    value: V;
    expiresAt: number;
}

export interface TtlCacheOptions {
    maxEntries: number;
    ttlMs: number;
}

export class TtlCache<K, V> {
    private readonly store = new Map<K, Entry<V>>();
    private readonly maxEntries: number;
    private readonly ttlMs: number;

    constructor({ maxEntries, ttlMs }: TtlCacheOptions) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
    }

    get(key: K): V | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt < Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        // LRU touch
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }

    set(key: K, value: V): void {
        if (this.store.has(key)) this.store.delete(key);
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        while (this.store.size > this.maxEntries) {
            const oldest = this.store.keys().next().value;
            if (oldest === undefined) break;
            this.store.delete(oldest);
        }
    }

    clear(): void {
        this.store.clear();
    }
}
