import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Write = { key: string; value: unknown; options?: { ex?: number } };

const redisState = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const writes: Write[] = [];

  function client() {
    return {
      get: async <T>(key: string): Promise<T | null> => (values.get(key) as T | undefined) ?? null,
      set: async (key: string, value: unknown, options?: { ex?: number }) => {
        values.set(key, value);
        writes.push({ key, value, options });
        return "OK";
      },
      incr: async (key: string) => {
        const next = Number(values.get(key) ?? 0) + 1;
        values.set(key, next);
        return next;
      },
      expire: async () => 1,
      multi: () => {
        const pending: Write[] = [];
        const transaction = {
          set(key: string, value: unknown, options?: { ex?: number }) {
            pending.push({ key, value, options });
            return transaction;
          },
          async exec() {
            for (const write of pending) {
              values.set(write.key, write.value);
              writes.push(write);
            }
            return [];
          },
        };
        return transaction;
      },
    };
  }

  return {
    values,
    writes,
    client,
    reset() {
      values.clear();
      writes.splice(0, writes.length);
    },
  };
});

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => redisState.client() },
}));

const originalRedisEnvironment = {
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL,
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  kvUrl: process.env.KV_REST_API_URL,
  kvToken: process.env.KV_REST_API_TOKEN,
};

function restoreEnvironment(): void {
  for (const [name, value] of Object.entries({
    UPSTASH_REDIS_REST_URL: originalRedisEnvironment.upstashUrl,
    UPSTASH_REDIS_REST_TOKEN: originalRedisEnvironment.upstashToken,
    KV_REST_API_URL: originalRedisEnvironment.kvUrl,
    KV_REST_API_TOKEN: originalRedisEnvironment.kvToken,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function loadStore() {
  vi.resetModules();
  return import("@/backend/app/store");
}

describe("app workflow store", () => {
  beforeEach(() => {
    redisState.reset();
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "test-token";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    restoreEnvironment();
  });

  it("persists an account and workflow across fresh store instances", async () => {
    const firstStore = await loadStore();
    const account = await firstStore.createAccount("Avery", "avery@example.com");
    const workflow = await firstStore.getWorkflow(account.workflowId);

    expect(workflow).toMatchObject({ accountId: account.id, stage: "profile" });
    expect(redisState.writes).toHaveLength(2);
    expect(redisState.writes.every((write) => write.options?.ex === firstStore.WORKFLOW_RETENTION_SECONDS)).toBe(true);

    const secondStore = await loadStore();
    expect(await secondStore.getAccount(account.id)).toEqual(account);
    expect(await secondStore.getWorkflow(account.workflowId)).toEqual(workflow);
  });

  it("updates the durable workflow after a state transition", async () => {
    const store = await loadStore();
    const account = await store.createAccount("Avery", "avery@example.com");
    const workflow = await store.getWorkflow(account.workflowId);
    if (!workflow) throw new Error("workflow was not created");

    workflow.stage = "research_ready";
    store.touch(workflow);
    await store.saveWorkflow(workflow);

    expect(await store.getWorkflow(account.workflowId)).toMatchObject({ stage: "research_ready" });
    expect(redisState.writes.at(-1)).toMatchObject({
      key: `policyscout:workflow:${account.workflowId}`,
      options: { ex: store.WORKFLOW_RETENTION_SECONDS },
    });
  });

  it("fails clearly when durable storage is not configured", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const store = await loadStore();

    await expect(store.getAccount("acct_missing")).rejects.toMatchObject({
      code: "PERSISTENCE_NOT_CONFIGURED",
    });
  });

  it("reserves only three live-call starts per account in the quota window", async () => {
    const store = await loadStore();
    for (let start = 0; start < 3; start += 1) {
      await store.reserveLiveCallStart("acct_test", "203.0.113.10");
    }

    await expect(store.reserveLiveCallStart("acct_test", "203.0.113.10")).rejects.toMatchObject({
      code: "CALL_RATE_LIMITED",
      status: 429,
    });
  });
});
