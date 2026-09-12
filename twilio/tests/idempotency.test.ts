import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_IDEMPOTENCY_ENTRIES,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IdempotencyCapacityError,
  IdempotencyConflictError,
  IdempotencyKeyError,
  InMemoryIdempotencyStore,
} from "../src/idempotency.js";

describe("InMemoryIdempotencyStore", () => {
  it("returns the original promise for duplicate requests", async () => {
    const store = new InMemoryIdempotencyStore<string>();
    let calls = 0;
    const create = async () => {
      calls += 1;
      return "call-created";
    };

    const first = store.execute("request-1", "fingerprint-1", create);
    const retry = store.execute("request-1", "fingerprint-1", create);

    expect(retry).toBe(first);
    await expect(first).resolves.toBe("call-created");
    await expect(retry).resolves.toBe("call-created");
    expect(calls).toBe(1);
  });

  it("caches rejected work so ambiguous failures are not retried", async () => {
    const store = new InMemoryIdempotencyStore<string>();
    const failure = new Error("provider connection ended before response");
    let calls = 0;
    const create = async () => {
      calls += 1;
      throw failure;
    };

    const first = store.execute("request-1", "fingerprint-1", create);
    const retry = store.execute("request-1", "fingerprint-1", create);

    expect(retry).toBe(first);
    await expect(first).rejects.toBe(failure);
    await expect(retry).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("rejects an idempotency key reused for another request", async () => {
    const store = new InMemoryIdempotencyStore<string>();
    await store.execute("request-1", "fingerprint-1", async () => "call-created");

    await expect(
      store.execute("request-1", "fingerprint-2", async () => "another-call"),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("expires completed entries after the configured TTL", async () => {
    let now = 1_000;
    const store = new InMemoryIdempotencyStore<string>({
      completedEntryTtlMs: 500,
      now: () => now,
    });
    let calls = 0;
    const create = async () => {
      calls += 1;
      return `call-${calls}`;
    };

    await expect(store.execute("request-1", "fingerprint-1", create)).resolves.toBe("call-1");
    now += 499;
    await expect(store.execute("request-1", "fingerprint-1", create)).resolves.toBe("call-1");
    now += 1;
    await expect(store.execute("request-1", "fingerprint-1", create)).resolves.toBe("call-2");
    expect(calls).toBe(2);
  });

  it("enforces the maximum capacity without evicting unexpired requests", async () => {
    const store = new InMemoryIdempotencyStore<string>({ maxEntries: 1 });
    await store.execute("request-1", "fingerprint-1", async () => "call-created");

    await expect(
      store.execute("request-2", "fingerprint-2", async () => "another-call"),
    ).rejects.toBeInstanceOf(IdempotencyCapacityError);
    expect(DEFAULT_MAX_IDEMPOTENCY_ENTRIES).toBeGreaterThan(0);
  });

  it("rejects empty and overlong idempotency keys", () => {
    const store = new InMemoryIdempotencyStore<string>();

    expect(() => store.execute("", "fingerprint", async () => "unused")).toThrow(IdempotencyKeyError);
    expect(() => store.execute("a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1), "fingerprint", async () => "unused")).toThrow(
      IdempotencyKeyError,
    );
  });
});
