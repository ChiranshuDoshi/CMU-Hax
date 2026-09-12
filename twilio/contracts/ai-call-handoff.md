# AI call handoff contract

## Scope

The Twilio voice gateway and any future AI voice bridge both stay inside
`twilio/`. Neither may expose Twilio credentials, the internal outbound token,
or direct call-creation capability to the root application or a client.

Until an AI bridge is intentionally enabled, both voice routes return safe TwiML:
tell the caller that the AI is not connected, then hang up. The gateway remains
healthy and deterministic in this mode.

## Gateway boundary

| Route | Caller | Gateway responsibility | AI bridge responsibility |
| --- | --- | --- | --- |
| `POST /webhooks/voice/inbound` | Twilio | Validate the signature against the exact public URL, then return safe TwiML or request a handoff. | Create/resume a server-managed session only after verification. |
| `POST /webhooks/voice/outbound` | Twilio | Validate the signature, then return safe TwiML or request a handoff. | Attach the authorized call to its server-managed session. |
| `POST /webhooks/status` | Twilio | Validate and acknowledge duplicate-tolerant callbacks. | Correlate by Twilio call SID, then advance or close only the matching session. |
| `POST /calls` | Trusted server | Authorize, enforce idempotency and allowlist, then request a Twilio call. | May receive approved context but cannot bypass gateway checks. |

## Security invariants

- Reject a missing or invalid `X-Twilio-Signature` before processing a webhook
  body. Validation uses `TWILIO_AUTH_TOKEN`, the exact external HTTPS URL
  including its query string, and the request parameters. The configured base
  URL is an HTTPS origin; preserve/configure the public scheme and host when
  TLS terminates at a reverse proxy.
- `POST /calls` requires
  `Authorization: Bearer <TWILIO_INTERNAL_API_TOKEN>`, an
  `Idempotency-Key` header no longer than 128 characters, and body
  `{ "to": "+E164" }`. Never deliver the token to a browser, app, or AI prompt.
- Parse `TWILIO_OUTBOUND_ALLOWED_DESTINATIONS` as a finite list of exact E.164
  numbers. Reject malformed or non-listed destinations before contacting Twilio.
- The current process-local idempotency store records the key before Twilio is
  called, so concurrent retries within one process cannot create duplicates.
  Replace it with shared durable storage before using multiple replicas or
  relying on duplicate protection across restarts.
- Do not log secrets, authorization headers, raw audio, recordings, or more
  phone-number data than operations require.

## Lifecycle

1. Verify the request and choose the route.
2. For `POST /calls`, validate bearer auth, key, and destination before call
   creation.
3. When an AI bridge is added, associate the call with server-managed state
   keyed by Twilio call SID.
4. Have that bridge process status callbacks idempotently: duplicates,
   reordering, and terminal events must not create another session or call.
5. Release live bridge resources at terminal state and apply the approved data
   retention policy. If TwiML is requested while the bridge is unavailable,
   return the safe non-AI response.

## Recording, consent, and retention gate

Recording and transcription are off by default. Do not enable them until an
accountable owner has approved and implemented: caller notice and any required
affirmative consent; an opt-out and alternative path; captured data classes,
uses, retention/deletion, access controls, and vendor sharing terms; plus
subject-request, incident-response, audit, and access-revocation controls.

## Acceptance checks before an AI bridge is live

1. Valid webhooks are accepted; missing, invalid, and proxy-mismatched
   signatures are rejected.
2. Invalid bearer tokens, missing keys, malformed destinations, and non-listed
   destinations never create Twilio calls.
3. Sequential and concurrent retry of one key creates no duplicate call.
4. Repeated or reordered status callbacks cannot duplicate a session, and
   terminal states release resources.
5. The unavailable-AI path returns the announcement-and-hangup TwiML.
6. Recording/transcription stays disabled until the explicit policy is deployed.
