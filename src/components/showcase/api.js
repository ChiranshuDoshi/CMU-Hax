// Browser client for the PolicyScout BFF (same-origin). Every call returns the
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
  negotiate: (targetAmountCents, selectedQuoteId) =>
    post("/api/app/negotiate", { targetAmountCents, selectedQuoteId }),
  startCall: (targetAmountCents, selectedQuoteId) =>
    post("/api/app/negotiate/call/start", { targetAmountCents, selectedQuoteId }),
  callConnected: (conversationId) =>
    post("/api/app/negotiate/call/connected", { conversationId }),
  recordNegotiationEvent: (event) => post("/api/app/negotiate/call/event", event),
  pollNegotiation: () => post("/api/app/negotiate/poll", {}),
  async workflow() {
    const res = await fetch("/api/app/workflow", { headers: { "cache-control": "no-store" } });
    const data = await res.json().catch(() => ({}));
    if (data?.error) throw new Error(data.error.message || "Request failed");
    return data;
  },
};

/** Maps the messy vehicle form fields into the API's CarProfile payload. */
export function toCarProfile(profile, bodyType) {
  const digits = (value) => String(value ?? "").replace(/[^\d]/g, "");
  const premiumDigits = digits(profile.premium);
  return {
    year: Number(digits(profile.year)) || undefined,
    make: (profile.make || "").trim(),
    model: (profile.model || "").trim(),
    bodyType: bodyType || undefined,
    state: (profile.state || "TX").trim().toUpperCase().slice(0, 2),
    zipCode: digits(profile.zip).slice(0, 5),
    annualMileage: Number(digits(profile.mileage)) || undefined,
    currentPremiumCents: premiumDigits ? Number(premiumDigits) * 100 : null,
  };
}
