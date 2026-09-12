import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. A stray lockfile in the home
  // directory otherwise makes Next infer the wrong root, which breaks app-router
  // resolution and exhausts the file watcher (EMFILE).
  turbopack: { root: projectRoot },
  // Keep Zod native in Node route handlers to avoid Turbopack cross-chunk initialization failures.
  serverExternalPackages: ["zod"],
};

export default nextConfig;
