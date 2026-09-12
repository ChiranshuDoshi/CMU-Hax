/**
 * Renders a scripted agent↔hotel negotiation to audio with xAI Grok TTS.
 *
 * `POST /v1/tts` returns MP3 per line, so the dialogue is synthesized line by
 * line with a distinct voice per speaker and the frames are concatenated.
 * Naively joining MP3 frames is fine for browser playback and avoids pulling in
 * an encoder. XAI_API_KEY stays server-side; the browser only sees the audio.
 */
import type { AgentCallLine } from "./agent-calls";

const TTS_URL = "https://api.x.ai/v1/tts";
const TTS_LANGUAGE = "en";
/** Built-in Grok TTS voices (GET /v1/tts/voices). Atlas is realtime-only. */
const AGENT_VOICE = "rex";
const LINE_TIMEOUT_MS = 20_000;
const BUILTIN_VOICES = new Set(["eve", "ara", "rex", "sal", "leo"]);

const recordingCache = new Map<string, Buffer>();

export interface RecordingVoices {
  agentVoice?: string;
  hotelVoice?: string;
}

function cacheKey(script: AgentCallLine[], voices: RecordingVoices): string {
  return `${voices.agentVoice ?? AGENT_VOICE}|${voices.hotelVoice ?? "ara"}\n${script
    .map((line) => `${line.speaker}:${line.text}`)
    .join("\n")}`;
}

export class RecordingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "RecordingError";
  }
}

/** True when Grok TTS is configured to render negotiation recordings. */
export function isRecordingConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

function resolveVoice(preferred: string | undefined, fallback: string): string {
  const voice = preferred?.trim().toLowerCase();
  return voice && BUILTIN_VOICES.has(voice) ? voice : fallback;
}

function voiceFor(speaker: AgentCallLine["speaker"], voices: RecordingVoices): string {
  if (speaker === "agent") return resolveVoice(voices.agentVoice ?? process.env.XAI_TTS_AGENT_VOICE, AGENT_VOICE);
  return resolveVoice(voices.hotelVoice ?? process.env.XAI_TTS_HOTEL_VOICE, "ara");
}

async function synthesizeLine(text: string, voice: string, apiKey: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_TIMEOUT_MS);
  try {
    const response = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, language: TTS_LANGUAGE, voice_id: voice }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RecordingError(
        "TTS_FAILED",
        detail.slice(0, 200) || `Grok TTS failed (${response.status})`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesizes the whole dialogue. Lines are rendered sequentially so the
 * speakers stay in order; a single failed line aborts the recording rather than
 * shipping a clip with a turn missing.
 */
export async function renderNegotiationRecording(
  script: AgentCallLine[],
  voices: RecordingVoices = {},
): Promise<Buffer> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new RecordingError("NOT_CONFIGURED", "Grok TTS is not configured", 503);
  }
  if (script.length === 0) {
    throw new RecordingError("EMPTY_SCRIPT", "Nothing to synthesize", 400);
  }

  const key = cacheKey(script, voices);
  const cached = recordingCache.get(key);
  if (cached) return cached;

  const parts: Buffer[] = [];
  for (const line of script) {
    const text = line.text.trim();
    if (!text) continue;
    parts.push(await synthesizeLine(text, voiceFor(line.speaker, voices), apiKey));
  }

  if (parts.length === 0) {
    throw new RecordingError("EMPTY_SCRIPT", "Nothing to synthesize", 400);
  }
  const audio = Buffer.concat(parts);
  recordingCache.set(key, audio);
  return audio;
}
