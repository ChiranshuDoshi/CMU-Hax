# PolicyScout Design QA

## Scope

- Target: desktop Web prototype on branch `person1-UI`.
- References: Mercury's live hero-to-dashboard scroll sequence and `design-previews/policyscout-cinematic-showcase.png`.
- Runtime: `http://127.0.0.1:4176/` at the in-app desktop viewport (`1280x720`, with a constrained desktop-width pass).
- Comparison sheet: `frontend/qa/design-comparison.jpg`.

## Visual Comparison

- Typography: Manrope display type and IBM Plex Sans interface type preserve the reference's premium editorial-to-product transition.
- Layout: the implementation now uses three continuous spatial beats: medium rear follow, cabin-to-screen push, and screen-to-viewport expansion. The distant opening and repeated seat beats were removed.
- Color: the vehicle scene expands into a dark ink-and-mint result command center, then the interface itself morphs to the dashboard's light theme during the final scroll range.
- Assets: runtime cinematic motion uses only `rear-follow-medium.webp` and `between-front-seats.webp`. Each segment moves by continuous transform, and the single source change is hidden inside a short dark rear-window handoff.
- Product content: the expanded screen resolves into the working quote and negotiation product rather than a static marketing mock.

Evidence:

- `frontend/qa/mercury-reference.png`
- `frontend/qa/mercury-dashboard-reference.png`
- `frontend/qa/zoom-sequence-contact.jpg`
- `frontend/qa/journey-sequence-contact.jpg`
- `frontend/qa/canvas-cockpit-arrival.jpg`
- `frontend/qa/canvas-demo-handoff.jpg`
- `frontend/qa/mercury-live/hero-transition-contact.jpg`
- `frontend/qa/policyscout-spatial-reveal-mid.png`
- `frontend/qa/infotainment-alignment-comparison.jpg`
- `frontend/qa/design-comparison.jpg`
- `frontend/qa/theme-handoff-mid.png`
- `frontend/qa/theme-handoff-boundary.png`
- `frontend/qa/theme-handoff-demo-reveal.png`
- `frontend/qa/theme-handoff-comparison.jpg`
- `frontend/qa/theme-handoff-compact-final.png`
- `frontend/qa/theme-handoff-gap-fix-comparison.jpg`
- `frontend/qa/theme-morph-01-dark.png`
- `frontend/qa/theme-morph-02-contrast-dark.png`
- `frontend/qa/theme-morph-contrast-switch.png`
- `frontend/qa/theme-morph-03-contrast-light.png`
- `frontend/qa/theme-morph-04-white.png`
- `frontend/qa/mercury-theme-morph-comparison.jpg`

## Interaction Verification

- Login modal opens, contains populated demo credentials, and enters the workspace.
- Vehicle profile submits and starts five sequential insurer calls.
- All five calls progress through queued, calling, and verified states.
- Quote comparison shows five normalized rows, a separate PolicyScout recommendation, user selection, and a private `$1,450` target.
- Negotiation progresses from `$1,684` to `$1,546`, `$1,472`, and `$1,428` before resolving automatically.
- Final result shows `$256` and `15.2%` savings, target achieved, and four unchanged coverage rows.
- Full negotiation audio play/pause works through browser speech synthesis.
- Three timestamped Good negotiation replay clips select independently and move the audio playhead.
- The runtime contains zero video elements and no frame-index/image-sequence switching; sampled scroll coverage had no blank frame.
- Exterior and cabin segments each preserve a monotonic center-axis push because every segment holds one raster source.
- The rear-window handoff reaches a dark threshold before the cabin source appears, preventing double-car and double-seat exposure.
- The same dark result DOM is visible in the physical screen, at the mid-scale state, and at full viewport size; reverse scroll returns through the same transforms.
- The final 18% of cinematic progress continuously interpolates the result background and panel surfaces from dark ink to the dashboard's `#f3f5f6` and white surfaces. Text switches from light to dark at the midpoint so the transition stays readable before the light dashboard enters.
- Desktop horizontal overflow: `0px`.
- The demo jump lands at `demoTop: 0`; the vehicle WebP loads at `1448x1086` and no image reports a failed intrinsic size.

