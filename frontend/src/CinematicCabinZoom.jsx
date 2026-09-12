function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  const position = clamp((value - edge0) / (edge1 - edge0));
  return position * position * (3 - 2 * position);
}

// Inner display bounds measured in the 1672x941 cabin asset.
const CABIN_IMAGE = { width: 1672, height: 941 };
const CABIN_SCREEN = { left: 630, top: 274, right: 1020, bottom: 458 };
const CABIN_ORIGIN = { x: 0.5, y: 0.39 };

export function getCabinImageScale(progress) {
  return 1 + smoothstep(0, 0.86, progress) * 0.68;
}

export function getCabinScreenRect(progress, viewportWidth, viewportHeight) {
  const imageScale = getCabinImageScale(progress);
  const coverScale = Math.max(
    viewportWidth / CABIN_IMAGE.width,
    viewportHeight / CABIN_IMAGE.height,
  );
  const drawLeft = (viewportWidth - CABIN_IMAGE.width * coverScale) / 2;
  const drawTop = (viewportHeight - CABIN_IMAGE.height * coverScale) / 2;
  const originX = viewportWidth * CABIN_ORIGIN.x;
  const originY = viewportHeight * CABIN_ORIGIN.y;
  const projectX = (sourceX) => originX + (drawLeft + sourceX * coverScale - originX) * imageScale;
  const projectY = (sourceY) => originY + (drawTop + sourceY * coverScale - originY) * imageScale;
  const left = projectX(CABIN_SCREEN.left);
  const right = projectX(CABIN_SCREEN.right);
  const top = projectY(CABIN_SCREEN.top);
  const bottom = projectY(CABIN_SCREEN.bottom);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    radius: 6 * imageScale,
  };
}

export function CinematicCabinZoom({ progress, style }) {
  const imageScale = getCabinImageScale(progress);

  return (
    <div className="cinematic-cabin-zoom" style={style} aria-hidden="true">
      <img
        className="cabin-zoom-image cabin-zoom-image--wide"
        src="/assets/between-front-seats-clean.webp"
        alt=""
        style={{
          transform: `scale(${imageScale})`,
        }}
      />
    </div>
  );
}
