# Twilio voice gateway

This folder is an isolated Node.js 20+ / TypeScript service for Twilio Voice.
It is not imported by the repository's root application. Keep its credentials
and runtime configuration server-only.

The gateway starts safely without Twilio configuration so a health probe can
run locally or in deployment. It cannot make a live outbound call until all
required Twilio and internal-security settings are configured.

## Routes

| Method and path | Caller | Purpose |
| --- | --- | --- |
| `GET /health` | Platform probe | Reports gateway availability. |
| `POST /webhooks/voice/inbound` | Twilio | Handles inbound Voice call control. |
| `POST /webhooks/voice/outbound` | Twilio | Handles outbound-call TwiML requests. |
| `POST /webhooks/status` | Twilio | Validates and acknowledges call-progress callbacks. |
| `POST /calls` | Trusted server | Requests an authorized, idempotent outbound call. |

Every `/webhooks/*` request must pass Twilio signature validation before its
body is processed. With no AI bridge enabled, the voice responder says that
the AI is not connected and hangs up. It does not create an AI session.

## Local setup

Run from this directory:

```sh
cp .env.example .env
pnpm install
pnpm dev
```

Normal lifecycle commands are `pnpm dev`, `pnpm build`, `pnpm start`,
`pnpm test`, and `pnpm typecheck`. `PORT=3010` is optional and supplied
in the example file. Never commit `.env` or send its values to a browser,
client bundle, or untrusted caller.

## Configuration

The service can start with Twilio values unset. Live outbound calling requires
every required value below.

| Variable | Required for live outbound calls | Meaning |
| --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | Yes | Server-only Twilio account identifier. |
| `TWILIO_AUTH_TOKEN` | Yes | Server-only Twilio credential and webhook-validation secret. |
| `TWILIO_PHONE_NUMBER` | Yes | Gateway caller ID in E.164 form. |
| `TWILIO_PUBLIC_WEBHOOK_BASE_URL` | Yes | Public HTTPS origin Twilio calls; no path, query, or fragment. |
| `TWILIO_INTERNAL_API_TOKEN` | Yes | Secret required in `Authorization: Bearer <token>` on `POST /calls`. |
| `TWILIO_OUTBOUND_ALLOWED_DESTINATIONS` | Yes | Comma-separated, exact E.164 destination allowlist. |
| `PORT` | No | Local listener port; the example uses `3010`. |

`TWILIO_PUBLIC_WEBHOOK_BASE_URL` must be the exact external HTTPS origin
Twilio uses. Do not validate against an internal reverse-proxy URL. Twilio's
Node validator derives the signature from the request URL and parameters, so
configure proxy-aware scheme/host reconstruction correctly.

## Twilio configuration

Configure Twilio to use these public HTTPS endpoints with POST:

| Twilio setting | Gateway URL |
| --- | --- |
| Incoming voice webhook | `${TWILIO_PUBLIC_WEBHOOK_BASE_URL}/webhooks/voice/inbound` |
| Outbound call TwiML URL | `${TWILIO_PUBLIC_WEBHOOK_BASE_URL}/webhooks/voice/outbound` |
| Call status callback | `${TWILIO_PUBLIC_WEBHOOK_BASE_URL}/webhooks/status` |

Treat status callbacks as at-least-once delivery. The current gateway validates
and acknowledges them only; a future AI bridge must correlate by Twilio call
SID and make state updates safe to repeat.

## Internal outbound-call API

`POST /calls` is not a public browser endpoint. A trusted server sends:

```http
Authorization: Bearer <TWILIO_INTERNAL_API_TOKEN>
Idempotency-Key: <stable key, 128 characters maximum>
Content-Type: application/json
```

```json
{ "to": "+E164" }
```

A retry with the same idempotency key must return the first result rather than
dial again. The destination must exactly match an E.164 entry in
`TWILIO_OUTBOUND_ALLOWED_DESTINATIONS`; wildcards, client-side allowlists,
and user-defined destinations are not permitted. Redact credentials,
authorization headers, and sensitive call data from logs.

## Recording and consent

Recording and transcription are disabled by default. Before enabling recording,
transcription, storage, or replay, define and implement the applicable consent
notice, opt-out, legal basis, retention/deletion schedule, access controls, and
incident process. This policy must be explicitly approved before traffic is
handed to an AI bridge.

## Container image

Build from this directory:

```sh
docker build -t twilio-gateway .
docker run --rm --env-file .env -p 3010:3010 twilio-gateway
```

The multi-stage image compiles TypeScript in a builder and runs only production
dependencies plus `dist/`; it does not include source, tests, local
environment files, or development dependencies.

## AI bridge boundary

Future AI streaming, session orchestration, and provider SDKs stay inside this
folder behind the gateway. See
[`contracts/ai-call-handoff.md`](contracts/ai-call-handoff.md). Preserve the
safe announcement-and-hangup response if the AI bridge is absent or unhealthy.

## Deployment checklist

1. Preserve the public HTTPS URL for signature validation.
2. Reject missing, invalid, and proxy-mismatched Twilio signatures before use.
3. Store all live outbound secrets in the deployment secret store.
4. Verify unauthorized, non-allowlisted, and duplicate `POST /calls` requests
   cannot create a call.
5. Approve recording and consent controls before any capture or retention.
