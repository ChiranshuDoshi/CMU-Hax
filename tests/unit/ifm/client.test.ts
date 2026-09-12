import { describe, expect, it, vi } from "vitest";

import { IfmClient, IfmConfigurationError } from "@/integrations/ifm";

describe("IfmClient", () => {
  it("requires an API key", () => {
    expect(() => new IfmClient({ apiKey: "" })).toThrow(IfmConfigurationError);
  });

  it("posts OpenAI-compatible chat completions and returns assistant text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "  hello from ifm  " } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new IfmClient({
      apiKey: "IFM-v1_test",
      model: "IFM/K2-Horizon-375B-A23B",
      baseUrl: "https://api.ifm.ai/v1",
    });
    await expect(
      client.complete({
        messages: [{ role: "user", content: "Hello, what is up?" }],
      }),
    ).resolves.toBe("hello from ifm");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.ifm.ai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer IFM-v1_test",
        }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      model: "IFM/K2-Horizon-375B-A23B",
      messages: [{ role: "user", content: "Hello, what is up?" }],
    });

    vi.unstubAllGlobals();
  });
});
