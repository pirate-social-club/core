export class WorkQueueFullError extends Error {
  constructor(message = "work queue is full") {
    super(message);
    this.name = "WorkQueueFullError";
  }
}

export type WorkLimiterSnapshot = {
  active: number;
  queued: number;
  max_active: number;
  max_queued: number;
};

export class WorkLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueued: number,
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1) {
      throw new Error("maxActive must be a positive integer");
    }
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new Error("maxQueued must be a non-negative integer");
    }
  }

  snapshot(): WorkLimiterSnapshot {
    return {
      active: this.active,
      queued: this.waiters.length,
      max_active: this.maxActive,
      max_queued: this.maxQueued,
    };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxActive) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxQueued) {
      return Promise.reject(new WorkQueueFullError());
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }
}

type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

export type ResolveCacheSnapshot = {
  entries: number;
  hits: number;
  misses: number;
  ttl_ms: number;
  max_entries: number;
};

export class ResolveCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("ttlMs must be positive");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
  }

  snapshot(): ResolveCacheSnapshot {
    this.pruneExpired();
    return {
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      ttl_ms: this.ttlMs,
      max_entries: this.maxEntries,
    };
  }

  getOrCreate(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      this.hits += 1;
      return existing.value;
    }
    if (existing) {
      this.entries.delete(key);
    }

    this.misses += 1;
    this.makeRoom();
    const value = load();
    const entry = { expiresAt: now + this.ttlMs, value };
    this.entries.set(key, entry);
    void value.catch(() => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
    });
    return value;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private makeRoom(): void {
    this.pruneExpired();
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey == null) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}
