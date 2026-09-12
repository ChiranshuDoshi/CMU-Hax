# PolicyScout Frontend PRD

## Feature

`Road to Result`: a public cinematic showcase that transitions from a scenic vehicle journey into an interactive PolicyScout insurance-negotiation demo.

## Problem

The product dashboard explains the result but does not create a memorable first impression or demonstrate the complete workflow. The showcase must earn attention, explain the agent's role, and then let a visitor experience the core flow without creating an account.

## User Outcome

A first-time visitor understands within one short scroll journey that PolicyScout:

1. collects a vehicle profile,
2. calls five matched insurers,
3. normalizes their quotes,
4. negotiates the selected offer,
5. proves the final savings without changing coverage.

## Scope

- Scroll-pinned cinematic sequence: a damped straight-rear camera push, one obscured rear-window handoff, one continuous cabin push, then a full-viewport dashboard reveal.
- Persistent `Try live demo`, `Log in`, and `Skip intro` controls.
- Interactive three-stage demo: vehicle input, five simulated calls, negotiated result.
- Final evidence: original and final prices, savings, target status, unchanged coverage, audio waveform, transcript excerpt, and replay clips.
- Desktop Web behavior; a dedicated phone treatment is out of scope for this iteration.
- Reduced-motion path.
- Loading, active, success, and restart states for the demo.

## Out Of Scope

- Real authentication, user accounts, persistence, or backend APIs.
- Real outbound insurer calls.
- Real quote eligibility or insurance advice.
- Production 3D vehicle configurator.
- Redesigning the authenticated dashboard beyond the demo surface.

## Primary Journey

1. User lands on a scenic straight-rear driving shot with the vehicle moving away along the mountain road.
2. Scroll closes the following distance without orbiting to either side.
3. Camera zooms into the rear windshield, passes through the rear and front seats, and arrives between the front seats.
4. Camera aligns to the center infotainment display; the real PolicyScout dashboard expands from the physical display bounds until it owns the viewport, without an inset mock screen.
5. User confirms demo vehicle information and starts the quote search.
6. Five simulated insurer rows progress from queued to verified.
7. User selects the recommended quote and starts negotiation.
8. Final result reveals `$1,684 -> $1,428`, `$256 / 15.2%` savings, target achieved, and unchanged coverage.
9. User can play the full call or jump to a highlighted negotiation replay.

## Acceptance Criteria

- Scroll progress visibly controls every cinematic stage; the sequence does not autoplay independently.
- The exterior follow, rear windshield, cabin pass-through, cockpit, and product reveal read as one continuous forward camera move without a visible slideshow cadence.
- Adjacent cinematic anchors preserve the vehicle centerline, camera height, lighting, and subject scale progression, while spatial zoom hides the anchor change at peak camera velocity.
- Each camera segment uses one stable raster source plus continuous transform; the independently generated far-car and seat-by-seat frames are not part of the runtime path.
- The only exterior-to-interior source change is hidden inside a short dark rear-window handoff, preventing double-car or double-seat ghosting.
- The exact same dark result interface is already visible when the cabin appears, stays aligned to all four physical infotainment edges during the cabin zoom, and then scales edge-to-edge without a white overlay, floating card, or second UI switch.
- Scroll-wheel deltas are lightly damped so the camera continues smoothly instead of jumping directly between sampled progress values.
- The user can skip directly to the demo at any time.
- The demo can be completed from start to result without a backend.
- System recommendation and user selection use separate labels.
- Final evidence is visible without leaving the result view.
- At the desktop review viewports, no horizontal overflow, clipped primary action, or overlapping copy exists.
- Under `prefers-reduced-motion`, the cinematic camera push is removed and direct demo access remains available.
- Keyboard focus is visible and all core controls are reachable.
- Browser console has no errors during the primary journey.

## Disclosure

All providers and calls in the prototype are simulated for demonstration. PolicyScout must not imply that a visitor should operate the product while driving.

## Dashboard Demo Redesign

### Problem

The authenticated demo currently communicates the workflow, but repeated mint verification pills, large rounded containers, and a generic vehicle form make it read like an AI template. The dashboard needs to feel like a serious insurance operations product where every input, quote, and outcome can be traced to evidence.

### Scope

- Redesign only the `ProductDemo` dashboard; keep the cinematic showcase unchanged.
- Present the profile as an agent-ready call sheet with a compact vehicle dossier.
- Expose field provenance: `User confirmed`, `Declaration page`, `Agent required`, and `Hidden from first-round calls`.
- Use one global verification state instead of repeating security badges.
- Make research, quote comparison, negotiation, and evidence states dense and operational.
- Preserve the complete five-step demo and all final audio, transcript, and replay evidence.

### Acceptance Criteria

- The interface uses white/ink surfaces with teal reserved for active actions and verified outcomes.
- The sidebar distinguishes current, complete, ready, and locked steps without implying unavailable steps are clickable.
- Profile data is scannable as a call sheet and each material field exposes its source or disclosure rule.
- Research and quotes show loading/pending states without blank placeholders.
- System recommendation and user selection remain separate concepts.
- Final result includes original quote, negotiated quote, savings, target status, unchanged coverage, audio, transcript, and replay clips.
- Core controls have visible keyboard focus; form fields expose labels, names, and relevant autocomplete metadata.
- Async status changes are announced through an `aria-live` region and reduced-motion preferences are respected.
- The complete demo runs without console errors or horizontal overflow at the desktop preview viewport.
