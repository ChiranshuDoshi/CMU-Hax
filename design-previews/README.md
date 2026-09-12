# PolicyScout UI Direction Review

This folder contains disposable, standalone interaction prototypes for selecting the Person 1 visual direction before the production Next.js frontend is created.

## Scope

Each concept focuses on the final negotiation result screen and must make these facts understandable without opening another page:

- Original quote: `$1,684/year`.
- Negotiated result: `$1,428/year`.
- Verified savings: `$256/year` or `15.2%`.
- User target: `$1,450/year`, achieved.
- Coverage remained unchanged.
- The provider is simulated for the hackathon demo.
- The full negotiation can be replayed.
- Three high-quality negotiation moments can be replayed independently.
- Every highlighted tactic is connected to a transcript timestamp and a verified concession.

## Concepts

- **A - Evidence Command Center:** trust, proof, and scanability.
- **B - Negotiation Studio:** voice, transcript, and replay experience.
- **C - Outcome Ledger:** before-to-after story and demo impact.

## Selected Product Direction

- **Hybrid Dashboard:** light evidence-first result workspace with a dark voice and replay panel. See `POLICYSCOUT_HYBRID_DIRECTION.md`.
- **Road to Result Showcase:** a separate public cinematic route that moves from a scenic vehicle environment into the infotainment display, then expands into a three-stage PolicyScout demo. See `POLICYSCOUT_CINEMATIC_SHOWCASE.md` and `policyscout-cinematic-showcase.png`.

## Selection Criteria

1. The final price and savings are understood within three seconds.
2. The screen feels credible enough for insurance decisions.
3. Replay controls explain how the outcome was achieved, not just that it happened.
4. Evidence, disclosure, and unchanged-coverage status are easy to verify.
5. The information hierarchy survives a mobile viewport.
6. The direction can map cleanly to shadcn components without losing its identity.

## Production Mapping

The selected direction will be rebuilt with Next.js, Tailwind CSS, and shadcn primitives such as `Button`, `Badge`, `Tabs`, `Table`, `Separator`, `ScrollArea`, `Tooltip`, and `Dialog`. The prototypes intentionally use plain HTML, CSS, and JavaScript so the team can choose a design without committing to application structure.
