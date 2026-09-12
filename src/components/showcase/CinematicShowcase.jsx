import { useEffect, useRef } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { BrandMark } from "./BrandMark.jsx";
import { HotelBookingDashboard } from "./HotelBookingDashboard.jsx";
import {
  HotelCinematicScene,
  ENTRANCE_PLATE,
  LOBBY_PLATE,
  fitPlate,
  doorRectFor,
  deskRectFor,
  laptopRectFor,
} from "./HotelCinematicScene.jsx";

function interpolate(value, input, output) {
  if (value <= input[0]) return output[0];
  if (value >= input[input.length - 1]) return output[output.length - 1];
  for (let index = 0; index < input.length - 1; index += 1) {
    if (value <= input[index + 1]) {
      const range = input[index + 1] - input[index];
      const local = range === 0 ? 0 : (value - input[index]) / range;
      return output[index] + (output[index + 1] - output[index]) * local;
    }
  }
  return output[output.length - 1];
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(value) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

const px = (value) => `${value.toFixed(2)}px`;

// Scroll timeline — fractions of the pinned section's travel.
const T = {
  heroOut: [0, 0.05],
  approach: [0.03, 0.3],        // dolly toward the doors: facade 1× → door fills the viewport
  door: [0.14, 0.3],            // leaves swing inward 0 → 80°
  facadeFade: [0.26, 0.34],     // facade edges dissolve; lobby eases from door-fit to full-bleed
  hall: [0.34, 0.68],           // walk-in: lobby 1× → 1.42× toward the desk
  hallCopy: [[0.38, 0.49], [0.49, 0.59], [0.59, 0.68]],
  receptionCopy: [0.68, 0.76],  // visible, then fades in the first 30% of the expand
  expand: [0.76, 1],            // dolly into the laptop + lid flattens + clip opens
};

// Lobby scale at the end of the walk-in, and the extra dolly during the expand.
const WALK_END = 1.42;
const DOLLY_END = 2.3;
// Screen-space perspective distance shared by the lid and the dashboard plane.
const PERSPECTIVE = 1600;

function beat(progress, [start, end]) {
  const t = clamp((progress - start) / (end - start));
  // Fade in over the first 30%, out over the last 25%; rise as it enters, drift as it exits.
  const opacity = interpolate(t, [0, 0.3, 0.75, 1], [0, 1, 1, 0]);
  const shift = interpolate(t, [0, 0.3, 0.75, 1], [26, 0, 0, -14]);
  return { opacity, shift };
}

export function CinematicShowcase({ onSkip, onLogin }) {
  const stageRef = useRef(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let frameId = 0;
    const set = (name, value) => stage.style.setProperty(name, value);

    function paint() {
      frameId = 0;
      const rect = stage.getBoundingClientRect();
      const travel = Math.max(1, stage.offsetHeight - window.innerHeight);
      const progress = reducedMotion ? 1 : clamp(-rect.top / travel);
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // --- geometry, all derived from the plate definitions --------------------------------
      const doorAnchor = {
        x: ENTRANCE_PLATE.door.x + ENTRANCE_PLATE.door.w / 2,
        y: ENTRANCE_PLATE.door.y + ENTRANCE_PLATE.door.h / 2,
      };
      const facadeFrame = fitPlate(ENTRANCE_PLATE, doorAnchor, vw, vh);
      const door = doorRectFor(facadeFrame, ENTRANCE_PLATE);
      const doorCx = facadeFrame.left + door.left + door.width / 2;
      const doorCy = facadeFrame.top + door.top + door.height / 2;

      const frame = fitPlate(LOBBY_PLATE, LOBBY_PLATE.anchor, vw, vh);
      const desk = deskRectFor(frame, LOBBY_PLATE);
      const laptop = laptopRectFor(frame, desk, LOBBY_PLATE);
      const glass0 = laptop.glass;
      const gx = glass0.left + glass0.width / 2;
      const gy = glass0.top + glass0.height / 2;

      set("--facade-left", px(facadeFrame.left));
      set("--facade-top", px(facadeFrame.top));
      set("--facade-w", px(facadeFrame.width));
      set("--facade-h", px(facadeFrame.height));
      set("--door-x", px(door.left));
      set("--door-y", px(door.top));
      set("--door-w", px(door.width));
      set("--door-h", px(door.height));
      set("--door-cx", px(doorCx));
      set("--door-cy", px(doorCy));
      ENTRANCE_PLATE.lanterns.forEach((l, i) => {
        set(`--lantern-${i + 1}-x`, px(l.x * facadeFrame.width));
        set(`--lantern-${i + 1}-y`, px(l.y * facadeFrame.height));
      });

      set("--lobby-left", px(frame.left));
      set("--lobby-top", px(frame.top));
      set("--lobby-w", px(frame.width));
      set("--lobby-h", px(frame.height));
      set("--desk-x", px(desk.left));
      set("--desk-y", px(desk.top));
      set("--desk-w", px(desk.width));
      set("--desk-h", px(desk.height));
      set("--desk-top-h", px(desk.topDepth));
      set("--lid-x", px(laptop.lid.left));
      set("--lid-y", px(laptop.lid.top));
      set("--lid-w", px(laptop.lid.width));
      set("--lid-h", px(laptop.lid.height));
      set("--lid-r", px(laptop.lid.radius));
      set("--glass-cx", px(gx));
      set("--glass-cy", px(gy));

      // --- approach: facade dollies toward the doors until the opening fills the height ------
      const approach = easeInOut(clamp((progress - T.approach[0]) / (T.approach[1] - T.approach[0])));
      const fadeT = clamp((progress - T.facadeFade[0]) / (T.facadeFade[1] - T.facadeFade[0]));
      const doorFill = (vh * 0.92) / door.height;            // scale at which the doors span 92% of vh
      const F = (1 + approach * (doorFill - 1)) * (1 + easeInOut(fadeT) * 0.35);
      set("--facade-scale", F.toFixed(5));
      set("--facade-opacity", (1 - easeInOut(fadeT)).toFixed(3));
      set("--bloom", interpolate(approach, [0, 1], [0.25, 1]).toFixed(3));

      // --- doors (1:1 with scroll) --------------------------------------------------------
      const doorT = easeInOut(clamp((progress - T.door[0]) / (T.door[1] - T.door[0])));
      set("--door-angle", `${(doorT * 80).toFixed(3)}deg`);

      // --- one continuous lobby move: seen through the door → full-bleed → desk → screen ----
      const expand = clamp((progress - T.expand[0]) / (T.expand[1] - T.expand[0]));
      const walk = easeInOut(clamp((progress - T.hall[0]) / (T.hall[1] - T.hall[0])));
      const dolly = easeInOut(expand);
      // While the facade is up, the lobby is fitted to the door opening (its height); as the
      // facade dissolves it eases to full-bleed, then walks to the desk and into the laptop.
      const holeH = door.height * F;
      const fitL = Math.min(1, holeH / vh);
      const L0 = fitL + (1 - fitL) * easeInOut(fadeT);
      const S = L0 * (1 + walk * (WALK_END - 1)) * (1 + dolly * (DOLLY_END - 1));
      // Centre the door-fitted lobby on the opening, easing to no offset as the facade goes.
      const cx = vw / 2;
      const cy = vh / 2;
      const k = 1 - easeInOut(fadeT);
      const tx = (doorCx - (gx + (cx - gx) * S)) * k;
      const ty = (doorCy - (gy + (cy - gy) * S)) * k;
      set("--lobby-scale", S.toFixed(5));
      set("--lobby-tx", px(tx));
      set("--lobby-ty", px(ty));

      // Glass rectangle on screen (pre-tilt) after the lobby transform.
      const glass = {
        left: gx - (glass0.width / 2) * S + tx,
        top: gy - (glass0.height / 2) * S + ty,
        width: glass0.width * S,
        height: glass0.height * S,
        radius: glass0.radius * S,
      };
      const hingeY = gy + (laptop.hinge - gy) * S + ty;
      const tilt = laptop.tilt * (1 - easeInOut(clamp(expand / 0.5)));
      set("--lid-tilt", `${tilt.toFixed(3)}deg`);
      set("--lid-persp", px(PERSPECTIVE / S));
      set("--screen-persp", px(PERSPECTIVE));
      set("--hinge-x", px(gx + tx));
      set("--hinge-y", px(hingeY));

      const lerp = (a, b) => a + (b - a) * expand;
      const clipLeft = lerp(glass.left, 0);
      const clipTop = lerp(glass.top, 0);
      const clipWidth = lerp(glass.width, vw);
      const clipHeight = lerp(glass.height, vh);
      const radius = lerp(glass.radius, 0);
      // Uniform scale that lets the dashboard cover the clip rectangle at every step.
      const scale = Math.max(clipWidth / vw, clipHeight / vh);
      // Keep the dashboard's top-left glued to the clip's top-left (no drift).
      const dx = clipLeft - (vw - vw * scale) / 2;
      const dy = clipTop - (vh - vh * scale) / 2;

      set("--glass-x", px(glass.left));
      set("--glass-y", px(glass.top));
      set("--glass-w", px(glass.width));
      set("--glass-h", px(glass.height));
      set("--screen-radius", px(radius));
      set("--clip-x", px(clipLeft));
      set("--clip-y", px(clipTop));
      set("--clip-right", px(vw - clipLeft - clipWidth));
      set("--clip-bottom", px(vh - clipTop - clipHeight));
      set("--dash-x", px(dx));
      set("--dash-y", px(dy));
      set("--dash-s", scale.toFixed(5));
      set("--expand", expand.toFixed(4));
      set("--bezel-opacity", interpolate(expand, [0.04, 0.3], [1, 0]).toFixed(3));
      set("--glare-opacity", interpolate(expand, [0, 0.12], [0.9, 0]).toFixed(3));
      set("--haze-opacity", interpolate(progress, [T.hall[0], T.hall[1]], [1, 0]).toFixed(3));

      // --- hallway copy --------------------------------------------------------------------
      T.hallCopy.forEach((window_, index) => {
        const { opacity, shift } = beat(progress, window_);
        set(`--hall-copy-${index + 1}-opacity`, opacity.toFixed(3));
        set(`--hall-copy-${index + 1}-shift`, px(shift));
      });

      // --- chrome --------------------------------------------------------------------------
      set("--hero-opacity", interpolate(progress, T.heroOut, [1, 0]).toFixed(3));
      set("--hero-shift", px(interpolate(progress, T.heroOut, [0, -24])));
      const rc = beat(progress, [T.receptionCopy[0], T.expand[0] + 0.3 * (T.expand[1] - T.expand[0])]);
      set("--reception-copy-opacity", rc.opacity.toFixed(3));
      set("--reception-copy-shift", px(rc.shift));
      set("--skip-opacity", interpolate(progress, [T.expand[0], T.expand[0] + 0.06], [1, 0]).toFixed(3));
      set("--vignette-opacity", interpolate(progress, [0, T.approach[1], T.hall[1]], [0.35, 0.55, 0]).toFixed(3));
      set("--scroll-progress", progress.toFixed(4));
      stage.dataset.progress = progress.toFixed(3);
      stage.dataset.expand = expand.toFixed(3);
    }

    function requestPaint() {
      if (!frameId) frameId = window.requestAnimationFrame(paint);
    }

    paint();
    window.addEventListener("scroll", requestPaint, { passive: true });
    window.addEventListener("resize", requestPaint);
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", requestPaint);
      window.removeEventListener("resize", requestPaint);
    };
  }, [reducedMotion]);

  return (
    <section className="cinematic cinematic--hotel" ref={stageRef} aria-label="Atrium arrival">
      <div className="cinematic-sticky">
        <header className="showcase-nav showcase-nav--glass">
          <button
            className="brand-lockup"
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Atrium home"
          >
            <BrandMark />
            <span>Atrium</span>
          </button>
          <nav className="showcase-links glass-pill" aria-label="Primary navigation">
            <button type="button" onClick={onSkip}>Residences</button>
            <button type="button" onClick={onSkip}>Reception</button>
            <button type="button" onClick={onSkip}>Arrivals</button>
          </nav>
          <div className="showcase-actions">
            <button className="nav-login glass-pill" type="button" onClick={onLogin}>Sign in</button>
            <button className="glass-button glass-button--solid" type="button" onClick={onSkip}>Request a stay</button>
          </div>
        </header>

        <div className="cinematic-scene" aria-hidden="true">
          <HotelCinematicScene>
            <HotelBookingDashboard />
          </HotelCinematicScene>
        </div>

        <div className="cinematic-copy cinematic-copy--hero">
          <p className="scene-index glass-kicker">Fifth Avenue · New York</p>
          <h1>Good evening.</h1>
          <p className="hero-support">The suite is held. Your name is already at the desk. Come in.</p>
          <div className="hero-actions">
            <button className="glass-button glass-button--solid" type="button" onClick={onSkip}>
              Request a stay <ArrowRight size={16} weight="bold" />
            </button>
            <button className="glass-text" type="button" onClick={onSkip}>Enter quietly</button>
          </div>
        </div>

        {/* Hallway beats — Apple product-page register, scrubbed with scroll. */}
        <div className="hall-copy hall-copy--1">
          <h2>The best rate.<br />Negotiated for you.</h2>
          <p>Atrium talks to the hotel so you never have to.</p>
        </div>
        <div className="hall-copy hall-copy--2">
          <h2>Every deal on the table.<br />Instantly.</h2>
          <p>Rates, upgrades and perks — compared in one place, in one moment.</p>
        </div>
        <div className="hall-copy hall-copy--3">
          <h2>Effortless.<br />From door to key.</h2>
          <p>Book in a minute. Arrive like you were expected.</p>
        </div>

        <div className="cinematic-copy cinematic-copy--phase cinematic-copy--reception">
          <div className="glass-caption glass-caption--light">
            <p className="glass-kicker">Reception</p>
            <h2>The front desk.</h2>
            <p>Your stay is on the screen. Dates, residence, and the key — already arranged.</p>
          </div>
        </div>

        <div className="hotel-screen-label glass-pill" aria-hidden="true">
          <i />
          <span>Your stay, on the desk</span>
        </div>

        <div className="scroll-rail glass-pill" aria-hidden="true">
          <span>Scroll to enter</span>
          <div className="scroll-track"><i /></div>
        </div>

        <button className="cinematic-skip glass-button" type="button" onClick={onSkip}>
          Skip to the desk <ArrowRight size={14} weight="bold" />
        </button>
      </div>
    </section>
  );
}
