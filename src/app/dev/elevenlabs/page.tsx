import { notFound } from "next/navigation";

import { ElevenLabsDemoClient } from "./demo-client";

export const dynamic = "force-dynamic";

export default function ElevenLabsDemoPage() {
  if (process.env.NODE_ENV === "production" || process.env.DEMO_MODE !== "true") notFound();
  return <ElevenLabsDemoClient />;
}
