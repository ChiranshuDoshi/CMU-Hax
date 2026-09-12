import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_TEXT_LENGTH = 160;
const MAX_AUDIO_BYTES = 2_000_000;

export function parseVoiceArgs(argv) {
  const textIndex = argv.indexOf("--text");
  const text = textIndex < 0 ? "PolicyScout voice smoke test complete." : argv[textIndex + 1];
  if (!text || text.startsWith("--")) throw new Error("--text requires a value");
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`--text is limited to ${MAX_TEXT_LENGTH} characters to bound cost`);
  return { live: argv.includes("--live"), text };
}

export async function collectAudio(stream, maxBytes = MAX_AUDIO_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Voice response exceeded the safety byte limit");
    chunks.push(buffer);
  }
  if (size === 0) throw new Error("Voice response contained no audio");
  return Buffer.concat(chunks);
}

function loadEnv(root) {
  for (const file of [".env.local", ".env"]) if (existsSync(resolve(root, file))) process.loadEnvFile(resolve(root, file));
}

export async function runVoiceSmoke({ client, agentId, text, outputDirectory }) {
  const agent = await client.conversationalAi.agents.get(agentId);
  if (agent.platformSettings?.auth?.enableAuth !== true) throw new Error("Voice smoke agent is not private; rerun setup with --apply");
  const voiceId = agent.conversationConfig?.tts?.voiceId;
  if (!voiceId) throw new Error("Voice smoke agent has no configured voice ID");
  await client.conversationalAi.conversations.getWebrtcToken({ agentId });
  const stream = await client.textToSpeech.convert(voiceId, { text, modelId: "eleven_flash_v2_5", outputFormat: "mp3_44100_128" });
  const audio = await collectAudio(stream);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  const output = resolve(outputDirectory, "voice-smoke.mp3");
  if (existsSync(output)) await chmod(output, 0o600);
  await writeFile(output, audio, { mode: 0o600 });
  await chmod(output, 0o600);
  return { output, bytes: audio.length, voiceId };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const { live, text } = parseVoiceArgs(argv);
  if (!live) { console.log("Dry run only. Use --live to request one private WebRTC microphone token and short TTS voice smoke (may consume credits)."); return null; }
  const root = process.cwd(); loadEnv(root);
  if (!process.env.ELEVENLABS_API_KEY?.trim()) throw new Error("ELEVENLABS_API_KEY is missing");
  if (!process.env.ELEVENLABS_VOICE_SMOKE_AGENT_ID?.trim()) throw new Error("ELEVENLABS_VOICE_SMOKE_AGENT_ID is missing; run setup with --apply");
  const client = dependencies.client ?? new (await import("@elevenlabs/elevenlabs-js")).ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  const result = await runVoiceSmoke({ client, agentId: process.env.ELEVENLABS_VOICE_SMOKE_AGENT_ID, text, outputDirectory: resolve(root, ".artifacts/person3/voice-smoke") });
  console.log(`Live voice smoke wrote ${result.bytes} bytes to ${result.output}`);
  return result;
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().catch((error) => { console.error(`Voice smoke failed: ${error.message}`); process.exitCode = 1; });