## Issues Fixed During QA

- P2: scroll progress lag left copy from the previous scene visible. Replaced the long sticky sequence's derived scroll state with deterministic section progress.
- P2: the call-to-result crossfade paused in a washed gray state. Tightened the overlap so the infotainment display lights directly into the result.
- P2: short demo states used `100svh`, allowing 52px of the previous cockpit scene to reappear. Locked the desktop app to `100vh`; all five steps now remain aligned at `demoTop: 0`.
- P2: the first rear-glass and front-seat crossfades held both scenes too long, creating visible double exposure. Compressed both threshold transitions and increased cabin scale so the seats leave the frame before the dashboard locks.
- P2: five distant keyframes still read as image switching during slow scroll. Added five centerline intermediate frames, shortened each crossfade, and kept adjacent opacity sums at `1.0` so the camera path reads as one push.
- P2: adding frames would have pushed the raster payload above the previous media budget. Converted every runtime image to WebP; the eleven loaded product and cinematic assets now total about `1.0MB` on disk.
- P2: even the denser image stack still exposed frame changes because adjacent source framing differed. Replaced stacked image opacity with one Canvas camera, matched outgoing zoom to incoming subject scale, removed reverse zoom on entry, and hid source changes inside a radial speed burst.
- P2: the first rear-glass reveal looked like a hard rectangular screen. Expanded the portal from the full rear-window opening, added a feathered edge layer, and accelerated the final expansion through the cabin.
- P2: independently generated far-car and seat intermediates still changed vehicle geometry and created visible jumps. Removed them from the runtime path and shortened the stage from `380vh` to `260vh`.
- P2: a scrubbed cabin video reduced source changes but introduced seek lag and too many interior beats. Replaced it with one cabin raster and a direct transform toward the center display.
- P2: the light result dashboard looked like a floating overlay during expansion. Reused one dark result DOM from the physical infotainment bounds through the full viewport, with continuous X/Y scale and clip-path interpolation.
- P2: the result UI initially appeared only near the end of the cabin push and used fixed bounds, so it drifted away from the physical screen during zoom. Measured the source display's inner pixel bounds, projected them through the same `object-fit: cover` and cabin scale math, and used the resulting live rectangle for clip, translation, and X/Y scale. The small result is now visible on cabin entry and remains flush with all four display edges.
- P2: the exterior close-up centered on the tailgate, making the straight push feel too low. Moved the Canvas focal height from `55%` to `46%` so the rear window remains the camera target as the vehicle fills the viewport.
- P2: gradient overlays fixed the hard boundary but created an artificial washed-out gap above the dashboard. Removed the overlay entirely and made the result UI itself transition from dark to light; the final result and incoming dashboard now share the same background, text, surface, border, accent, and waveform palette.

## Residual P3 Notes

- Provider calls and quotes are intentionally simulated for the hackathon demo.
- Audio uses local browser speech synthesis; production should replace it with recorded or streamed ElevenLabs audio.
- This showcase is intentionally desktop-only for the current review; a mobile cinematic treatment is out of scope by request.
- A reduced-motion CSS path is implemented; the current desktop browser runtime did not expose media emulation for an automated screenshot.
- Fresh-load console output on port `4176` contained only Vite connection and React DevTools informational messages; no warnings or errors.
- `npm run build`: passed with 4,979 modules transformed.

final result: passed

## Dashboard Operations Redesign QA

### Scope and References

- Dashboard-only redesign; `CinematicShowcase` was intentionally left unchanged.
- Before-state flow: `frontend/qa/dashboard-audit/`.
- Final flow: `frontend/qa/dashboard-final/`.
- Combined reference and implementation review: `frontend/qa/dashboard-final/reference-comparison.png`.
- Captured references: Stripe Dashboard documentation, Mercury, Linear, Lemonade, Mobbin, and Page Flows.

