import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CaretDown,
} from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { CinematicCabinZoom, getCabinScreenRect } from "./CinematicCabinZoom.jsx";
import { FullCommandCenter } from "./CinematicCommandCenter.jsx";
import { CinematicJourneyCanvas } from "./CinematicJourneyCanvas.jsx";

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

function smoothStep(value) {
  const position = clamp(value);
  return position * position * (3 - 2 * position);
}

export function CinematicShowcase({ onSkip, onLogin }) {
  const stageRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    function updateStageShape() {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    }

    window.addEventListener("resize", updateStageShape);
    return () => window.removeEventListener("resize", updateStageShape);
  }, []);

  useEffect(() => {
    let readFrameId = 0;
    let smoothFrameId = 0;
    let lastTimestamp = 0;
    let targetProgress = 0;
    let displayedProgress = 0;

    function readProgress() {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const travel = Math.max(1, stage.offsetHeight - window.innerHeight);
      targetProgress = Math.min(1, Math.max(0, -rect.top / travel));
      stage.dataset.targetProgress = targetProgress.toFixed(3);

      if (reducedMotion) {
        displayedProgress = targetProgress;
        setScrollProgress(displayedProgress);
        stage.dataset.progress = displayedProgress.toFixed(3);
        return;
      }

      if (!smoothFrameId) smoothFrameId = window.requestAnimationFrame(smoothProgress);
    }

    function smoothProgress(timestamp) {
      smoothFrameId = 0;
      const elapsed = lastTimestamp ? Math.min(40, timestamp - lastTimestamp) : 16.7;
      lastTimestamp = timestamp;
      const damping = 1 - Math.exp(-elapsed * 0.028);
      displayedProgress += (targetProgress - displayedProgress) * damping;

      if (Math.abs(targetProgress - displayedProgress) < 0.00015) {
        displayedProgress = targetProgress;
      }

      setScrollProgress(displayedProgress);
      if (stageRef.current) stageRef.current.dataset.progress = displayedProgress.toFixed(3);
      if (displayedProgress !== targetProgress) {
        smoothFrameId = window.requestAnimationFrame(smoothProgress);
      } else {
        lastTimestamp = 0;
      }
    }

    function requestUpdate() {
      window.cancelAnimationFrame(readFrameId);
      readFrameId = window.requestAnimationFrame(readProgress);
    }

    readProgress();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.cancelAnimationFrame(readFrameId);
      window.cancelAnimationFrame(smoothFrameId);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [reducedMotion]);

  const heroCopyOpacity = interpolate(scrollProgress, [0, 0.055, 0.12], [1, 1, 0]);
  const followCopyOpacity = interpolate(scrollProgress, [0.1, 0.145, 0.22, 0.27], [0, 1, 1, 0]);
  const cockpitCopyOpacity = interpolate(scrollProgress, [0.34, 0.39, 0.52, 0.58], [0, 1, 1, 0]);
  const canvasOpacity = interpolate(scrollProgress, [0, 0.3, 0.335], [1, 1, 0]);
  const cabinProgress = clamp((scrollProgress - 0.34) / 0.28);
  const cabinOpacity = interpolate(scrollProgress, [0.335, 0.37, 0.82, 0.92], [0, 1, 1, 0]);
  const revealProgress = smoothStep((scrollProgress - 0.58) / 0.33);
  const revealOpacity = interpolate(scrollProgress, [0.335, 0.37, 1], [0, 1, 1]);
  // Follow the physical display while the cabin zooms, then expand from those exact bounds.
  const commandRect = getCabinScreenRect(
    cabinProgress,
    viewportSize.width,
    viewportSize.height,
  );
  const revealStart = [
    (commandRect.top / viewportSize.height) * 100,
    ((viewportSize.width - commandRect.left - commandRect.width) / viewportSize.width) * 100,
    ((viewportSize.height - commandRect.top - commandRect.height) / viewportSize.height) * 100,
    (commandRect.left / viewportSize.width) * 100,
  ];
  const revealInsets = revealStart.map((value) => value * (1 - revealProgress));
  const revealClip = `inset(${revealInsets[0]}% ${revealInsets[1]}% ${revealInsets[2]}% ${revealInsets[3]}% round ${commandRect.radius * (1 - revealProgress)}px)`;
  const dashboardScaleX = interpolate(revealProgress, [0, 1], [commandRect.width / viewportSize.width, 1]);
  const dashboardScaleY = interpolate(revealProgress, [0, 1], [commandRect.height / viewportSize.height, 1]);
  const dashboardTranslateX = (commandRect.centerX - viewportSize.width / 2) * (1 - revealProgress);
  const dashboardTranslateY = (commandRect.centerY - viewportSize.height / 2) * (1 - revealProgress);
  const commandThemeProgress = smoothStep((scrollProgress - 0.82) / 0.18);
  const stageShadeOpacity = interpolate(scrollProgress, [0, 0.36, 0.62, 0.9], [0.1, 0.08, 0.14, 0.68]);
  const navOpacity = interpolate(scrollProgress, [0, 0.74, 0.84], [1, 1, 0]);
  // Hide the brand logo while the car cabin scene is on screen so it reads clean.
  const logoOpacity = interpolate(scrollProgress, [0.3, 0.355], [1, 0]);
  const skipOpacity = interpolate(scrollProgress, [0, 0.75, 0.84], [1, 1, 0]);

  return (
    <section className="cinematic" ref={stageRef} aria-label="PolicyScout product introduction">
      <div className="cinematic-sticky">
        <header className="showcase-nav" style={{ opacity: navOpacity }}>
          <button className="brand-lockup" type="button" style={{ opacity: logoOpacity, pointerEvents: logoOpacity < 0.05 ? "none" : "auto" }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="PolicyScout home">
            <span className="brand-mark" aria-hidden="true" />
            <span>PolicyScout</span>
          </button>
          <nav className="showcase-links" aria-label="Primary navigation">
            <button type="button" onClick={onSkip}>Product <CaretDown size={13} weight="bold" /></button>
            <button type="button" onClick={onSkip}>How it works</button>
            <button type="button" onClick={onSkip}>Trust &amp; safety</button>
          </nav>
          <div className="showcase-actions">
            <button className="nav-login" type="button" onClick={onLogin}>Log in</button>
            <button className="outline-button outline-button--light" type="button" onClick={onSkip}>Try live demo</button>
          </div>
        </header>

        <div className="cinematic-scene" aria-hidden="true">
          <div className="cinematic-canvas-layer" style={{ opacity: canvasOpacity }}>
            <CinematicJourneyCanvas progress={Math.min(scrollProgress, 0.42)} reducedMotion={reducedMotion} />
          </div>
          <CinematicCabinZoom
            progress={cabinProgress}
            style={{ opacity: cabinOpacity }}
          />
          <div className="cinematic-shade" style={{ opacity: stageShadeOpacity }} />
        </div>

        <div className="dashboard-reveal" style={{ opacity: revealOpacity, clipPath: revealClip }}>
          <FullCommandCenter
            themeProgress={commandThemeProgress}
            style={{ transform: `translate(${dashboardTranslateX}px, ${dashboardTranslateY}px) scale(${dashboardScaleX}, ${dashboardScaleY})` }}
          />
        </div>

        <div className="cinematic-copy cinematic-copy--hero" style={{ opacity: heroCopyOpacity }}>
          <h1>Your insurance<br />Finally negotiated.</h1>
          <p className="hero-support">PolicyScout compares top matched quotes,<br />then calls for the best price.</p>
          <div className="hero-actions">
            <button className="primary-button primary-button--mint" type="button" onClick={onSkip}>
              Try live demo <ArrowRight size={18} weight="bold" />
            </button>
            <button className="text-button text-button--light" type="button" onClick={onSkip}>Skip intro</button>
          </div>
        </div>

        <div className="cinematic-copy cinematic-copy--phase" style={{ opacity: followCopyOpacity }}>
          <h2>We call the market.<br />You stay in control.</h2>
          <p>Same coverage, better prices in one dashboard.</p>
        </div>

        <div className="cinematic-copy cinematic-copy--phase" style={{ opacity: cockpitCopyOpacity }}>
          <h2>Listen to the work.<br />Verify every claim.</h2>
        </div>

        <div className="scroll-rail" style={{ opacity: heroCopyOpacity }} aria-hidden="true">
          <span>Scroll to explore</span>
          <div className="scroll-track"><i style={{ transform: `scaleX(${scrollProgress})` }} /></div>
        </div>

        <button className="cinematic-skip" style={{ opacity: skipOpacity }} type="button" onClick={onSkip}>Skip to demo <ArrowRight size={15} weight="bold" /></button>
      </div>
    </section>
  );
}
