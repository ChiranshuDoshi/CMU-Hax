==================================================
FOUR-PERSON TEAM SPLIT
==================================================

The team is building one end-to-end insurance-shopping flow:

1. The user signs in and completes a quote-ready insurance profile.
2. Market research ranks eligible insurers and selects the Top 5.
3. The Calling Agent requests a coverage-matched quote from all five.
4. The dashboard normalizes and compares the five results.
5. The user selects one quote and enters a target price or acceptable range.
6. The Negotiator calls the selected provider and asks for a legitimate improvement.
7. The dashboard shows the verified before-and-after result and recommendation.

All four engineers must agree on these shared contracts before parallel development:

- InsuranceProfile.
- ConfirmedQuoteRequest.
- ProviderResearchBrief.
- ProviderRankingResult.
- NormalizedQuote.
- NegotiationGoal.
- NegotiationEvent.
- Workflow states and API error format.

Do not silently modify shared contracts after the first integration checkpoint.

--------------------------------------------------
PERSON 1: FRONTEND, PRODUCT FLOW, AND DEMO EXPERIENCE
--------------------------------------------------

Own:

- Next.js pages and navigation.
- Complete sign-up, login, logout, and session-recovery UI.
- Profile onboarding wizard.
- Profile-completeness indicators and validation feedback.
- Workflow stepper.
- Research progress and Top 5 provider cards.
- Five-provider call-status dashboard.
- Live transcript and structured-outcome UI.
- Side-by-side normalized quote comparison.
- Recommended-quote highlighting without auto-selecting it for negotiation.
- User-controlled quote selection.
- Target price or acceptable-range form.
- Negotiation confirmation and progress UI.
- Before-and-after negotiation result.
- EvidenceLink components.
- Final recommendation and report.
- Responsive design and accessibility.
- Loading, error, empty, partial-result, and retry states.
- Playwright demo flow.
- Five-minute demo presentation.

Primary directories:

- src/app
- src/components
- tests/e2e
- docs/demo-script.md

Required deliverables:

- Complete user-facing workflow from account creation through negotiated result.
- Profile setup that clearly explains why each pricing field is needed.
- Top 5 research view with rating, review count, source, and eligibility evidence.
- Quote dashboard with one explicit selection control per comparable quote.
- Negotiation-goal form with target, range, and disclosure settings.
- Mock API integration first, then typed real API integration.
- Clear simulated-provider labels.
- Live call status and transcript evidence.
- A repeatable five-minute demo.

Boundary:

- Person 1 does not define insurance eligibility rules, provider scoring, quote math, or negotiation strategy.

--------------------------------------------------
PERSON 2: AUTH, PROFILE DATA, DATABASE, AND SECURITY
--------------------------------------------------

Own:

- Supabase Auth.
- Sign-up, login, logout, magic-link, and demo-account backend flows.
- User and household profile persistence.
- InsuranceProfile and ConfirmedQuoteRequest schemas.
- Insurance-line-specific profile-field configuration.
- Profile merge, completeness, validation, confirmation, and versioning.
- Optional declaration-page upload and extraction.
- Database migrations.
- RLS on every user-owned table.
- Private Storage and signed URLs.
- PrivateNegotiationConstraints and NegotiationGoal persistence.
- Target-range encryption and disclosure policy.
- Canonical serialization and specification hashing.
- Workflow state machine.
- Audit logging.
- Data export and deletion.
- Environment validation.

Primary directories:

- supabase
- src/domain/schemas
- src/domain/hashing
- src/domain/privacy
- src/domain/state-machine
- src/integrations/openai
- src/integrations/supabase
- auth APIs
- profile APIs
- confirmation APIs
- docs/security.md

Required deliverables:

- Shared domain contracts published first.
- Migrations, RLS policies, and seed data.
- Quote-ready profile endpoint with explicit missing fields.
- Stable confirmed-request hash reused across all five first-round calls.
- Secure target-range storage.
- A provider-safe allowlist that excludes unnecessary sensitive data.
- Tests proving users cannot access another user’s profile or workflow.
- Tests proving the user’s ceiling is not disclosed unless explicitly authorized.