### Visual Review

- Replaced the pale mint app canvas and repeated rounded cards with a white/ink operations shell, quiet gray sidebar, and restrained teal accent.
- Profile now reads as an agent-ready insurance call sheet with field provenance and disclosure rules; the vehicle image is part of a compact dossier rather than a decorative card.
- One global `Profile verified` state replaces repeated security and verification badges.
- Research and quote states use dense row-based ledgers with rating evidence, eligibility, quote evidence, loading skeletons, and explicit workflow locks.
- The dark surface is reserved for the live negotiation and call evidence panels, giving it a functional role rather than treating the whole UI as an AI theme.
- Final result preserves original and negotiated quote, savings, target achieved, unchanged coverage, synchronized audio/transcript, and timestamped replay clips.

### Interaction and Accessibility Verification

- Completed the full `Profile -> Top 5 Research -> Quotes -> Negotiation -> Evidence & calls` journey in the in-app browser.
- Evidence index opens; selecting a different quote updates the private target panel; HarborShield selection can be restored.
- Audio play/pause and a timestamped replay clip were exercised successfully.
- Async call and negotiation regions expose polite live announcements.
- Vehicle type controls expose `aria-pressed`; form inputs have names and appropriate autocomplete metadata.
- Progress animation uses `transform: scaleX()` and reduced-motion CSS disables dashboard transitions.
- Browser console warnings/errors: none.
- Desktop layout: `scrollWidth 1280`, `clientWidth 1280`; no horizontal overflow.
- `npm run build`: passed.
- No lint script exists in the current package.
- Browser comment follow-up: rebuilt the concession trail as one four-segment ledger with separate round/time metadata, larger price hierarchy, multiline concession labels, dedicated annual impact rows, and a bottom connector rail. The refined state is recorded in `frontend/qa/dashboard-final/07-concession-trail-refined.png` and remains overflow-free at the more constrained `1280x720` QA viewport.

final dashboard result: passed

## Voice Guardrail Brand Mark QA

### Scope

- Source visual truth: `/Users/jj/.codex/generated_images/019f76bc-c8ff-7ea0-90ce-71ccd24958fc/exec-7072e674-6ecd-4f3d-9544-5f78cda91b5a.png`.
- Implementation screenshots: `/private/tmp/policyscout-brand-implementation-v2.png` and `/private/tmp/policyscout-brand-dashboard-v3.png`.
- Viewport: `1272x745`.
- States: dark cinematic hero and light profile dashboard.
- Full comparison: `/private/tmp/policyscout-brand-full-compare-v2.png`.
- Focused comparison: `/private/tmp/policyscout-brand-focused-compare-v2.png`.

### Findings

- No actionable P0, P1, or P2 issue remains.
- Typography: the existing Manrope wordmark is unchanged; the optical baseline and gap are balanced at both sizes.
- Spacing and layout: the mark uses stable `40px` hero and `32px` dashboard dimensions.
- Colors: mint on dark and deep teal on light preserve contrast while using one shared silhouette.
- Asset fidelity: a generated alpha asset is delivered as a lossless WebP CSS mask; there is no handcrafted SVG or CSS drawing, visible halo, or background box.
- Meaning: the detailed master retains the protected central road plus active voice-wave guardrails at small sizes.
- Copy: `PolicyScout` and `Insurance operations` remain unchanged.
- Interactions: `Skip to demo` was exercised successfully and the browser reported no console errors.

### Comparison History

- P2: the first simplified master read as Wi-Fi or broadcast waves and lost the negotiation guardrail character.
- Fix: switched to the detailed generated master, increased the hero mark from `36px` to `40px`, increased the dashboard mark from `30px` to `32px`, and used a `145%` mask scale.
- Post-fix evidence: `/private/tmp/policyscout-brand-focused-compare-v2.png`.

### Residual P3

- The generated master is optically simplified from the concept image so its road and voice details stay legible at `32-40px`.

final result: passed
