"use client";

import dynamic from "next/dynamic";

// The cinematic showcase + dashboard are entirely browser-driven (motion, canvas,
// scroll, speechSynthesis), so we load them client-only — mirroring the original
// Vite entry and avoiding SSR of browser-only APIs.
const App = dynamic(() => import("../components/showcase/App.jsx").then((mod) => mod.App), {
  ssr: false,
});

export function ClientApp() {
  return <App />;
}
