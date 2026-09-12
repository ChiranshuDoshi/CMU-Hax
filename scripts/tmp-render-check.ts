import { readFileSync, writeFileSync } from "node:fs";

import { buildAgentCall, reductionPctFor } from "../src/backend/app/agent-calls";
import { renderNegotiationRecording } from "../src/backend/app/negotiation-recording";
import type { QuoteView } from "../src/backend/app/store";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  process.env[trimmed.slice(0, eq).trim()] ??= trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

const quote = {
  quoteId: "q1",
  providerId: "hampton-inn-cleveland-downtown",
  providerName: "Hampton Inn Cleveland Downtown",
  rank: 1,
  rating: 4.6,
  reviewCount: 1840,
  effectiveComparisonCostCents: 12_300,
  annualizedCostCents: 12_300,
  monthlyCents: null,
  deductibleCents: null,
  coverageEquivalence: "equivalent",
  redFlags: [],
  recommended: true,
  roomType: "Deluxe king",
  aggregators: [
    { name: "Kayak", nightlyCents: 12_300, url: "https://kayak.com" },
    { name: "Hotels.com", nightlyCents: 12_900, url: "https://hotels.com" },
  ],
} satisfies QuoteView;

// Reductions must be stable and inside the 10–18% band for any hotel id.
const pcts = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => reductionPctFor(id));
console.log("reduction pcts:", pcts.join(", "));
console.log("in band:", pcts.every((p) => p >= 10 && p <= 18));
console.log("stable:", reductionPctFor("a") === reductionPctFor("a"));

const call = buildAgentCall(quote, { rooms: 24, nights: 3 })!;
console.log(
  `\n${call.providerName}: ${call.aggregatorLowCents / 100} -> ${call.agentQuoteCents / 100} (-${call.savedPct}%), group total saved $${call.totalSavedCents / 100}`,
);
for (const line of call.script) console.log(`  [${line.speaker}] ${line.text}`);

const started = Date.now();
const audio = await renderNegotiationRecording(call.script);
console.log(`\nrendered ${audio.byteLength} bytes in ${Date.now() - started}ms`);
console.log("mp3 frame sync:", audio.subarray(0, 2).toString("hex"));
writeFileSync("tmp-negotiation.mp3", audio);
