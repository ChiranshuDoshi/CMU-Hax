import { useEffect, useRef, useState } from "react";

const SCRUB_VIDEO = "/assets/cabin-to-dashboard-scrub.mp4";

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function CinematicCabinVideo({ progress, reducedMotion, style }) {
  const videoRef = useRef(null);
  const progressRef = useRef(progress);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    progressRef.current = progress;
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;

    const targetTime = reducedMotion ? 0 : clamp(progress) * Math.max(0, video.duration - 0.02);
    if (Math.abs(video.currentTime - targetTime) > 1 / 90) {
      video.currentTime = targetTime;
    }
  }, [progress, reducedMotion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    function handleReady() {
      setReady(true);
      const targetTime = reducedMotion ? 0 : clamp(progressRef.current) * Math.max(0, video.duration - 0.02);
      video.currentTime = targetTime;
    }

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.load();

    return () => {
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("canplay", handleReady);
    };
  }, [reducedMotion]);

  return (
    <video
      ref={videoRef}
      className="cinematic-video"
      data-ready={ready ? "true" : "false"}
      data-progress={clamp(progress).toFixed(3)}
      src={SCRUB_VIDEO}
      poster="/assets/rear-window-threshold.webp"
      preload="auto"
      muted
      playsInline
      aria-hidden="true"
      style={style}
    />
  );
}
