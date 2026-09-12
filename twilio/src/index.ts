import "dotenv/config";

import { loadConfig } from "./config.js";
import { createTwilioServer } from "./server.js";

const config = loadConfig();
const server = createTwilioServer({ config });

server.listen(config.port, "0.0.0.0", () => {
  console.info(`[twilio] gateway listening on port ${config.port}`);
});

function shutdown(signal: string): void {
  console.info(`[twilio] received ${signal}; shutting down`);
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
