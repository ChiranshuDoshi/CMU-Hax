import { useEffect, useRef } from "react";

const AMPLITUDES = [
  0.32, 0.58, 0.84, 0.46, 0.72, 0.94, 0.54, 0.38, 0.78, 0.66, 0.4, 0.88, 0.58, 0.32,
  0.7, 0.96, 0.62, 0.44, 0.82, 0.52, 0.34, 0.74, 0.9, 0.46, 0.68, 0.38, 0.8, 0.56,
  0.94, 0.6, 0.42, 0.72, 0.5, 0.86, 0.64, 0.36, 0.76, 0.92, 0.54, 0.4, 0.7, 0.48,
  0.84, 0.58, 0.34, 0.78, 0.62, 0.9, 0.44, 0.72, 0.52, 0.82, 0.36, 0.68, 0.94, 0.56,
  0.4, 0.76, 0.6, 0.86, 0.48, 0.72, 0.38, 0.64,
];

export function Waveform({
  active = false,
  progress = 0.62,
  compact = false,
  playedColor = "#71e0c1",
  unplayedColor = "rgba(213, 226, 221, 0.28)",
  label = "Negotiation audio waveform",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    let frameId = 0;
    let startedAt = performance.now();

    function draw(now = startedAt) {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, width, height);
      const gap = compact ? 3.2 * pixelRatio : 4 * pixelRatio;
      const barWidth = Math.max(1.5 * pixelRatio, (width - gap * (AMPLITUDES.length - 1)) / AMPLITUDES.length);
      const elapsed = (now - startedAt) / 800;

      AMPLITUDES.forEach((base, index) => {
        const pulse = active ? 0.08 * Math.sin(elapsed * 3 + index * 0.62) : 0;
        const amplitude = Math.max(0.16, Math.min(1, base + pulse));
        const barHeight = amplitude * height * 0.84;
        const x = index * (barWidth + gap);
        const y = (height - barHeight) / 2;
        const played = index / (AMPLITUDES.length - 1) <= progress;
        context.fillStyle = played ? playedColor : unplayedColor;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      });

      if (active) frameId = window.requestAnimationFrame(draw);
    }

    draw();
    return () => window.cancelAnimationFrame(frameId);
  }, [active, compact, playedColor, progress, unplayedColor]);

  return <canvas className={compact ? "waveform waveform--compact" : "waveform"} ref={canvasRef} role="img" aria-label={label} />;
}
