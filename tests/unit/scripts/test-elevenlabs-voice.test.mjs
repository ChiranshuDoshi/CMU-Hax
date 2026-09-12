import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectAudio, parseVoiceArgs, runVoiceSmoke } from "../../../scripts/test-elevenlabs-voice.mjs";

describe("ElevenLabs voice smoke", () => {
  const temporaryDirectories = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("is opt-in and bounds billable text", () => {
    expect(parseVoiceArgs([]).live).toBe(false);
    expect(() => parseVoiceArgs(["--text", "x".repeat(161)])).toThrow(/limited/);
  });

  it("caps streamed audio bytes", async () => {
    async function* stream() { yield Buffer.alloc(6); yield Buffer.alloc(6); }
    await expect(collectAudio(stream(), 10)).rejects.toThrow(/safety byte limit/);
  });

  it("rejects an empty audio stream", async () => {
    async function* stream() {}
    await expect(collectAudio(stream())).rejects.toThrow(/no audio/);
  });

  it("collects a valid audio stream", async () => {
    async function* stream() { yield Buffer.from("audio"); }
    await expect(collectAudio(stream())).resolves.toEqual(Buffer.from("audio"));
  });

  it("checks private-agent auth and writes a short TTS result with restrictive permissions", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "person3-voice-"));
    temporaryDirectories.push(directory);
    const output = resolve(directory, "voice-smoke.mp3");
    await chmod(directory, 0o755);
    await writeFile(output, "old audio", { mode: 0o644 });
    async function* audio() { yield Buffer.from("audio"); }
    const client = { conversationalAi: { agents: { get: vi.fn().mockResolvedValue({ platformSettings: { auth: { enableAuth: true } }, conversationConfig: { tts: { voiceId: "voice" } } }) }, conversations: { getWebrtcToken: vi.fn().mockResolvedValue({ token: "redacted" }) } }, textToSpeech: { convert: vi.fn().mockResolvedValue(audio()) } };
    const result = await runVoiceSmoke({ client, agentId: "agent", text: "hello", outputDirectory: directory });
    expect(await readFile(result.output, "utf8")).toBe("audio");
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(result.output)).mode & 0o777).toBe(0o600);
    expect(client.conversationalAi.conversations.getWebrtcToken).toHaveBeenCalledWith({ agentId: "agent" });
  });
});
