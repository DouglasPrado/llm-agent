export interface CacheOptions {
  maxSize: number;
  ttl?: number;
}

interface CacheEntry<V> {
  value: V;
  createdAt: number;
}

/**
 * LRU Cache with optional TTL expiration.
 * Uses Map insertion order for LRU tracking.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttl: number | undefined;

  constructor(options: CacheOptions) {
    this.maxSize = options.maxSize;
    this.ttl = options.ttl;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.map.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove existing to update position
    this.map.delete(key);

    // Evict LRU if at capacity
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value as K;
      this.map.delete(firstKey);
    }

    this.map.set(key, { value, createdAt: Date.now() });
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.map.delete(key);
      return false;
    }

    return true;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    if (!this.ttl) return false;
    return Date.now() - entry.createdAt > this.ttl;
  }
}