Boundary:

- Person 2 does not choose the Top 5, rank quotes, or control conversation behavior.

--------------------------------------------------
PERSON 3: ELEVENLABS, CALLING AGENT, AND NEGOTIATOR
--------------------------------------------------

Own:

- ElevenLabs browser SDK.
- Signed conversation URL or token route.
- Intake Agent configuration for voice-assisted profile gap filling.
- Calling Agent configuration.
- Negotiator Agent configuration.
- Five simulated Provider Agent configurations.
- ConversationOrchestrator.
- Local agent-to-agent bridge.
- Client and server tools.
- First-round call fan-out and status tracking.
- Transcript persistence.
- Conversation states and structured outcomes.
- Mock conversation adapter.
- Provider-private pricing and concession rules.
- Interruption, refusal, incomplete-quote, and retry handling.
- Golden conversation fixtures and agent evaluation.

Primary directories:

- src/integrations/elevenlabs
- src/server/services/conversations
- src/demo/providers
- conversation APIs
- agent-tool APIs
- docs/agent-prompts.md
- conversation integration tests

Required deliverables:

- Intake Agent captures only missing or conflicting profile fields through validated tools.
- Calling Agent uses the same confirmed profile and specification hash for all five providers.
- Five completed first-round outcomes: quote, callback commitment, documented decline, or failure.
- At least three meaningfully different provider behaviors across the five agents.
- Structured quote-field capture from every conversation.
- Negotiator calls only the provider selected by the user.
- Negotiator follows the confirmed NegotiationGoal and truthful verified leverage.
- One measurable, rules-driven price or term concession.
- No Twilio and no real outbound calls in the hackathon demo.
- No provider access to private constraints or other providers’ private rules.

Boundary:

- Person 3 does not select the Top 5, choose the user’s target quote, invent leverage, or calculate the final ranking.

--------------------------------------------------
PERSON 4: MARKET RESEARCH, QUOTE INTELLIGENCE, AND RANKING
--------------------------------------------------

Own:

- Tavily adapter and deterministic mock research.
- Optional Google Places adapter.
- ProviderResearchBrief.
- Provider eligibility filters.
- Rating and review-source normalization.
- Deterministic Top 5 ranking.
- InsuranceLineConfig files.
- QuoteNormalizer.
- CoverageEquivalenceEngine.
- RedFlagEngine.
- Evidence reconciliation.
- Recommended-quote calculation.
- VerifiedLeverageSelector.
- Negotiation-goal validation.
- Negotiation-event validation.
- Final ranking and recommendation engine.
- Explanation templates and evaluation calculations.

Primary directories:

- src/config/insurance-lines
- src/integrations/tavily
- src/integrations/places
- src/domain/research
- src/domain/normalization
- src/domain/equivalence
- src/domain/scoring
- src/domain/evidence
- research APIs
- quote APIs
- negotiation APIs
- recommendation APIs

Required deliverables:

- Cited research for every shortlisted provider.
- Exactly five ranked eligible providers when five are available.
- Ranking led by normalized rating, with review count, source quality, recency, availability, and coverage fit as safeguards or tie-breakers.
- A visible explanation for why each company made the Top 5.
- Deterministic quote math and coverage-equivalence rules.
- Red flags for incomplete or non-comparable quotes.
- A system recommendation that remains separate from the user’s selection.
- Verified competing leverage from the same specification hash.
- Ranked post-negotiation recommendation.
- Tests proving ratings are source-backed and web prices are never treated as user quotes.

Boundary:

- Person 4 does not manage authentication, voice infrastructure, or override the user’s selected negotiation target.

==================================================
INTEGRATION CHECKPOINTS
==================================================

Checkpoint 1: shared contracts and mock JSON fixtures.

Checkpoint 2: login -> profile -> Top 5 research -> five mock quotes -> dashboard.

Checkpoint 3: user selection -> target range -> one negotiation -> before/after result.

Checkpoint 4: live ElevenLabs integration, full Playwright run, and demo freeze.
