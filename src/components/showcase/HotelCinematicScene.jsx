/*
 * Photography (both supplied by the project owner for this homepage):
 *  - Facade plate: /assets/hotel/entrance-user-3600.jpg (3600×2400, from the owner's 4× upscale;
 *    /assets/hotel/entrance-user-1600.jpg is served under 860px) — limestone facade, black marquee,
 *    twin lanterns, double glass doors. The two door leaves are cut from this same file (CSS
 *    background crops registered to the plate), so the closed state is pixel-identical.
 *  - Lobby plate:  /assets/hotel/lobby-user.jpg (1024×682) — the marble lobby seen through the
 *    opening doors and walked into. The reception desk and laptop are CSS geometry.
 *
 * Every rectangle below is a fraction of its source photograph. CinematicShowcase converts them
 * to pixels once per frame and writes CSS variables, so door leaves, the hole in the facade, the
 * laptop bezel and the dashboard clip are all derived from the same numbers and cannot drift.
 */

export const ENTRANCE_PLATE = {
  src: "/assets/hotel/entrance-user-3600.jpg",
  srcSmall: "/assets/hotel/entrance-user-1600.jpg",
  width: 3600,
  height: 2400,
  // The double doors (both leaves, inside the black frame). Also the dolly target.
  door: { x: 0.457, y: 0.512, w: 0.086, h: 0.236 },
  // Lantern positions for the warm bloom that grows as we approach.
  lanterns: [
    { x: 0.333, y: 0.535 },
    { x: 0.667, y: 0.535 },
  ],
};

export const LOBBY_PLATE = {
  src: "/assets/hotel/lobby-user.jpg",
  width: 1024,
  height: 682,
  anchor: { x: 0.5, y: 0.5 },
  // Reception desk composited over the flower table (fractions of the plate).
  desk: { x: 0.372, y: 0.405, w: 0.256, h: 0.265, topDepth: 0.09 },
  // 14" MacBook-style laptop seated on the desk top: lid width as a fraction of the plate width,
  // 16:10 glass, bezel and lid corner radius as fractions of lid width, lid tilted back.
  laptop: { cx: 0.5, w: 0.088, aspect: 16 / 10, bezel: 0.03, radius: 0.022, tiltDeg: 12 },
};

/**
 * Cover-fit a plate over `vw × vh`, sliding it so `anchor` (plate fractions) lands at the
 * viewport centre, clamped so the frame always covers the viewport. Returns the frame in px.
 */
export function fitPlate(plate, anchor, vw, vh) {
  const scale = Math.max(vw / plate.width, vh / plate.height);
  const width = plate.width * scale;
  const height = plate.height * scale;
  let left = vw / 2 - anchor.x * width;
  let top = vh / 2 - anchor.y * height;
  left = Math.min(0, Math.max(vw - width, left));
  top = Math.min(0, Math.max(vh - height, top));
  return { left, top, width, height, scale };
}

/** Door opening rectangle relative to the facade frame (px). */
export function doorRectFor(frame, plate) {
  const d = plate.door;
  return {
    left: d.x * frame.width,
    top: d.y * frame.height,
    width: d.w * frame.width,
    height: d.h * frame.height,
  };
}

export function deskRectFor(frame, plate) {
  const d = plate.desk;
  return {
    left: frame.left + d.x * frame.width,
    top: frame.top + d.y * frame.height,
    width: d.w * frame.width,
    height: d.h * frame.height,
    topDepth: d.topDepth * d.h * frame.height,
  };
}

/** Laptop lid + glass rectangles (viewport px, lobby layer at scale 1, lid un-tilted). */
export function laptopRectFor(frame, desk, plate) {
  const spec = plate.laptop;
  const lidWidth = spec.w * frame.width;
  const bezel = lidWidth * spec.bezel;
  const glassWidth = lidWidth - bezel * 2;
  const glassHeight = glassWidth / spec.aspect;
  const lidHeight = glassHeight + bezel * 2;
  const lidLeft = frame.left + spec.cx * frame.width - lidWidth / 2;
  // Hinge line sits a little behind the front edge of the desk's top surface.
  const hinge = desk.top + desk.topDepth * 0.28;
  const lidTop = hinge - lidHeight;
  return {
    lid: { left: lidLeft, top: lidTop, width: lidWidth, height: lidHeight, radius: lidWidth * spec.radius },
    glass: {
      left: lidLeft + bezel,
      top: lidTop + bezel,
      width: glassWidth,
      height: glassHeight,
      radius: Math.max(1.5, lidWidth * spec.radius - bezel * 0.6),
    },
    hinge,
    bezel,
    tilt: spec.tiltDeg,
  };
}

export function HotelCinematicScene({ children }) {
  return (
    <div className="hotel-scene" aria-hidden="true">
      {/* z1 — the lobby: plate + desk + laptop in one layer. It is the only thing that scales
          (about the laptop glass centre) from the doorway all the way into the screen. */}
      <div className="hotel-lobby">
        <div className="hotel-frame hotel-frame--lobby">
          <img className="hotel-plate-img" src={LOBBY_PLATE.src} alt="" draggable="false" />
        </div>

        <div className="hotel-desk-reflection" />
        <div className="hotel-desk-shadow" />
        <div className="hotel-desk">
          <div className="hotel-desk-top" />
          <div className="hotel-desk-front" />
          <div className="hotel-desk-plinth" />
        </div>

        <div className="hotel-laptop-shadow" />
        <div className="hotel-laptop-deck" />
        <div className="hotel-laptop-lid" />
      </div>

      {/* z2 — live dashboard, clipped to the laptop glass and tilted exactly like the lid
          (same hinge, same perspective), later flattened and expanded to the viewport. */}
      <div className="hotel-screen-3d">
        <div className="dashboard-reveal hotel-screen-reveal">{children}</div>
        <div className="hotel-glass-glare" />
      </div>

      {/* z4 — warm doorway haze that thins out as we walk in. */}
      <div className="hotel-haze" />

      {/* z5 — the facade. The photo has a hole punched where the doors are; the two leaves are
          cropped from the same photo and swing open on their outer hinges. */}
      <div className="hotel-facade">
        <div className="hotel-frame hotel-frame--facade">
          <div className="hotel-facade-photo" />
          <div className="hotel-bloom hotel-bloom--left" />
          <div className="hotel-bloom hotel-bloom--right" />
          <div className="hotel-doorway">
            <div className="hotel-door hotel-door--left">
              <div className="hotel-door-leaf" />
              <div className="hotel-door-shade" />
            </div>
            <div className="hotel-door hotel-door--right">
              <div className="hotel-door-leaf" />
              <div className="hotel-door-shade" />
            </div>
          </div>
        </div>
      </div>

      <div className="hotel-vignette" />
    </div>
  );
}
