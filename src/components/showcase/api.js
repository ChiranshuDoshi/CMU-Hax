// Browser client for the Atrium BFF (same-origin). Every call returns the
// `{ snapshot }` envelope (or throws with the server's error message).

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.error) throw new Error(data.error.message || data.error.code || "Request failed");
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return data;
}

export const api = {
  signup: (displayName, email) => post("/api/app/signup", { displayName, email }),
  research: (profile) => post("/api/app/research", profile),
  quotes: () => post("/api/app/quotes", {}),
  agentCalls: (selectedQuoteIds) => post("/api/app/agent-calls", { selectedQuoteIds }),
  negotiate: (targetAmountCents, selectedQuoteId) =>
    post("/api/app/negotiate", { targetAmountCents, selectedQuoteId }),
  startCall: (targetAmountCents, selectedQuoteId) =>
    post("/api/app/negotiate/call/start", { targetAmountCents, selectedQuoteId }),
  callConnected: (conversationId) =>
    post("/api/app/negotiate/call/connected", { conversationId }),
  completeCall: (payload) => post("/api/app/negotiate/call/complete", payload ?? {}),
  recordNegotiationEvent: (event) => post("/api/app/negotiate/call/event", event),
  pollNegotiation: () => post("/api/app/negotiate/poll", {}),
  async workflow() {
    const res = await fetch("/api/app/workflow", { headers: { "cache-control": "no-store" } });
    const data = await res.json().catch(() => ({}));
    if (data?.error) throw new Error(data.error.message || "Request failed");
    return data;
  },
};

/** Maps stay-profile form fields into the API's CarProfile payload. */
export function toCarProfile(profile, bodyType) {
  const digits = (value) => String(value ?? "").replace(/[^\d]/g, "");
  const firstNumber = (value) => {
    const match = String(value ?? "").match(/\d+/);
    return match ? match[0] : "";
  };
  const rooms = digits(profile.rooms) || digits(profile.mileage);
  const premiumDigits = firstNumber(profile.premium) || firstNumber(profile.budget);
  const locationCity = String(profile.location || profile.make || "Chicago")
    .split(",")[0]
    .trim() || "Chicago";
  const model = (bodyType || profile.model || "Deluxe").trim();

  return {
    year: Number(digits(profile.year)) || 2024,
    make: locationCity,
    model,
    bodyType: bodyType || model || undefined,
    state: (profile.state || "IL").trim().toUpperCase().slice(0, 2),
    zipCode: digits(profile.zip).slice(0, 5) || "60601",
    annualMileage: Number(rooms) || undefined,
    currentPremiumCents: premiumDigits ? Number(premiumDigits) * 100 : null,
  };
}
