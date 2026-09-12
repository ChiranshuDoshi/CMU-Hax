# PolicyScout Dashboard Design Audit

## Evidence Captured

- Profile: `frontend/qa/dashboard-audit/01-profile.png`
- Research active: `frontend/qa/dashboard-audit/02-research-active.png`
- Research complete: `frontend/qa/dashboard-audit/03-research-complete.png`
- Quotes: `frontend/qa/dashboard-audit/04-quotes.png`
- Negotiation: `frontend/qa/dashboard-audit/05-negotiation.png`
- Final result: `frontend/qa/dashboard-audit/06-result.png`

References were captured from Stripe Dashboard documentation, Mercury, Linear, Lemonade, Mobbin, and a Monarch Money onboarding flow on Page Flows in `frontend/qa/dashboard-references/`.

## What Already Works

- The five-step workflow is understandable and preserves user control.
- System recommendation and user selection are separate.
- The result contains the right proof artifacts: price movement, unchanged coverage, audio, transcript, and replay clips.
- Verified, pending, calling, and review states already exist in the product language.

## Priority Findings

### P1 - The profile is not an agent-ready call sheet

The profile screen is a generic six-field form beside a large vehicle image. It does not show who supplied each fact, what the agent still needs, or which facts are deliberately withheld from first-round calls. That makes the most important trust boundary invisible.

### P1 - Verification is repeated until it becomes decoration

`Secure demo session`, `Secure & private`, `Identity verified`, `Coverage confirmed`, and repeated mint `Verified` pills compete for attention. A single global verification state plus local evidence provenance would be more credible.

### P1 - Later steps lack useful unavailable states

Future workflow labels appear like destinations but do not explain whether they are ready, pending, or locked. Research placeholders are em dashes rather than informative loading or pending states.

### P2 - Card repetition flattens hierarchy

Nearly every section has the same border, radius, and white container. Functional tables, decision panels, and proof surfaces all receive equal visual weight, producing a template-like dashboard rather than an operations workspace.

### P2 - Evidence provenance is mostly prose

The interface says ratings and calls are sourced, but quote rows and profile facts do not expose direct source labels. Users cannot quickly distinguish declaration-page facts, user confirmations, agent-required fields, and private negotiation inputs.

### P2 - Small type and low-contrast metadata reduce scan quality

Several labels and status captions render at 8-9px with muted gray or mint contrast. Dense SaaS UI can be compact without making critical evidence metadata difficult to read.

### P2 - Interaction semantics need hardening

Profile inputs need `name` and autocomplete metadata, segmented choices need `aria-pressed`, async status changes need an `aria-live` region, and progress animation should avoid layout-changing width transitions.

## Accessibility Limits

Screenshots verify visible hierarchy, contrast risks, and target sizing, but they cannot prove screen-reader announcements or keyboard order. Those behaviors must be verified in the implementation and browser DOM.

## Design Direction

Use an `Insurance Operations Ledger` direction: a quiet grayscale shell, one teal accent, one global verification status, source-aware call-sheet rows, dense market and quote tables, and a single dark voice command panel. This combines Stripe-style operational hierarchy, Linear-style workflow density, Lemonade-style progressive intake, and finance-onboarding provenance patterns without copying their marketing surfaces.
