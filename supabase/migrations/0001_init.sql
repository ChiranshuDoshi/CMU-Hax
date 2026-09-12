-- PolicyScout initial schema (Person 2). Spec §11.
--
-- HACKATHON NOTE: Row Level Security is intentionally NOT enabled here to keep
-- the demo simple. Every table has user_id / workflow_id so RLS can be layered
-- on later without a schema change:
--   alter table <t> enable row level security;
--   create policy owner on <t> using (user_id = auth.uid());
--
-- Storage: documents live in a private Supabase Storage bucket; only signed URLs
-- are handed to the browser. The rows below store metadata + the storage path.

create extension if not exists "pgcrypto";

-- ── Identity / profile ──────────────────────────────────────────────
create table if not exists profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  display_name      text,
  state             text,
  zip_code          text,
  preferred_language text default 'en',
  demo_mode         boolean not null default false,
  onboarding_complete boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists insurance_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  version           integer not null default 1,
  insurance_lines   text[] not null default '{}',
  profile_json      jsonb not null,
  completeness_score numeric not null default 0,
  quote_ready       boolean not null default false,
  missing_fields    text[] not null default '{}',
  conflicting_fields text[] not null default '{}',
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Workflow ────────────────────────────────────────────────────────
create table if not exists workflows (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  name              text,
  status            text not null default 'draft',
  active_profile_version integer,
  active_quote_request_id uuid,
  selected_negotiation_quote_id uuid,
  active_negotiation_goal_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Documents ───────────────────────────────────────────────────────
create table if not exists documents (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  user_id           uuid not null,
  storage_path      text not null,
  original_filename text,
  sanitized_filename text,
  mime_type         text,
  file_size         integer,
  document_type     text,
  parse_status      text not null default 'pending',
  contains_sensitive_data boolean not null default false,
  retention_until   timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists document_extractions (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references documents(id) on delete cascade,
  extraction_version integer not null default 1,
  provider          text,
  model             text,
  structured_output jsonb,
  evidence_output   jsonb,
  warnings          text[] not null default '{}',
  status            text not null default 'pending',
  created_at        timestamptz not null default now()
);

-- ── Coverage snapshot + private constraints ─────────────────────────
create table if not exists coverage_profiles (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  version           integer not null default 1,
  status            text not null default 'draft',
  profile_json      jsonb not null,
  missing_fields    text[] not null default '{}',
  conflicting_fields text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Private constraints stored as plain JSON for the hackathon (no encryption).
-- Kept in its OWN table so the provider-safe boundary is a real boundary.
create table if not exists private_constraints (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  constraints_json  jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Confirmed request ───────────────────────────────────────────────
create table if not exists quote_requests (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  version           integer not null default 1,
  insurance_lines   text[] not null default '{}',
  specification_json jsonb not null,
  specification_hash text not null,
  matching_mode     text not null default 'exact_match',
  status            text not null default 'confirmed',
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- ── Research ────────────────────────────────────────────────────────
create table if not exists research_runs (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  quote_request_id  uuid references quote_requests(id) on delete set null,
  status            text not null default 'pending',
  query_json        jsonb,
  summary_json      jsonb,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists research_sources (
  id                uuid primary key default gen_random_uuid(),
  research_run_id   uuid not null references research_runs(id) on delete cascade,
  provider_id       uuid,
  source_type       text,
  title             text,
  source_url        text,
  source_domain     text,
  publisher         text,
  retrieved_at      timestamptz,
  excerpt           text,
  claims_json       jsonb,
  official_source   boolean not null default false,
  confidence        numeric,
  created_at        timestamptz not null default now()
);

create table if not exists providers (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  name              text not null,
  provider_type     text,
  website           text,
  public_contact    jsonb,
  address_json      jsonb,
  business_hours_json jsonb,
  insurance_lines   text[] not null default '{}',
  geographic_availability text[] not null default '{}',
  rating            numeric,
  rating_scale      numeric,
  rating_source     text,
  normalized_rating numeric,
  review_count      integer,
  rating_confidence numeric,
  eligibility_status text,
  top_five_rank     integer,
  ranking_score     numeric,
  ranking_explanation text,
  license_verification_status text,
  confirmed_for_quote_call boolean not null default false,
  simulated         boolean not null default true,
  research_summary_json jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Conversations / transcripts ─────────────────────────────────────
create table if not exists conversations (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  quote_request_id  uuid references quote_requests(id) on delete set null,
  provider_id       uuid references providers(id) on delete set null,
  conversation_type text not null,
  elevenlabs_conversation_id text,
  elevenlabs_agent_id text,
  specification_hash text,
  status            text not null default 'idle',
  outcome_type      text,
  started_at        timestamptz,
  ended_at          timestamptz,
  disclosure_confirmed boolean not null default false,
  recording_consent boolean not null default false,
  transcript_json   jsonb,
  summary_json      jsonb,
  failure_reason    text,
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists transcript_segments (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references conversations(id) on delete cascade,
  sequence          integer not null,
  speaker           text,
  start_ms          integer,
  end_ms            integer,
  text              text,
  redacted_text     text,
  created_at        timestamptz not null default now()
);

-- ── Quotes / evidence ───────────────────────────────────────────────
create table if not exists quotes (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  quote_request_id  uuid references quote_requests(id) on delete set null,
  provider_id       uuid references providers(id) on delete set null,
  source_conversation_id uuid references conversations(id) on delete set null,
  specification_hash text,
  status            text not null,
  normalized_json   jsonb not null,
  effective_comparison_cost numeric,
  annualized_cost   numeric,
  completeness_score numeric,
  confidence_score  numeric,
  equivalent_coverage text,
  requires_human_verification boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists evidence (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  evidence_type     text not null,
  source_id         text,
  claim_key         text,
  claim_json        jsonb,
  page_number       integer,
  transcript_start_ms integer,
  transcript_end_ms integer,
  speaker           text,
  excerpt           text,
  source_url        text,
  confidence        numeric,
  verification_status text,
  created_at        timestamptz not null default now()
);

-- ── Negotiation ─────────────────────────────────────────────────────
create table if not exists negotiation_goals (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  selected_quote_id uuid references quotes(id) on delete set null,
  target_provider_id uuid references providers(id) on delete set null,
  -- Full goal (incl. ceiling) stored as plain JSON for the hackathon.
  goal_json         jsonb not null,
  disclosure_policy text not null default 'do_not_reveal_ceiling',
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists negotiation_events (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  negotiation_goal_id uuid references negotiation_goals(id) on delete set null,
  target_provider_id uuid references providers(id) on delete set null,
  negotiation_conversation_id uuid references conversations(id) on delete set null,
  original_quote_id uuid references quotes(id) on delete set null,
  competing_quote_id uuid references quotes(id) on delete set null,
  specification_hash text,
  leverage_claim    text,
  requested_change  text,
  result_json       jsonb,
  original_cost     numeric,
  final_cost        numeric,
  savings_amount    numeric,
  verified          boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists recommendations (
  id                uuid primary key default gen_random_uuid(),
  workflow_id       uuid not null references workflows(id) on delete cascade,
  recommended_quote_id uuid references quotes(id) on delete set null,
  alternative_quote_ids uuid[] not null default '{}',
  ranking_json      jsonb,
  explanation       text,
  evidence_ids      uuid[] not null default '{}',
  generated_at      timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────
create index if not exists idx_insurance_profiles_user on insurance_profiles(user_id);
create index if not exists idx_workflows_user on workflows(user_id);
create index if not exists idx_documents_workflow on documents(workflow_id);
create index if not exists idx_quote_requests_workflow on quote_requests(workflow_id);
create index if not exists idx_providers_workflow on providers(workflow_id);
create index if not exists idx_conversations_workflow on conversations(workflow_id);
create index if not exists idx_transcript_segments_conversation on transcript_segments(conversation_id);
create index if not exists idx_quotes_workflow on quotes(workflow_id);
create index if not exists idx_evidence_workflow on evidence(workflow_id);
create index if not exists idx_negotiation_events_workflow on negotiation_events(workflow_id);
