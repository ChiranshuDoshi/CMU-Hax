// Deterministic placeholder photography for discovered hotels. Hotel names come
// from live search, so there is no real photo to show; mapping the name onto a
// fixed set keeps each hotel's image stable across renders and steps.

const HOTEL_IMAGES = [
  "/assets/hotels/hotel-a.jpg",
  "/assets/hotels/hotel-b.jpg",
  "/assets/hotels/hotel-c.jpg",
  "/assets/hotels/hotel-d.jpg",
  "/assets/hotels/hotel-e.jpg",
  "/assets/hotels/hotel-f.jpg",
];

// Tints for the monogram fallback shown until the photo decodes.
const HOTEL_TINTS = [
  "linear-gradient(135deg, #1f3d3a, #3c6f64)",
  "linear-gradient(135deg, #3a2f24, #7a5c3c)",
  "linear-gradient(135deg, #1d2b3a, #40607f)",
  "linear-gradient(135deg, #2e2338, #5f4a72)",
  "linear-gradient(135deg, #3a241f, #8a5341)",
  "linear-gradient(135deg, #1c3330, #35705f)",
];

function hashName(name) {
  const text = String(name ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 0xffffffff;
  }
  return hash;
}

/** Stable placeholder photo for a hotel name. */
export function hotelImageFor(name) {
  return HOTEL_IMAGES[hashName(name) % HOTEL_IMAGES.length];
}

/** Stable gradient used behind the photo while it loads. */
export function hotelTintFor(name) {
  return HOTEL_TINTS[hashName(name) % HOTEL_TINTS.length];
}
