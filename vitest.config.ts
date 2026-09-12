import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@/domain/negotiation", replacement: fileURLToPath(new URL("./src/backend/negotiator/domain/negotiation", import.meta.url)) },
      { find: "@/domain/handoff", replacement: fileURLToPath(new URL("./src/backend/negotiator/domain/handoff", import.meta.url)) },
      { find: "@/domain/recommendation", replacement: fileURLToPath(new URL("./src/backend/negotiator/domain/recommendation", import.meta.url)) },
      { find: "@/server/services/conversations", replacement: fileURLToPath(new URL("./src/backend/negotiator/services/conversations", import.meta.url)) },
      { find: "@/integrations/elevenlabs", replacement: fileURLToPath(new URL("./src/backend/negotiator/integrations/elevenlabs", import.meta.url)) },
      { find: "@/integrations/twilio", replacement: fileURLToPath(new URL("./src/backend/negotiator/integrations/twilio", import.meta.url)) },
      { find: "@/domain/equivalence", replacement: fileURLToPath(new URL("./src/backend/market-research/domain/equivalence", import.meta.url)) },
      { find: "@/domain/normalization", replacement: fileURLToPath(new URL("./src/backend/market-research/domain/normalization", import.meta.url)) },
      { find: "@/domain/red-flags", replacement: fileURLToPath(new URL("./src/backend/market-research/domain/red-flags", import.meta.url)) },
      { find: "@/domain/research", replacement: fileURLToPath(new URL("./src/backend/market-research/domain/research", import.meta.url)) },
      { find: "@/integrations/tavily", replacement: fileURLToPath(new URL("./src/backend/market-research/integrations/tavily", import.meta.url)) },
      { find: "@/config/insurance-lines", replacement: fileURLToPath(new URL("./src/backend/shared/config/insurance-lines", import.meta.url)) },
      { find: "@/domain/schemas", replacement: fileURLToPath(new URL("./src/backend/shared/schemas", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    coverage: { reporter: ["text", "json", "html"] },
  },
});
