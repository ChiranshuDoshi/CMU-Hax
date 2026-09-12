export const INSURERS = [
  {
    id: "harborshield",
    name: "HarborShield Auto",
    shortName: "HarborShield",
    rating: 4.9,
    reviews: "18.4k",
    annual: 1684,
    deductible: 500,
    confidence: "Verified",
    recommended: true,
  },
  {
    id: "autosource",
    name: "AutoSource Mutual",
    shortName: "AutoSource",
    rating: 4.8,
    reviews: "12.7k",
    annual: 1768,
    deductible: 500,
    confidence: "Verified",
  },
  {
    id: "northstar",
    name: "Northstar Insurance",
    shortName: "Northstar",
    rating: 4.7,
    reviews: "9.8k",
    annual: 1820,
    deductible: 500,
    confidence: "Verified",
  },
  {
    id: "beacon",
    name: "Beacon Road",
    shortName: "Beacon",
    rating: 4.6,
    reviews: "8.1k",
    annual: 1874,
    deductible: 750,
    confidence: "Verified",
  },
  {
    id: "safedrive",
    name: "SafeDrive Cooperative",
    shortName: "SafeDrive",
    rating: 4.6,
    reviews: "6.5k",
    annual: 1908,
    deductible: 500,
    confidence: "Verified",
  },
];

export const PRICE_STEPS = [
  { price: 1684, label: "Starting quote", time: "00:00" },
  { price: 1546, label: "Competitive offer matched", time: "01:52", impact: -138 },
  { price: 1472, label: "Telematics discount applied", time: "03:29", impact: -74 },
  { price: 1428, label: "Final approved adjustment", time: "06:11", impact: -44 },
];

export const REPLAY_CLIPS = [
  {
    id: "competing-offer",
    time: "01:52",
    seconds: 112,
    title: "Verified competing offer",
    detail: "Presented a coverage-matched quote from AutoSource.",
    impact: -138,
    speech: "I have a verified competing offer with the same limits and a five hundred dollar deductible. Can you match it without changing coverage?",
  },
  {
    id: "telematics",
    time: "03:29",
    seconds: 209,
    title: "Telematics discount applied",
    detail: "Confirmed the vehicle qualifies for the safe-driving program.",
    impact: -74,
    speech: "The driver has verified safe-driving data available. Please apply the telematics discount to this quote.",
  },
  {
    id: "final-adjustment",
    time: "06:11",
    seconds: 371,
    title: "Final approved adjustment",
    detail: "Asked for a final discretionary reduction to reach the target.",
    impact: -44,
    speech: "We are very close. If you can bring the annual premium below fourteen fifty, my client is prepared to select this offer today.",
  },
];

export const TRANSCRIPT = [
  { time: "05:02", speaker: "PolicyScout", text: "I appreciate you reviewing my client's file." },
  { time: "05:10", speaker: "Agent", text: "I can apply the verified safe-driving discount." },
  { time: "05:36", speaker: "Agent", text: "That brings the final annual premium to $1,428." },
  { time: "05:41", speaker: "PolicyScout", text: "That is within our target. No coverage changes, correct?" },
  { time: "05:45", speaker: "Agent", text: "Correct. The limits and deductibles remain unchanged." },
];
