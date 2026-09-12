import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const apiKey = env.XAI_API_KEY;
const LINE = "Good afternoon, this is the sales desk. How can I help you today?";

for (const path of ["/v1/tts/voices", "/v1/voices", "/v1/tts/models"]) {
  const res = await fetch(`https://api.x.ai${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
}

async function tts(voice, text = LINE) {
  const res = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, language: "english", voice }),
  });
  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 120)}` };
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf.length, hash: createHash("sha256").update(buf).digest("hex").slice(0, 12), buf };
}

console.log("\n--- same text, different voices (twice each to gauge determinism) ---");
const saved = {};
for (const voice of ["atlas", "eve", "thunder", "gemma", "rex", "bogus-voice"]) {
  const a = await tts(voice);
  const b = await tts(voice);
  console.log(
    `${voice.padEnd(12)} run1=${a.bytes ?? a.error} ${a.hash ?? ""}  run2=${b.bytes ?? b.error} ${b.hash ?? ""}`,
  );
  if (a.buf) saved[voice] = a.buf;
}

for (const [voice, buf] of Object.entries(saved)) {
  writeFileSync(new URL(`../tmp-voice-${voice}.mp3`, import.meta.url), buf);
}
console.log("\nwrote sample mp3s:", Object.keys(saved).join(", "));
