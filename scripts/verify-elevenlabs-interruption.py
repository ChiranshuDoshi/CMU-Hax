#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "elevenlabs==2.58.0",
# ]
# ///
"""Live, backend-only verification of negotiation memory and audio barge-in."""

from __future__ import annotations

import argparse
from collections.abc import Callable, Iterable
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import threading
import time
from typing import Any

DEFAULT_SESSION_PATH = Path(".artifacts/person3/negotiation-session.json")
RESULT_PATH = Path(".artifacts/person3/interruption-live.json")
TALK_SCRIPT = Path("scripts/talk-elevenlabs-negotiation.py")
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
SAMPLE_RATE = 16_000
SAMPLES_PER_CHUNK = 4_000
BYTES_PER_CHUNK = SAMPLES_PER_CHUNK * 2
CHUNK_SECONDS = SAMPLES_PER_CHUNK / SAMPLE_RATE
DEFAULT_DURATION_SECONDS = 150
MAX_DURATION_SECONDS = 180
# Allows one 250 ms upload tick plus server VAD/network processing without accepting a
# response that effectively played to completion before the interruption arrived.
INTERRUPTION_LATENCY_BOUND_MS = 3_000
TIMESTAMP_ROUNDING_TOLERANCE_MS = 2
OUTPUT_QUIET_SECONDS = 0.75
TURN_END_SILENCE_CHUNKS = 5
PRIVATE_DIRECTORY_MODE = 0o700
PRIVATE_FILE_MODE = 0o600
BASELINE_DOLLARS = 2_000
CORRECTED_DOLLARS = 1_900
DISCOUNT_DOLLARS = 100
FINAL_DOLLARS = 1_800
MONTHLY_DOLLARS = 150
MONTHLY_CENTS = 0

BASELINE_TEXT = (
    "The policy-period baseline is two thousand dollars. That is $2,000, with the same coverage, "
    "and the base price is fixed."
)
CORRECTION_TEXT = (
    "Correction: one thousand nine hundred dollars, $1,900, not $2,000. The base price stays "
    "fixed. Use $1,900 and continue your question without restarting."
)
OFFER_TEXT = (
    "I can apply a one hundred dollar e-billing discount, $100. The final policy-period cost is "
    "one thousand eight hundred dollars, $1,800. The derived monthly effective cost is one hundred "
    "fifty dollars, $150.00. Coverage is unchanged, there are zero added fees, and the offer is "
    "non-binding pending human review."
)
CONFIRMATION_TEXT = (
    "I confirm your final readback: $1,800 policy-period; $150.00 derived monthly; coverage "
    "unchanged; $100 e-billing discount; zero added fees; non-binding pending human review."
)
SCRIPTED_TURNS = {
    "baseline": BASELINE_TEXT,
    "correction": CORRECTION_TEXT,
    "offer": OFFER_TEXT,
    "confirmation": CONFIRMATION_TEXT,
}


def bounded_duration(value: str) -> int:
    try:
        duration = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("duration must be an integer number of seconds") from error
    if not 1 <= duration <= MAX_DURATION_SECONDS:
        raise argparse.ArgumentTypeError(f"duration must be between 1 and {MAX_DURATION_SECONDS} seconds")
    return duration


