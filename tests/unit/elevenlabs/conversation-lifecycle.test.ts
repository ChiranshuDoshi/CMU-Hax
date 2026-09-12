import { describe, expect, it } from "vitest";

import { createConversationLifecycleCoordinator } from "@/app/dev/elevenlabs/use-demo-conversation";

describe("conversation lifecycle coordinator", () => {
  it("invalidates callbacks from older start generations", () => {
    const coordinator = createConversationLifecycleCoordinator();
    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);

    first.invalidate();
    expect(second.isCurrent()).toBe(true);

    second.invalidate();
    expect(second.isCurrent()).toBe(false);
  });

  it("serializes operations and settles failures before continuing", async () => {
    const generation = createConversationLifecycleCoordinator().begin();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = generation.enqueue(async () => {
      events.push("processing:start");
      await firstGate;
      events.push("processing:end");
      throw new Error("processing failed");
    });
    const second = generation.enqueue(async () => {
      events.push("complete");
      return "completed";
    });

    await Promise.resolve();
    expect(events).toEqual(["processing:start"]);
    releaseFirst();

    await expect(first).resolves.toMatchObject({ ok: false });
    await expect(second).resolves.toEqual({ ok: true, value: "completed" });
    expect(events).toEqual(["processing:start", "processing:end", "complete"]);
  });
});
