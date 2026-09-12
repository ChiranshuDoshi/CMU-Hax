/** Maximum accepted length for an Idempotency-Key header value. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** Completed requests are retained long enough to make client retries safe. */
export const DEFAULT_COMPLETED_ENTRY_TTL_MS = 10 * 60 * 1_000;

/** Bound memory use for this single-process store without evicting live requests. */
export const DEFAULT_MAX_IDEMPOTENCY_ENTRIES = 10_000;

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key has already been used for a different request");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyKeyError";
  }
}

export class IdempotencyCapacityError extends Error {
  constructor() {
    super("Idempotency store has reached its maximum capacity");
    this.name = "IdempotencyCapacityError";
  }
}

export interface InMemoryIdempotencyStoreOptions {
  readonly completedEntryTtlMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

interface Entry<T> {
  readonly fingerprint: string;
  readonly promise: Promise<T>;
  completedAt: number | null;
}

/**
 * Process-local idempotency protection for side-effecting operations.
 *
 * Pending and rejected operations stay cached until the entry expires. This
 * deliberately favors avoiding duplicate external side effects over retries
 * after an ambiguous provider failure.
 */
export class InMemoryIdempotencyStore<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly completedEntryTtlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor({
    completedEntryTtlMs = DEFAULT_COMPLETED_ENTRY_TTL_MS,
    maxEntries = DEFAULT_MAX_IDEMPOTENCY_ENTRIES,
    now = Date.now,
  }: InMemoryIdempotencyStoreOptions = {}) {
    if (!Number.isFinite(completedEntryTtlMs) || completedEntryTtlMs < 0) {
      throw new RangeError("completedEntryTtlMs must be a non-negative finite number");
    }
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive safe integer");
    }

    this.completedEntryTtlMs = completedEntryTtlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  execute(key: string, fingerprint: string, create: () => Promise<T>): Promise<T> {
    this.validateKey(key);
    this.validateFingerprint(fingerprint);
    this.removeExpiredCompletedEntries();

    const existingEntry = this.entries.get(key);
    if (existingEntry !== undefined) {
      if (existingEntry.fingerprint !== fingerprint) {
        return Promise.reject(new IdempotencyConflictError());
      }
      return existingEntry.promise;
    }

    if (this.entries.size >= this.maxEntries) {
      return Promise.reject(new IdempotencyCapacityError());
    }

    const promise = Promise.resolve().then(create);
    const entry: Entry<T> = { fingerprint, promise, completedAt: null };
    this.entries.set(key, entry);
    void promise.then(
      () => {
        entry.completedAt = this.now();
      },
      () => {
        entry.completedAt = this.now();
      },
    );

    return promise;
  }

  private validateKey(key: string): void {
    if (key.length === 0 || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new IdempotencyKeyError(
        `Idempotency key must be between 1 and ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
      );
    }
  }

  private validateFingerprint(fingerprint: string): void {
    if (fingerprint.length === 0) {
      throw new IdempotencyKeyError("Request fingerprint must not be empty");
    }
  }

  private removeExpiredCompletedEntries(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (
        entry.completedAt !== null &&
        now - entry.completedAt >= this.completedEntryTtlMs
      ) {
        this.entries.delete(key);
      }
    }
  }
}
