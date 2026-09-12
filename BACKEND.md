# PolicyScout — Backend Foundation (Person 2)

This is the shared foundation everyone codes against. **Contracts + fixtures are
frozen enough to build on now.** If a contract must change, bump it and tell the
team — don't silently edit shared shapes.

## Install & verify

```bash
npm install        # (team standard is pnpm; scripts are identical)
npm run typecheck  # tsc --noEmit
npm test           # 30 unit tests, all green
```

## What's here

| Area | Path | Use it for |
|---|---|---|
| **Shared contracts** (Zod + types) | `src/domain/schemas` | Every object crossing a service/API boundary |
| **Spec hashing** | `src/domain/hashing` | `computeSpecificationHash(req)` — same hash for all 5 calls |
| **Privacy boundary** | `src/domain/privacy` | `applyDisclosurePolicy(goal)`, `assertProviderSafe(payload)` |
| **Workflow state machine** | `src/domain/state-machine` | `assertTransition(from, to)`, `nextStates(state)` |
| **Profile completeness** | `src/domain/profile` | `computeCompleteness(profile, rules)` — the quote-ready gate |
| **Env + capabilities** | `src/config/env` | `getEnv()`, `capabilities()` — mock vs live |
| **Demo fixtures** | `src/demo/fixtures` | Build against these before the DB/live services exist |
| **DB schema** | `supabase/migrations/0001_init.sql` | Tables (RLS skipped for hackathon) |

## How each person consumes this

```ts
import {
  InsuranceProfileSchema, NormalizedQuoteSchema, ConfirmedQuoteRequestSchema,
  apiOk, apiError,
} from "@/domain/schemas";
import {
  demoQuotes, demoRankingResult, demoConfirmedRequest, demoNegotiationGoal,
} from "@/demo/fixtures";
```

- **Person 1 (frontend):** render `demoRankingResult` (Top 5) and `demoQuotes`
  (dashboard). `demoRecommendedQuoteId` is the *system* pick — keep it visually
  separate from the user's selection. Parse all API responses with the
  `ApiError` / `apiOk` envelope.
- **Person 3 (agents):** every provider call reuses
  `demoConfirmedRequest.specificationHash`. Emit `NormalizedQuote`s and
  `NegotiationEvent`s. Before sending anything to a provider agent, call
  `assertProviderSafe(payload)`.
- **Person 4 (research/ranking):** produce `ProviderRankingResult` and
  `NormalizedQuote`; derive personal-auto required fields from
  `src/domain/profile/personal-auto-required-fields.ts` into your
  `InsuranceLineConfig`.

## Guarantees under test (`npm test`)

- Spec hash is deterministic & order-independent; all 5 quotes share one hash.
- Disclosure policy never leaks the ceiling (`do_not_reveal_ceiling` default).
- `ConfirmedQuoteRequest` passes the provider-safe scan.
- Invalid workflow transitions are rejected.
- The complete demo profile is quote-ready; missing fields block it.
- Env boots in fully-mocked mode with zero credentials.

## Deliberately deferred (hackathon scope)

No encryption-at-rest, RLS, audit log, rate limiting, SSRF, or data-export/delete.
Private constraints are stored as plain JSON in their own table so the
provider-safe *boundary* still holds. Add hardening later if there's time.
