import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const API_KEY_NAME = "ELEVENLABS_API_KEY";
const ENV_FILE = resolve(".env");
const LOCAL_SERVER = resolve(".mcp-cache/venv/bin/elevenlabs-mcp");

function readApiKey() {
  if (process.env[API_KEY_NAME]?.trim()) return process.env[API_KEY_NAME].trim();
  if (!existsSync(ENV_FILE)) return "";

  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`${API_KEY_NAME}=`));
  if (!line) return "";

  const value = line.slice(API_KEY_NAME.length + 1).trim();
  const quoted = value.match(/^(["'])(.*)\1$/u);
  return (quoted?.[2] ?? value).trim();
}

const apiKey = readApiKey();
if (!apiKey) {
  console.error(`${API_KEY_NAME} must be set in .env or the Codex process environment.`);
  process.exit(1);
}

if (!existsSync(LOCAL_SERVER)) {
  console.error("ElevenLabs MCP is not installed. Run: uv venv .mcp-cache/venv && uv pip install --python .mcp-cache/venv/bin/python elevenlabs-mcp");
  process.exit(1);
}

const child = spawn(LOCAL_SERVER, [], {
  env: { ...process.env, [API_KEY_NAME]: apiKey },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Unable to start ElevenLabs MCP: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
