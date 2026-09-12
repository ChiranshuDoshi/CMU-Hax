export const HOTELS = [
  {
    id: "lakeside-grand",
    name: "Lakeside Grand Chicago",
    shortName: "Lakeside Grand",
    rating: 4.9,
    reviews: "18.4k",
    nightly: 248,
    roomType: "Deluxe king",
    confidence: "Verified",
    recommended: true,
  },
  {
    id: "westbridge",
    name: "Westbridge Hotel",
    shortName: "Westbridge",
    rating: 4.8,
    reviews: "12.7k",
    nightly: 264,
    roomType: "Deluxe double",
    confidence: "Verified",
  },
  {
    id: "parkline",
    name: "Parkline Suites",
    shortName: "Parkline",
    rating: 4.7,
    reviews: "9.8k",
    nightly: 276,
    roomType: "Executive king",
    confidence: "Verified",
  },
  {
    id: "the-atrium",
    name: "The Atrium Chicago",
    shortName: "The Atrium",
    rating: 4.6,
    reviews: "8.1k",
    nightly: 288,
    roomType: "Premium double",
    confidence: "Verified",
  },
  {
    id: "shoreline-house",
    name: "Shoreline House",
    shortName: "Shoreline",
    rating: 4.6,
    reviews: "6.5k",
    nightly: 301,
    roomType: "Deluxe king",
    confidence: "Verified",
  },
];

/** @deprecated Use HOTELS — kept for any remaining import sites during migration. */
export const INSURERS = HOTELS.map((hotel) => ({
  ...hotel,
  annual: hotel.nightly,
  deductible: hotel.roomType,
}));

export const PRICE_STEPS = [
  { price: 248, label: "Opening group rate", time: "00:00" },
  { price: 232, label: "Competing group offer matched", time: "01:52", impact: -16 },
  { price: 219, label: "Breakfast package added", time: "03:29", impact: -13 },
  { price: 208, label: "Final group rate approved", time: "06:11", impact: -11 },
];

export const REPLAY_CLIPS = [
  {
    id: "competing-offer",
    time: "01:52",
    seconds: 112,
    title: "Comparable group offer",
    detail: "Presented a verified like-for-like Chicago hotel rate.",
    impact: -16,
    speech: "I have a verified group offer with the same dates, room count, and breakfast package. Can you match it without changing the stay details?",
  },
  {
    id: "telematics",
    time: "03:29",
    seconds: 209,
    title: "Breakfast package added",
    detail: "Confirmed daily breakfast for every guest at no added cost.",
    impact: -13,
    speech: "Our group needs breakfast included for every guest. Please add it to this rate without increasing the per-room total.",
  },
  {
    id: "final-adjustment",
    time: "06:11",
    seconds: 371,
    title: "Final group rate",
    detail: "Asked for a final reduction to reach the private target.",
    impact: -11,
    speech: "We are very close. If you can bring the nightly room rate below two hundred fifteen, our group is ready to book today.",
  },
];

export const TRANSCRIPT = [
  { time: "05:02", speaker: "StayScout", text: "Thank you for reviewing our group booking request." },
  { time: "05:10", speaker: "Hotel sales", text: "I can include the daily breakfast package for your group." },
  { time: "05:36", speaker: "Hotel sales", text: "That brings the final group rate to $208 per room, per night." },
  { time: "05:41", speaker: "StayScout", text: "That is within our target. The room count and amenities are unchanged, correct?" },
  { time: "05:45", speaker: "Hotel sales", text: "Correct. The dates, rooms, and included facilities remain unchanged." },
];
