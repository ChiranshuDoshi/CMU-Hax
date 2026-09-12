import { useEffect, useRef } from "react";

const JOURNEY_END = 0.3;
const COVER_OVERSCAN = 1.04;

const JOURNEY_FRAMES = [
  { src: "/assets/rear-follow-medium-clean.webp", focal: [0.5, 0.46] },
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  const position = clamp((value - edge0) / (edge1 - edge0));
  return position * position * (3 - 2 * position);
}

function drawCover(context, image, width, height, scale, focal, alpha = 1, offset = [0, 0], blur = 0) {
  const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * COVER_OVERSCAN;
  const drawWidth = image.naturalWidth * coverScale;
  const drawHeight = image.naturalHeight * coverScale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;

  context.save();
  context.globalAlpha = alpha;
  context.filter = blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : "none";
  context.translate(width * (focal[0] + offset[0]), height * (focal[1] + offset[1]));
  context.scale(scale, scale);
  context.translate(-width * focal[0], -height * focal[1]);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  context.restore();
}

function drawTransitionVignette(context, width, height, energy) {
  if (energy < 0.01) return;
  const radius = Math.hypot(width, height) * 0.7;
  const gradient = context.createRadialGradient(width * 0.5, height * 0.46, radius * 0.08, width * 0.5, height * 0.46, radius);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(0.64, `rgba(2, 8, 7, ${energy * 0.04})`);
  gradient.addColorStop(1, `rgba(0, 0, 0, ${energy * 0.34})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function renderJourney(context, images, width, height, progress, reducedMotion) {
  if (reducedMotion) {
    drawCover(context, images[0], width, height, 1, JOURNEY_FRAMES[0].focal, 1, [0, 0]);
    return { frameIndex: 0, blend: 0, energy: 0 };
  }

  const phase = clamp(progress / JOURNEY_END);
  const approach = Math.pow(smoothstep(0, 1, phase), 1.6);
  const passThrough = smoothstep(0.78, 1, phase);
  const currentScale = 1 + 3.2 * approach;
  const currentOffset = [0, 0];

  drawCover(
    context,
    images[0],
    width,
    height,
    currentScale,
    JOURNEY_FRAMES[0].focal,
    1,
    currentOffset,
    passThrough * 0.7,
  );
  drawTransitionVignette(context, width, height, passThrough);
  if (passThrough > 0) {
    context.fillStyle = `rgba(1, 6, 5, ${passThrough * 0.18})`;
    context.fillRect(0, 0, width, height);
  }
  return { frameIndex: 0, blend: 0, energy: passThrough };
}

export function CinematicJourneyCanvas({ progress, reducedMotion }) {
  const canvasRef = useRef(null);
  const progressRef = useRef(progress);
  const reducedMotionRef = useRef(reducedMotion);
  const requestDrawRef = useRef(null);

  useEffect(() => {
    progressRef.current = progress;
    reducedMotionRef.current = reducedMotion;
    requestDrawRef.current?.();
  }, [progress, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) return undefined;

    let animationFrame = 0;
    let ready = false;
    let width = 1;
    let height = 1;
    let pixelRatio = 1;
    let images = [];

    function draw() {
      animationFrame = 0;
      if (!ready) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#0c1513";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const state = renderJourney(context, images, width, height, progressRef.current, reducedMotionRef.current);
      canvas.dataset.frame = String(state.frameIndex);
      canvas.dataset.blend = state.blend.toFixed(3);
      canvas.dataset.energy = state.energy.toFixed(3);
    }

    function requestDraw() {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(draw);
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      requestDraw();
    }

    requestDrawRef.current = requestDraw;
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    Promise.all(JOURNEY_FRAMES.map(({ src }) => new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    }))).then((loadedImages) => {
      images = loadedImages;
      ready = true;
      canvas.dataset.ready = "true";
      requestDraw();
    }).catch(() => {
      canvas.dataset.ready = "error";
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      requestDrawRef.current = null;
    };
  }, []);

  return (
    <>
      <img className="cinematic-fallback" src={JOURNEY_FRAMES[0].src} alt="" />
      <canvas className="cinematic-canvas" ref={canvasRef} aria-hidden="true" />
    </>
  );
}