def parse_args(argv: list[str]) -> argparse.Namespace:
    if argv[:1] == ["--"]:
        argv = argv[1:]
    parser = argparse.ArgumentParser(
        description="Verify ElevenLabs audio interruption and corrected negotiation memory."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Validate local inputs without network, audio, or credits.")
    mode.add_argument("--live", action="store_true", help="Run the live, credit-consuming scripted conversation.")
    parser.add_argument("--session", type=Path, default=DEFAULT_SESSION_PATH)
    parser.add_argument(
        "--duration",
        type=bounded_duration,
        default=DEFAULT_DURATION_SECONDS,
        metavar="SECONDS",
        help=f"Live deadline, at most {MAX_DURATION_SECONDS} seconds (default: {DEFAULT_DURATION_SECONDS}).",
    )
    return parser.parse_args(argv)


def _load_talk_module(root: Path) -> Any:
    path = root / TALK_SCRIPT
    if not path.is_file():
        raise RuntimeError(f"Required negotiation script is missing at {path}.")
    spec = importlib.util.spec_from_file_location("policyscout_talk_elevenlabs", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load negotiation validation helpers from {path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ("load_env", "required_env", "load_session", "build_dynamic_variables", "build_verified_competing_quote_response"):
        if not callable(getattr(module, name, None)):
            raise RuntimeError(f"Negotiation helper {name} is unavailable in {path}.")
    return module


def prepare_configuration(root: Path, session_path: Path) -> dict[str, Any]:
    """Validate through the established talk script and return only safe live inputs."""
    talk = _load_talk_module(root)
    talk.load_env(root)
    api_key = talk.required_env("ELEVENLABS_API_KEY")
    agent_id = talk.required_env("ELEVENLABS_NEGOTIATOR_AGENT_ID")
    resolved_session = session_path if session_path.is_absolute() else root / session_path
    session = talk.load_session(resolved_session)
    dynamic_variables = talk.build_dynamic_variables(session)
    verified_quote = talk.build_verified_competing_quote_response(session)
    participant_name = session["participant"]["displayName"]
    provider_name = dynamic_variables["selected_provider_name"]
    # Never return or transmit the private goal object or any private target/range/ceiling.
    return {
        "api_key": api_key,
        "agent_id": agent_id,
        "voice_id": os.environ.get("ELEVENLABS_VOICE_ID", "").strip() or DEFAULT_VOICE_ID,
        "participant_name": participant_name,
        "provider_name": provider_name,
        "dynamic_variables": dynamic_variables,
        "verified_quote": verified_quote,
    }


def pcm_chunks(audio: bytes, trailing_silence_chunks: int = TURN_END_SILENCE_CHUNKS) -> list[bytes]:
    """Return exact 4,000-sample PCM chunks, padding the final chunk and VAD silence."""
    if not isinstance(audio, bytes) or not audio:
        raise ValueError("Generated PCM audio must be non-empty bytes.")
    chunks: list[bytes] = []
    for offset in range(0, len(audio), BYTES_PER_CHUNK):
        chunk = audio[offset : offset + BYTES_PER_CHUNK]
        chunks.append(chunk.ljust(BYTES_PER_CHUNK, b"\x00"))
    chunks.extend([b"\x00" * BYTES_PER_CHUNK] * trailing_silence_chunks)
    return chunks


def generate_scripted_pcm(
    client: Any,
    voice_id: str,
    deadline: float | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, list[bytes]]:
    """Generate every provider turn before opening the single Conversation."""
    result: dict[str, list[bytes]] = {}
    for name, text in SCRIPTED_TURNS.items():
        remaining = 30.0 if deadline is None else deadline - clock()
        if remaining <= 0:
            raise RuntimeError("Live deadline expired while generating scripted PCM.")
        stream: Iterable[bytes] = client.text_to_speech.convert(
            voice_id=voice_id,
            text=text,
            output_format="pcm_16000",
            model_id="eleven_flash_v2_5",
            request_options={"timeout_in_seconds": max(1, min(30, math.ceil(remaining))), "max_retries": 0},
        )
        result[name] = pcm_chunks(b"".join(stream))
        if deadline is not None and clock() >= deadline:
            raise RuntimeError("Live deadline expired while generating scripted PCM.")
    return result


class ScriptedAudioInterface:
    """Real-time in-memory PCM input/output with observable interruption behavior."""

    def __init__(self, scripted_pcm: dict[str, list[bytes]], clock: Callable[[], float] = time.monotonic) -> None:
        self.scripted_pcm = scripted_pcm
        self.clock = clock
        self.started_at = clock()
        self.input_callback: Callable[[bytes], None] | None = None
        self.pending: list[tuple[str, bool]] = []
        self.current_chunks: list[bytes] = []
        self.current_name: str | None = None
        self.output_buffer = bytearray()
        self.output_events: list[dict[str, Any]] = []
        self.input_events: list[dict[str, Any]] = []
        self.interruptions: list[dict[str, Any]] = []
        self.error: BaseException | None = None
        self.last_output_at: float | None = None
        self.barge_in_at: float | None = None
        self.stopped = False
        self.clean_stop = False
        self.thread: threading.Thread | None = None
        self.condition = threading.Condition()

    def _at_ms(self, value: float | None = None) -> int:
        return round(((self.clock() if value is None else value) - self.started_at) * 1_000)

    def start(self, input_callback: Callable[[bytes], None]) -> None:
        with self.condition:
            if self.thread is not None:
                raise RuntimeError("Scripted audio interface may only be started once.")
            self.input_callback = input_callback
            self.thread = threading.Thread(target=self._run, daemon=True, name="elevenlabs-scripted-audio")
            self.thread.start()

    def stop(self) -> None:
        with self.condition:
            if self.stopped:
                return
            self.stopped = True
            self.output_buffer.clear()
            self.condition.notify_all()
        if self.thread is not None and self.thread is not threading.current_thread():
            self.thread.join(timeout=2.0)
            if self.thread.is_alive():
                self.error = self.error or RuntimeError("Scripted audio delivery did not stop within two seconds.")
        self.clean_stop = self.thread is None or not self.thread.is_alive()

    def output(self, audio: bytes) -> None:
        if not audio:
            return
        now = self.clock()
        with self.condition:
            if self.stopped:
                return
            self.output_buffer.extend(audio)
            self.last_output_at = now
            self.output_events.append({"type": "audio_buffered", "atMs": self._at_ms(now), "bytes": len(audio)})
            self.condition.notify_all()

    def interrupt(self) -> None:
        now = self.clock()
        with self.condition:
            buffered = bytes(self.output_buffer)
            nonzero = sum(byte != 0 for byte in buffered)
            event: dict[str, Any] = {
                "atMs": self._at_ms(now),
                "bufferedBytes": len(buffered),
                "nonzeroBufferedBytes": nonzero,
            }
            if self.barge_in_at is not None:
                event["bargeInAtMs"] = self._at_ms(self.barge_in_at)
                event["latencyMs"] = max(0, round((now - self.barge_in_at) * 1_000))
            self.interruptions.append(event)
            self.output_buffer.clear()
            self.condition.notify_all()

    def queue_turn(self, name: str, *, barge_in: bool = False) -> None:
        if name not in self.scripted_pcm:
            raise KeyError(f"Unknown scripted turn: {name}")
        with self.condition:
            if self.stopped:
                raise RuntimeError("Cannot queue audio after stop.")
            self.pending.append((name, barge_in))
            self.condition.notify_all()

    def wait_for_output_active(self, deadline: float) -> bool:
        with self.condition:
            while not self.stopped:
                if self.output_buffer and any(self.output_buffer):
                    return True
                remaining = deadline - self.clock()
                if remaining <= 0:
                    return False
                self.condition.wait(timeout=min(remaining, 0.1))
        return False

    def wait_for_output_quiet(self, deadline: float) -> bool:
        with self.condition:
            while not self.stopped:
                now = self.clock()
                quiet_for = now - self.last_output_at if self.last_output_at is not None else 0.0
                if self.last_output_at is not None and not self.output_buffer and quiet_for >= OUTPUT_QUIET_SECONDS:
                    return True
                remaining = deadline - now
                if remaining <= 0:
                    return False
                self.condition.wait(timeout=min(remaining, 0.1))
        return False

    def _run(self) -> None:
        next_tick = self.clock()
        silence = b"\x00" * BYTES_PER_CHUNK
        try:
            while True:
                with self.condition:
                    if self.stopped:
                        return
                    if not self.current_chunks and self.pending:
                        name, barge_in = self.pending.pop(0)
                        self.current_name = name
                        self.current_chunks = list(self.scripted_pcm[name])
                        if barge_in:
                            self.barge_in_at = self.clock()
                    chunk = self.current_chunks.pop(0) if self.current_chunks else silence
                    current_name = self.current_name
                    if not self.current_chunks:
                        self.current_name = None
                    del self.output_buffer[: min(BYTES_PER_CHUNK, len(self.output_buffer))]
                    callback = self.input_callback
                if callback is not None:
                    callback(chunk)
                if current_name is not None and any(chunk):
                    self.input_events.append({"type": "input_audio", "turn": current_name, "atMs": self._at_ms()})
                next_tick += CHUNK_SECONDS
                delay = next_tick - self.clock()
                if delay > 0:
                    with self.condition:
                        self.condition.wait(timeout=delay)
        except BaseException as error:
            self.error = error
            with self.condition:
                self.stopped = True
                self.condition.notify_all()


class VerificationRecorder:
    """Thread-safe callback recorder with deadline-aware predicates."""

    def __init__(self, participant_name: str, provider_name: str, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.started_at = clock()
        self.participant_name = participant_name
        self.provider_name = provider_name
        self.transcripts: list[dict[str, Any]] = []
        self.responses: list[dict[str, Any]] = []
        self.corrections: list[dict[str, Any]] = []
        self.tool_calls: list[dict[str, Any]] = []
        self.timeline: list[dict[str, Any]] = []
        self.condition = threading.Condition()

    def at_ms(self) -> int:
        return round((self.clock() - self.started_at) * 1_000)

    def user_transcript(self, text: str) -> None:
        with self.condition:
            event = {"role": "user", "text": text, "atMs": self.at_ms()}
            self.transcripts.append(event)
            self.timeline.append({"type": "user_transcript", "text": text, "atMs": event["atMs"]})
            self.condition.notify_all()

    def agent_response(self, text: str) -> None:
        with self.condition:
            event = {"text": text, "atMs": self.at_ms()}
            self.responses.append(event)
            self.transcripts.append({"role": "agent", **event})
            self.timeline.append({"type": "agent_response", **event})
            self.condition.notify_all()

    def agent_correction(self, original: str, corrected: str) -> None:
        with self.condition:
            event = {"original": original, "corrected": corrected, "atMs": self.at_ms()}
            self.corrections.append(event)
            self.timeline.append({"type": "agent_response_correction", "text": corrected, "atMs": event["atMs"]})
            self.condition.notify_all()

    def tool(self, name: str, arguments: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
        with self.condition:
            event = {"name": name, "arguments": dict(arguments), "atMs": self.at_ms()}
            self.tool_calls.append(event)
            self.timeline.append({"type": "tool_call", "text": name, "atMs": event["atMs"]})
            self.condition.notify_all()
        return response

    def wait_for(self, predicate: Callable[["VerificationRecorder"], bool], deadline: float, message: str) -> None:
        with self.condition:
            while not predicate(self):
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise RuntimeError(message)
                self.condition.wait(timeout=min(remaining, 0.2))


def _contains_amount(text: str, dollars: int, cents: int | None = None) -> bool:
    for match in re.finditer(r"(?<!\d)\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d|\.\d)", text):
        parsed_dollars = int(match.group(1).replace(",", ""))
        parsed_cents = int(match.group(2) or 0)
        if parsed_dollars == dollars and (cents is None or parsed_cents == cents):
            return True
    normalized = re.sub(r"[^a-z]+", " ", text.casefold().replace("-", " ")).strip()
    word_patterns = {
        (2_000, None): r"two thousand(?: dollars?)?",
        (1_900, None): r"one thousand nine hundred(?: dollars?)?",
        (1_800, None): r"one thousand eight hundred(?: dollars?)?",
        (150, 0): r"one hundred(?: and)? fifty dollars?(?: and zero cents?)?",
        (100, None): r"one hundred(?: dollars?)?",
    }
    pattern = word_patterns.get((dollars, cents))
    return bool(pattern and re.search(rf"(?<![a-z])(?:{pattern})(?![a-z])", normalized))


def _has_discount_polarity(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", text.casefold().replace("‑", "-")).strip()
    if re.search(r"e[- ]?billing\s+(?:charge|fee|surcharge)|(?:charge|fee|surcharge).{0,15}e[- ]?billing", normalized):
        return False
    if re.search(r"e[- ]?billing discount.{0,20}(?:does not|doesn't|won't|will not) apply", normalized):
        return False
    return bool(re.search(r"e[- ]?billing discount", normalized))


def _contains_complete_terms(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", text.casefold().replace("‑", "-")).strip()
    rejected = (
        r"coverage (?:is |remains |stays )?not unchanged",
        r"not (?:zero|no) added fees",
        r"(?:not|isn't|is not) non-binding",
        r"(?:no|without) human review",
        r"not pending (?:human )?review",
    )
    if any(re.search(pattern, normalized) for pattern in rejected):
        return False
    return (
        _contains_amount(text, FINAL_DOLLARS)
        and _contains_amount(text, MONTHLY_DOLLARS, MONTHLY_CENTS)
        and bool(re.search(r"coverage (?:is |remains |stays )?unchanged|unchanged coverage", normalized))
        and _contains_amount(text, DISCOUNT_DOLLARS)
        and _has_discount_polarity(text)
        and bool(re.search(r"(?:zero|no) added fees", normalized))
        and bool(re.search(r"non[- ]binding", normalized))
        and bool(re.search(r"pending (?:human )?review|requires human review", normalized))
    )


def _contains_labeled_complete_terms(text: str) -> bool:
    if not _contains_complete_terms(text):
        return False
    policy_label = re.search(r"(?:final\s+)?policy[- ]period(?:\s+(?:final\s+)?cost)?", text, re.I)
    monthly_label = re.search(r"derived\s+monthly(?:\s+effective)?(?:\s+cost)?", text, re.I)
    if policy_label is None or monthly_label is None:
        return False
    policy_end = monthly_label.start() if monthly_label.start() > policy_label.end() else min(len(text), policy_label.end() + 80)
    monthly_end_match = re.search(r"\b(?:coverage|discount|fees?|binding|terms?)\b", text[monthly_label.end() :], re.I)
    monthly_end = (
        monthly_label.end() + monthly_end_match.start()
        if monthly_end_match is not None
        else min(len(text), monthly_label.end() + 80)
    )
    return (
        _contains_amount(text[policy_label.end() : policy_end], FINAL_DOLLARS)
        and _contains_amount(text[monthly_label.end() : monthly_end], MONTHLY_DOLLARS, MONTHLY_CENTS)
    )


def _all_text(result: dict[str, Any], key: str) -> list[str]:
    values = result.get(key, [])
    return [item.get("text", "") for item in values if isinstance(item, dict) and isinstance(item.get("text"), str)]


def _valid_record_arguments(arguments: Any) -> bool:
    if not isinstance(arguments, dict):
        return False
    required = {
        "outcome",
        "providerResponse",
        "finalCostCents",
        "derivedMonthlyEffectiveCostCents",
        "coverageUnchanged",
        "concessionType",
        "addedFeesCents",
        "bindingStatus",
    }
    if set(arguments) != required:
        return False
    provider_response = arguments.get("providerResponse")
    concession = arguments.get("concessionType")
    return (
        arguments.get("outcome") == "improved_terms"
        and arguments.get("finalCostCents") == FINAL_DOLLARS * 100
        and arguments.get("derivedMonthlyEffectiveCostCents") == MONTHLY_DOLLARS * 100 + MONTHLY_CENTS
        and arguments.get("coverageUnchanged") is True
        and isinstance(concession, str)
        and _has_discount_polarity(concession)
        and arguments.get("addedFeesCents") == 0
        and arguments.get("bindingStatus") == "pending_review"
        and isinstance(provider_response, str)
        and _contains_complete_terms(provider_response)
    )


def _valid_opening_semantics(opening: str, participant: str) -> bool:
    normalized = re.sub(r"\s+", " ", opening.casefold().replace("’", "'")).strip()
    participant_normalized = re.sub(r"\s+", " ", participant.casefold()).strip()
    return (
        normalized.startswith("hi, i'm policyscout, an ai agent working on behalf of ")
        and f"working on behalf of {participant_normalized}." in normalized
        and bool(re.search(r"we're reviewing .+'s quote", normalized))
        and normalized.endswith("what can you do to lower the price without changing coverage?")
        and "hackathon" not in normalized
    )


def _is_later_self_intro_or_role_reversal(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", text.casefold().replace("’", "'")).strip()
    return bool(
        re.search(r"\b(?:i am|i'm|this is) policyscout\b|\bai agent working on behalf of\b", normalized)
        or re.search(r"\b(?:i represent|i'm representing|representing) .{0,30}\b(?:buyer|policyholder|client)\b", normalized)
        or re.search(r"\b(?:again|reminder).{0,30}\b(?:ai agent|working on behalf|representing)\b", normalized)
        or re.search(
            r"\b(?:as (?:the )?(?:provider|insurer)|we can offer you|our quoted premium|(?:i|we) can (?:apply|offer) (?:a|the|\$))\b",
            normalized,
        )
    )


def _is_corrected_followup(text: str) -> bool:
    """Accept the deployed response's implicit coverage preservation, but never a coverage tradeoff."""
    return (
        _contains_amount(text, CORRECTED_DOLLARS)
        and "?" in text
        and bool(re.search(r"(?:base|price|cost).{0,25}fixed|fixed.{0,25}(?:base|price|cost)", text, re.I))
        and bool(re.search(r"fee waiver|approved discount|e[- ]?billing|discount|waive.{0,10}fee", text, re.I))
        and not bool(
            re.search(
                r"\b(?:reduce|lower|remove|change)\b.{0,20}\bcoverage\b"
                r"|\bcoverage\b.{0,20}\b(?:reduce|reduced|lower|lowered|remove|removed|change|changed)\b",
                text,
                re.I,
            )
        )
    )


def _evidence_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.casefold().replace("’", "'")).strip()


def _transcript_has_role(result: dict[str, Any], event: dict[str, Any], role: str) -> bool:
    return any(
        isinstance(item, dict)
        and item.get("role") == role
        and _evidence_text(item.get("text", "")) == _evidence_text(event.get("text", ""))
        for item in result.get("transcripts", [])
    )


def _forbidden_artifact_paths(value: Any, path: str = "result") -> list[str]:
    """Locate keys that could serialize a credential or the private negotiation goal."""
    failures: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
            if (
                "apikey" in normalized
                or "secret" in normalized
                or "privatetarget" in normalized
                or normalized in {"goal", "negotiationgoal", "targetamountcents", "targetrangemincents", "targetrangemaxcents", "ceilingcents"}
            ):
                failures.append(f"{path}.{key}")
            failures.extend(_forbidden_artifact_paths(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            failures.extend(_forbidden_artifact_paths(child, f"{path}[{index}]"))
    return failures


def evaluate_verification(result: dict[str, Any]) -> list[str]:
    """Return deterministic failure reasons; this helper performs no I/O or network work."""
    failures: list[str] = []
    responses = _all_text(result, "responses")
    participant = result.get("participantDisplayName", "")
    opening = result.get("expectedOpening", "")
    opening_indexes = [index for index, text in enumerate(responses) if text.strip() == opening.strip()]
    if (
        len(opening_indexes) != 1
        or opening_indexes != [0]
        or not isinstance(participant, str)
        or not _valid_opening_semantics(opening, participant)
    ):
        failures.append("opening must be the exact single buyer-side PolicyScout introduction for the participant")
    if any(_is_later_self_intro_or_role_reversal(text) for text in responses[1:]):
        failures.append("agent later repeated its introduction or reversed into the provider role")

    timeline = result.get("timeline", [])
    opening_event = next((event for event in timeline if event.get("type") == "agent_response"), None)
    if opening_event is None or not _transcript_has_role(result, opening_event, "agent"):
        failures.append("opening was not recorded with the agent/buyer role")
    correction_entry = next(
        (
            (index, event)
            for index, event in enumerate(timeline)
            if event.get("type") == "user_transcript"
            and re.search(r"correct", event.get("text", ""), re.I)
            and _contains_amount(event.get("text", ""), CORRECTED_DOLLARS)
        ),
        None,
    )
    correction_index = correction_entry[0] if correction_entry else None
    correction_at_ms = correction_entry[1].get("atMs") if correction_entry else None
    if correction_entry is None or not _transcript_has_role(result, correction_entry[1], "user"):
        failures.append("correction was not recorded with the provider/seller role")
    correction_audio_at_ms = next(
        (
            event.get("atMs")
            for event in timeline
            if event.get("type") == "input_audio" and event.get("turn") == "correction"
        ),
        None,
    )
    latency_bound_ms = result.get("interruptionLatencyBoundMs", INTERRUPTION_LATENCY_BOUND_MS)
    interruptions = result.get("interruptions", [])
    valid_interruptions = [
        event
        for event in interruptions
        if isinstance(event, dict)
        and event.get("bufferedBytes", 0) > 0
        and event.get("nonzeroBufferedBytes", 0) > 0
        and isinstance(event.get("atMs"), int)
        and isinstance(event.get("bargeInAtMs"), int)
        and isinstance(event.get("latencyMs"), int)
        and isinstance(correction_at_ms, int)
        and isinstance(correction_audio_at_ms, int)
        and abs(event["bargeInAtMs"] - correction_audio_at_ms) <= round(CHUNK_SECONDS * 1_000)
        and event["bargeInAtMs"] <= event["atMs"] <= correction_at_ms
        and abs(event["latencyMs"] - (event["atMs"] - event["bargeInAtMs"])) <= TIMESTAMP_ROUNDING_TOLERANCE_MS
        and 0 <= event["latencyMs"] <= latency_bound_ms
    ]
    if not valid_interruptions:
        failures.append("server did not interrupt active buffered audio during the correction barge-in window")

    post_correction_entries = [
        (index, event)
        for index, event in enumerate(timeline)
        if correction_index is not None and index > correction_index and event.get("type") == "agent_response"
    ]
    immediate_followup = post_correction_entries[0] if post_correction_entries else None
    if immediate_followup is None or not _contains_amount(
        immediate_followup[1].get("text", ""), CORRECTED_DOLLARS
    ):
        failures.append("corrected $1,900 baseline was not retained after superseding $2,000")
    if any(_contains_amount(event.get("text", ""), BASELINE_DOLLARS) for _, event in post_correction_entries):
        failures.append("superseded $2,000 baseline was reused after correction")
    if immediate_followup is None or not _is_corrected_followup(immediate_followup[1].get("text", "")):
        failures.append("immediate correction response did not combine corrected fixed price with a coverage-safe alternative lever")
    if immediate_followup is None or not _transcript_has_role(result, immediate_followup[1], "agent"):
        failures.append("immediate correction response was not recorded with the agent/buyer role")
    if correction_index is not None and any(event.get("text", "").strip() == opening.strip() for _, event in post_correction_entries):
        failures.append("agent restarted the opening after interruption")

    offer_entry = next(
        (
            (index, event)
            for index, event in enumerate(timeline)
            if correction_index is not None
            and index > correction_index
            and event.get("type") == "user_transcript"
            and _contains_labeled_complete_terms(event.get("text", ""))
            and re.search(r"\b(?:can|offer|apply|final)\b", event.get("text", ""), re.I)
        ),
        None,
    )
    if offer_entry is None:
        failures.append("provider did not state one complete improved offer with positive discount polarity")
    elif not _transcript_has_role(result, offer_entry[1], "user"):
        failures.append("improved offer was not recorded with the provider/seller role")

    readback_entry = next(
        (
            (index, event)
            for index, event in enumerate(timeline)
            if offer_entry is not None
            and index > offer_entry[0]
            and event.get("type") == "agent_response"
            and _contains_labeled_complete_terms(event.get("text", ""))
            and "?" in event.get("text", "")
        ),
        None,
    )
    if readback_entry is None:
        failures.append("agent did not give a complete readback after the provider's offer")
    elif not _transcript_has_role(result, readback_entry[1], "agent"):
        failures.append("final readback was not recorded with the agent/buyer role")

    final_confirmation_entry = next(
        (
            (index, event)
            for index, event in enumerate(timeline)
            if readback_entry is not None
            and index > readback_entry[0]
            and event.get("type") == "user_transcript"
            and _contains_complete_terms(event.get("text", ""))
            and re.search(r"explicitly confirm|that is correct|confirm your final readback", event.get("text", ""), re.I)
        ),
        None,
    )
    final_confirmation = final_confirmation_entry[1] if final_confirmation_entry else None
    if final_confirmation is None:
        failures.append("provider did not completely confirm the agent's preceding readback")
    elif not _transcript_has_role(result, final_confirmation, "user"):
        failures.append("final confirmation was not recorded with the provider/seller role")

    record_calls = [call for call in result.get("toolCalls", []) if call.get("name") == "record_negotiation_event"]
    if len(record_calls) != 1 or not _valid_record_arguments(record_calls[0].get("arguments") if record_calls else None):
        failures.append("record_negotiation_event must be called exactly once with every exact verified field")
    elif final_confirmation_entry is None:
        failures.append("record_negotiation_event was called before final provider confirmation")
    else:
        record_call = record_calls[0]
        tool_timeline_entry = next(
            (
                (index, event)
                for index, event in enumerate(timeline)
                if event.get("type") == "tool_call" and event.get("text") == "record_negotiation_event"
            ),
            None,
        )
        provider_response = record_call.get("arguments", {}).get("providerResponse", "")
        correlated = (
            tool_timeline_entry is not None
            and tool_timeline_entry[0] > final_confirmation_entry[0]
            and isinstance(record_call.get("atMs"), int)
            and isinstance(tool_timeline_entry[1].get("atMs"), int)
            and isinstance(final_confirmation.get("atMs"), int)
            and record_call["atMs"] + TIMESTAMP_ROUNDING_TOLERANCE_MS >= final_confirmation["atMs"]
            and abs(tool_timeline_entry[1]["atMs"] - record_call["atMs"]) <= TIMESTAMP_ROUNDING_TOLERANCE_MS
            and _evidence_text(provider_response) == _evidence_text(final_confirmation.get("text", ""))
        )
        if (
            isinstance(record_call.get("atMs"), int)
            and isinstance(final_confirmation.get("atMs"), int)
            and record_call["atMs"] + TIMESTAMP_ROUNDING_TOLERANCE_MS < final_confirmation["atMs"]
        ):
            failures.append("record_negotiation_event was called before final provider confirmation")
        elif not correlated:
            failures.append("record_negotiation_event was not correlated to the ordered final provider confirmation")

    if not isinstance(result.get("conversationId"), str) or not result["conversationId"].strip():
        failures.append("one non-null conversation ID is required")
    if result.get("conversationCount") != 1:
        failures.append("verification must create exactly one Conversation")
    if result.get("cleanStop") is not True:
        failures.append("conversation and scripted audio did not stop cleanly")
    forbidden_paths = _forbidden_artifact_paths(result)
    if forbidden_paths:
        failures.append(f"result contains forbidden private or secret data at {forbidden_paths[0]}")
    return failures


def write_private_result(root: Path, result: dict[str, Any]) -> Path:
    path = root / RESULT_PATH
    directory = path.parent
    directory.mkdir(parents=True, exist_ok=True, mode=PRIVATE_DIRECTORY_MODE)
    directory.chmod(PRIVATE_DIRECTORY_MODE)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE_MODE)
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(result, file, indent=2, sort_keys=True)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        path.chmod(PRIVATE_FILE_MODE)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return path


def close_session_bounded(conversation: Any, started: bool, timeout_seconds: float) -> str | None:
    """Contain both synchronous SDK close operations within one bounded worker."""
    completed = threading.Event()
    outcome: dict[str, Any] = {}

    def close() -> None:
        try:
            conversation.end_session()
            if started:
                outcome["conversation_id"] = conversation.wait_for_session_end()
        except BaseException as error:
            outcome["error"] = error
        finally:
            completed.set()

    closer = threading.Thread(target=close, daemon=True, name="elevenlabs-session-close")
    closer.start()
    if not completed.wait(timeout=max(0.1, timeout_seconds)):
        raise RuntimeError("ElevenLabs session did not stop within the bounded cleanup window.")
    if "error" in outcome:
        raise RuntimeError(f"ElevenLabs session cleanup failed: {outcome['error']}") from outcome["error"]
    return outcome.get("conversation_id")


def cleanup_session_bounded(
    conversation: Any,
    audio: ScriptedAudioInterface,
    started: bool,
    timeout_seconds: float,
) -> str | None:
    """Always stop local audio even when an SDK close call blocks or fails."""
    try:
        return close_session_bounded(conversation, started, timeout_seconds)
    finally:
        audio.stop()


def run_live(configuration: dict[str, Any], duration_seconds: int) -> dict[str, Any]:
    from elevenlabs.client import ElevenLabs
    from elevenlabs.conversational_ai.conversation import (
        AudioInterface,
        ClientTools,
        Conversation,
        ConversationInitiationData,
    )

    class PublicScriptedAudioInterface(ScriptedAudioInterface, AudioInterface):
        """Bind the network-free implementation to the SDK's public interface at runtime."""

    deadline = time.monotonic() + duration_seconds
    client = ElevenLabs(api_key=configuration["api_key"])
    scripted_pcm = generate_scripted_pcm(client, configuration["voice_id"], deadline)
    audio = PublicScriptedAudioInterface(scripted_pcm)
    recorder = VerificationRecorder(configuration["participant_name"], configuration["provider_name"])
    tools = ClientTools()
    tools.register(
        "get_verified_competing_quote",
        lambda arguments: recorder.tool("get_verified_competing_quote", arguments, configuration["verified_quote"]),
    )
    tools.register(
        "record_negotiation_event",
        lambda arguments: recorder.tool(
            "record_negotiation_event",
            arguments,
            {"recorded": True, "requiresHumanReview": True},
        ),
    )
    ended = threading.Event()
    expected_opening = (
        f"Hi, I’m PolicyScout, an AI agent working on behalf of {configuration['participant_name']}. "
        f"We’re reviewing {configuration['provider_name']}’s quote—what can you do to lower the price without changing coverage?"
    )

    conversation = Conversation(
        client=client,
        agent_id=configuration["agent_id"],
        requires_auth=True,
        audio_interface=audio,
        config=ConversationInitiationData(dynamic_variables=configuration["dynamic_variables"]),
        client_tools=tools,
        callback_user_transcript=recorder.user_transcript,
        callback_agent_response=recorder.agent_response,
        callback_agent_response_correction=recorder.agent_correction,
        callback_end_session=ended.set,
    )
    conversation_id: str | None = None
    started = False
    run_error: str | None = None
    try:
        conversation.start_session()
        started = True
        recorder.wait_for(lambda state: any(item["text"].strip() == expected_opening for item in state.responses), deadline, "Opening message was not observed.")
        if not audio.wait_for_output_quiet(deadline):
            raise RuntimeError("Opening audio did not become quiet before the baseline turn.")
        audio.queue_turn("baseline")
        recorder.wait_for(
            lambda state: any(
                _contains_amount(item["text"], BASELINE_DOLLARS)
                for item in state.transcripts
                if item["role"] == "user"
            ),
            deadline,
            "Baseline transcript was not observed.",
        )
        if not audio.wait_for_output_active(deadline):
            raise RuntimeError("Agent audio was not active for the correction barge-in.")
        audio.queue_turn("correction", barge_in=True)
        recorder.wait_for(
            lambda state: any(
                _contains_amount(item["text"], CORRECTED_DOLLARS)
                for item in state.transcripts
                if item["role"] == "user"
            ),
            deadline,
            "Correction transcript was not observed.",
        )
        recorder.wait_for(
            lambda state: any(_is_corrected_followup(item["text"]) for item in state.responses),
            deadline,
            "Agent did not retain the corrected baseline, reuse the fixed-price constraint, and resume its question.",
        )
        if not audio.wait_for_output_quiet(deadline):
            raise RuntimeError("Post-correction agent audio did not become quiet.")
        audio.queue_turn("offer")
        recorder.wait_for(
            lambda state: any(
                _contains_amount(item["text"], FINAL_DOLLARS)
                for item in state.transcripts
                if item["role"] == "user"
            ),
            deadline,
            "Improved terms transcript was not observed.",
        )
        recorder.wait_for(
            lambda state: any(
                _contains_amount(item["text"], FINAL_DOLLARS)
                and _contains_amount(item["text"], MONTHLY_DOLLARS, MONTHLY_CENTS)
                and re.search(r"coverage", item["text"], re.I)
                and re.search(r"fee", item["text"], re.I)
                for item in state.responses
            ),
            deadline,
            "Agent did not produce a complete final verification readback.",
        )
        if not audio.wait_for_output_quiet(deadline):
            raise RuntimeError("Final readback audio did not become quiet.")
        audio.queue_turn("confirmation")
        recorder.wait_for(
            lambda state: any(
                _contains_amount(item["text"], FINAL_DOLLARS) and "confirm" in item["text"].casefold()
                for item in state.transcripts
                if item["role"] == "user"
            ),
            deadline,
            "Final confirmation transcript was not observed.",
        )
        recorder.wait_for(
            lambda state: len([call for call in state.tool_calls if call["name"] == "record_negotiation_event"]) >= 1,
            deadline,
            "The verified event tool was not called after confirmation.",
        )
        # Leave a short bounded window for the agent's closing acknowledgement and duplicate-call detection.
        with recorder.condition:
            recorder.condition.wait(timeout=min(2.0, max(0.0, deadline - time.monotonic())))
    except BaseException as error:
        run_error = str(error)
    finally:
        cleanup_error: BaseException | None = None
        try:
            conversation_id = cleanup_session_bounded(conversation, audio, started, 5.0)
        except BaseException as error:
            cleanup_error = error
        ended.wait(timeout=0.5)
        if cleanup_error is not None:
            message = f"Session cleanup failed: {cleanup_error}"
            run_error = f"{run_error}; {message}" if run_error else message

    result = {
        "schemaVersion": 1,
        "participantDisplayName": configuration["participant_name"],
        "expectedOpening": expected_opening,
        "transcripts": recorder.transcripts,
        "responses": recorder.responses,
        "corrections": recorder.corrections,
        "interruptions": audio.interruptions,
        "timeline": sorted(
            recorder.timeline
            + audio.input_events
            + audio.output_events
            + [{"type": "interruption", **event} for event in audio.interruptions],
            key=lambda item: item.get("atMs", 0),
        ),
        "toolCalls": recorder.tool_calls,
        "conversationId": conversation_id,
        "conversationCount": 1,
        "cleanStop": audio.clean_stop and audio.error is None and ended.is_set(),
        "interruptionLatencyBoundMs": INTERRUPTION_LATENCY_BOUND_MS,
        "scenario": {
            "originalPriceCents": BASELINE_DOLLARS * 100,
            "expectedCorrectedPriceCents": CORRECTED_DOLLARS * 100,
            "expectedLowerPriceCents": FINAL_DOLLARS * 100,
            "expectedDerivedMonthlyCents": MONTHLY_DOLLARS * 100 + MONTHLY_CENTS,
            "expectedDiscountCents": DISCOUNT_DOLLARS * 100,
        },
    }
    if run_error:
        result["runError"] = run_error
    if audio.error is not None:
        result["audioError"] = str(audio.error)
    result["failures"] = evaluate_verification(result)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    root = Path.cwd()
    configuration = prepare_configuration(root, args.session)
    if args.check:
        print("ElevenLabs interruption verifier configuration is ready (no network, audio, or credits used).")
        return 0

    result = run_live(configuration, args.duration)
    path = write_private_result(root, result)
    if result["failures"]:
        print(f"ElevenLabs interruption verification failed; private evidence: {path}", file=sys.stderr)
        for failure in result["failures"]:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"ElevenLabs interruption verification passed; private evidence: {path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print(f"ElevenLabs interruption verifier failed: {error}", file=sys.stderr)
        raise SystemExit(1)
