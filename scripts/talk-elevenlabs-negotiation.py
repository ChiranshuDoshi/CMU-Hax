#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "elevenlabs[pyaudio]==2.58.0",
# ]
# ///
"""Talk to the private PolicyScout negotiator through a terminal microphone."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import queue
import re
import shlex
import stat
import sys
import threading
import time
import unicodedata
from typing import Any


DEFAULT_SESSION_PATH = Path(".artifacts/person3/negotiation-session.json")
ENV_FILES = (".env.local", ".env")
SAMPLE_RATE = 16_000
ENV_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_DISPLAY_NAME_LENGTH = 120
ELIGIBLE_COVERAGE_STATUSES = frozenset({"equivalent", "better_than_requested"})


def parse_args(argv: list[str]) -> argparse.Namespace:
    if argv[:1] == ["--"]:
        argv = argv[1:]
    parser = argparse.ArgumentParser(
        description="Talk to the PolicyScout ElevenLabs negotiation agent using your microphone and speakers."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--live", action="store_true", help="Start a live, credit-consuming voice conversation.")
    mode.add_argument("--check", action="store_true", help="Validate local configuration without using audio or credits.")
    parser.add_argument(
        "--session",
        type=Path,
        default=DEFAULT_SESSION_PATH,
        help=f"Prepared negotiation session (default: {DEFAULT_SESSION_PATH}).",
    )
    return parser.parse_args(argv)


def load_env(root: Path) -> None:
    for name in ENV_FILES:
        path = root / name
        if not path.is_file():
            continue
        permissions = stat.S_IMODE(path.stat().st_mode)
        if permissions & 0o077:
            raise RuntimeError(f"{path} must be private. Run: chmod 600 {path}")
        for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            if "=" not in line:
                raise RuntimeError(f"Invalid environment entry in {path} at line {line_number}.")
            key, raw_value = line.split("=", 1)
            key = key.strip()
            if not ENV_NAME_PATTERN.fullmatch(key):
                raise RuntimeError(f"Invalid environment name in {path} at line {line_number}.")
            try:
                parsed = shlex.split(raw_value, comments=True, posix=True)
            except ValueError as error:
                raise RuntimeError(f"Invalid environment value in {path} at line {line_number}.") from error
            value = " ".join(parsed) if parsed else ""
            os.environ.setdefault(key, value)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is missing.")
    return value


def load_session(path: Path) -> dict[str, Any]:
    try:
        session = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(
            f"Prepared negotiation session is missing at {path}. "
            "Run prepare:elevenlabs:negotiation first."
        ) from error
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cannot read a valid prepared negotiation session from {path}: {error}") from error

    if not isinstance(session, dict):
        raise RuntimeError("Prepared negotiation session must be a JSON object.")

    participant = session.get("participant")
    display_name = participant.get("displayName") if isinstance(participant, dict) else None
    if not isinstance(display_name, str):
        raise RuntimeError("Prepared negotiation session is missing participant.displayName.")
    display_name = display_name.strip()
    if (
        not display_name
        or len(display_name) > MAX_DISPLAY_NAME_LENGTH
        or any(unicodedata.category(character) == "Cc" for character in display_name)
    ):
        raise RuntimeError(
            f"Prepared negotiation session participant.displayName must be 1-{MAX_DISPLAY_NAME_LENGTH} "
            "trimmed characters with no control characters."
        )
    session["participant"] = {**participant, "displayName": display_name}

    handoff = session.get("handoff")
    target = handoff.get("target") if isinstance(handoff, dict) else None
    explicit = session.get("explicitSelection")
    if not isinstance(target, dict) or not isinstance(explicit, dict):
        raise RuntimeError("Prepared negotiation session is missing its handoff or explicit selection.")
    expected = (target.get("providerId"), target.get("quoteId"), handoff.get("specificationHash"))
    actual = (explicit.get("providerId"), explicit.get("quoteId"), explicit.get("specificationHash"))
    if expected != actual or not all(expected):
        raise RuntimeError("Prepared negotiation session selection does not match its handoff.")
    return session


def format_cents(value: Any) -> str:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        return "not available"
    return f"${value / 100:,.2f}"


def build_dynamic_variables(session: dict[str, Any]) -> dict[str, Any]:
    handoff = session["handoff"]
    target = handoff["target"]
    goal = session.get("goal", {})
    cost = target.get("effectiveComparisonCostCents")
    months = target.get("policyTermMonths")
    monthly = round(cost / months) if isinstance(cost, int) and isinstance(months, int) and months > 0 else None
    verified_competing_quote = build_verified_competing_quote_response(session)
    leverage = verified_competing_quote.get(
        "allowed_leverage_text",
        "No verified competing quote is available; do not imply one exists.",
    )
    coverage = {
        "equivalence": (target.get("coverageEquivalence") or {}).get("status", "unknown"),
    }
    return {
        "user_display_name": session["participant"]["displayName"],
        "selected_provider_name": target.get("providerName", "selected provider"),
        "selected_provider_id": target["providerId"],
        "selected_quote_id": target["quoteId"],
        "negotiation_goal_id": goal.get("id", "prepared-local-goal"),
        "workflow_id": handoff.get("workflowId", "unknown"),
        "specification_hash": handoff["specificationHash"],
        "derived_monthly_effective_cost": f"{format_cents(monthly)} (derived equivalent)",
        "policy_period_effective_cost": format_cents(cost),
        # The handoff intentionally has no competing policy term, so a monthly value is not derivable.
        "verified_comparable_monthly_effective_cost": "not available",
        "allowed_leverage_text": leverage,
        "coverage_summary": json.dumps(coverage, separators=(",", ":")),
        "quote_disclaimer": target.get(
            "disclaimer", "Simulated quote; not supplied by the insurer; non-binding; requires human verification."
        ),
        "simulated": bool(target.get("simulated", True)),
        "requires_human_verification": bool(target.get("requiresHumanVerification", True)),
    }


def build_verified_competing_quote_response(session: dict[str, Any]) -> dict[str, Any]:
    """Return only leverage explicitly verified by both the handoff and private goal."""
    handoff = session.get("handoff")
    goal = session.get("goal")
    selection = session.get("explicitSelection")
    target = handoff.get("target") if isinstance(handoff, dict) else None
    competing = handoff.get("verifiedCompetingQuote") if isinstance(handoff, dict) else None
    if not all(isinstance(value, dict) for value in (goal, selection, target, competing)):
        return {"has_verified_competing_quote": False}

    quote_id = competing.get("quoteId")
    provider_id = competing.get("providerId")
    provider_name = competing.get("providerName")
    cost_cents = competing.get("effectiveComparisonCostCents")
    evidence_ids = competing.get("evidenceIds")
    coverage = competing.get("coverageEquivalence")
    verified = (
        goal.get("workflowId") == handoff.get("workflowId")
        and goal.get("selectedQuoteId") == selection.get("quoteId")
        and goal.get("targetProviderId") == selection.get("providerId")
        and selection.get("quoteId") == target.get("quoteId")
        and selection.get("providerId") == target.get("providerId")
        and isinstance(quote_id, str)
        and bool(quote_id)
        and quote_id == goal.get("verifiedCompetingQuoteId")
        and quote_id != selection.get("quoteId")
        and isinstance(provider_id, str)
        and bool(provider_id)
        and isinstance(provider_name, str)
        and bool(provider_name.strip())
        and isinstance(cost_cents, int)
        and not isinstance(cost_cents, bool)
        and cost_cents > 0
        and isinstance(evidence_ids, list)
        and bool(evidence_ids)
        and all(isinstance(evidence_id, str) and bool(evidence_id) for evidence_id in evidence_ids)
        and isinstance(coverage, dict)
        and coverage.get("status") in ELIGIBLE_COVERAGE_STATUSES
    )
    if not verified:
        return {"has_verified_competing_quote": False}

    allowed_leverage_text = (
        f"A verified comparable quote from {provider_name.strip()} has a normalized comparison cost "
        f"of {cost_cents} cents."
    )
    return {
        "has_verified_competing_quote": True,
        "allowed_leverage_text": allowed_leverage_text,
    }


def preflight_audio() -> None:
    try:
        import pyaudio
    except ImportError as error:
        raise RuntimeError(
            "PyAudio is missing. Install PortAudio and rerun the pnpm command; see the README."
        ) from error

    audio = pyaudio.PyAudio()
    try:
        input_device = audio.get_default_input_device_info()
        output_device = audio.get_default_output_device_info()
        audio.is_format_supported(
            SAMPLE_RATE,
            input_device=input_device["index"],
            input_channels=1,
            input_format=pyaudio.paInt16,
            output_device=output_device["index"],
            output_channels=1,
            output_format=pyaudio.paInt16,
        )
    except Exception as error:
        raise RuntimeError(
            "No compatible default microphone/speaker was found. Connect audio devices and allow Terminal microphone access."
        ) from error
    finally:
        audio.terminate()


class TerminalAudioInterface:
    """PyAudio interface with callback output and idempotent partial cleanup."""

    INPUT_FRAMES_PER_BUFFER = 4_000
    OUTPUT_FRAMES_PER_BUFFER = 1_000

    def __init__(self) -> None:
        import pyaudio

        self.pyaudio = pyaudio
        self.audio: Any | None = None
        self.input_stream: Any | None = None
        self.output_stream: Any | None = None
        self.input_callback: Any | None = None
        self.input_queue: queue.Queue[bytes | None] = queue.Queue(maxsize=8)
        self.input_thread: threading.Thread | None = None
        self.output_buffer = bytearray()
        self.error: BaseException | None = None
        self.stopped = False
        self.lock = threading.Lock()

    def start(self, input_callback: Any) -> None:
        self.input_callback = input_callback
        try:
            self.audio = self.pyaudio.PyAudio()
            self.input_stream = self.audio.open(
                format=self.pyaudio.paInt16,
                channels=1,
                rate=SAMPLE_RATE,
                input=True,
                stream_callback=self._input_callback,
                frames_per_buffer=self.INPUT_FRAMES_PER_BUFFER,
                start=False,
            )
            self.output_stream = self.audio.open(
                format=self.pyaudio.paInt16,
                channels=1,
                rate=SAMPLE_RATE,
                output=True,
                stream_callback=self._output_callback,
                frames_per_buffer=self.OUTPUT_FRAMES_PER_BUFFER,
                start=False,
            )
            self.input_thread = threading.Thread(target=self._deliver_input, daemon=True, name="elevenlabs-mic")
            self.input_thread.start()
            self.output_stream.start_stream()
            self.input_stream.start_stream()
        except BaseException as error:
            self.error = error
            self.stop()
            raise

    def stop(self) -> None:
        with self.lock:
            if self.stopped:
                return
            self.stopped = True
            self.output_buffer.clear()
        try:
            self.input_queue.put_nowait(None)
        except queue.Full:
            pass
        for stream in (self.input_stream, self.output_stream):
            if stream is None:
                continue
            try:
                if stream.is_active():
                    stream.stop_stream()
            except Exception:
                pass
            try:
                stream.close()
            except Exception:
                pass
        if self.audio is not None:
            try:
                self.audio.terminate()
            except Exception:
                pass
        if self.input_thread is not None and self.input_thread is not threading.current_thread():
            self.input_thread.join(timeout=1)
            if self.input_thread.is_alive() and self.error is None:
                self.error = RuntimeError("Microphone delivery did not stop cleanly.")

    def output(self, audio: bytes) -> None:
        with self.lock:
            if not self.stopped:
                self.output_buffer.extend(audio)

    def interrupt(self) -> None:
        with self.lock:
            self.output_buffer.clear()

    def _input_callback(self, audio: bytes, _frame_count: int, _time_info: Any, _status: int) -> tuple[None, int]:
        try:
            self.input_queue.put_nowait(bytes(audio))
        except queue.Full:
            try:
                self.input_queue.get_nowait()
                self.input_queue.put_nowait(bytes(audio))
            except queue.Empty:
                pass
        return (None, self.pyaudio.paContinue)

    def _deliver_input(self) -> None:
        while not self.stopped:
            try:
                audio = self.input_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            if audio is None:
                return
            try:
                if self.input_callback is not None:
                    self.input_callback(audio)
            except BaseException as error:
                self.error = error
                return

    def _output_callback(self, _input: None, frame_count: int, _time_info: Any, _status: int) -> tuple[bytes, int]:
        byte_count = frame_count * 2
        with self.lock:
            available = min(byte_count, len(self.output_buffer))
            chunk = bytes(self.output_buffer[:available])
            del self.output_buffer[:available]
            stopped = self.stopped
        if available < byte_count:
            chunk += b"\x00" * (byte_count - available)
        return (chunk, self.pyaudio.paComplete if stopped else self.pyaudio.paContinue)


def run_live(
    api_key: str,
    agent_id: str,
    dynamic_variables: dict[str, Any],
    verified_competing_quote: dict[str, Any],
) -> str | None:
    from elevenlabs.client import ElevenLabs
    from elevenlabs.conversational_ai.conversation import ClientTools, Conversation, ConversationInitiationData

    preflight_audio()
    audio = TerminalAudioInterface()
    tools = ClientTools()
    tools.register(
        "get_verified_competing_quote",
        lambda _parameters: verified_competing_quote,
    )
    tools.register(
        "record_negotiation_event",
        lambda _parameters: {
            "recorded": False,
            "message": "Terminal voice check does not record outcomes; exact evidence and human verification are required.",
        },
    )
    ended = threading.Event()
    background_errors: list[BaseException] = []
    previous_thread_hook = threading.excepthook

    def thread_hook(args: threading.ExceptHookArgs) -> None:
        background_errors.append(args.exc_value)

    conversation = Conversation(
        client=ElevenLabs(api_key=api_key),
        agent_id=agent_id,
        requires_auth=True,
        audio_interface=audio,
        config=ConversationInitiationData(dynamic_variables=dynamic_variables),
        client_tools=tools,
        callback_user_transcript=lambda text: print(f"You: {text}", flush=True),
        callback_agent_response=lambda text: print(f"Negotiator: {text}", flush=True),
        callback_end_session=ended.set,
    )

    print("Starting the PolicyScout negotiation agent. Speak as the simulated insurance provider.")
    print("Press Ctrl-C to end. This live conversation uses ElevenLabs credits.\n")
    threading.excepthook = thread_hook
    started = False
    try:
        try:
            conversation.start_session()
            started = True
            while conversation._thread is not None and conversation._thread.is_alive():
                time.sleep(0.2)
        except KeyboardInterrupt:
            print("\nEnding conversation...")
        finally:
            conversation.end_session()
            if started:
                conversation_id = conversation.wait_for_session_end()
            else:
                conversation_id = None
    finally:
        threading.excepthook = previous_thread_hook

    if audio.error is not None:
        raise RuntimeError(f"Audio session failed: {audio.error}") from audio.error
    if background_errors:
        raise RuntimeError(f"Conversation session failed: {background_errors[0]}") from background_errors[0]
    if not ended.is_set():
        raise RuntimeError("Conversation ended unexpectedly before the SDK completed cleanup.")
    return conversation_id


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    root = Path.cwd()
    load_env(root)
    api_key = required_env("ELEVENLABS_API_KEY")
    agent_id = required_env("ELEVENLABS_NEGOTIATOR_AGENT_ID")
    session_path = args.session if args.session.is_absolute() else root / args.session
    session = load_session(session_path)
    dynamic_variables = build_dynamic_variables(session)

    if args.check:
        print("ElevenLabs negotiation terminal configuration is ready (no credits used).")
        return 0

    verified_competing_quote = build_verified_competing_quote_response(session)
    conversation_id = run_live(api_key, agent_id, dynamic_variables, verified_competing_quote)
    suffix = f" Conversation ID: {conversation_id}" if conversation_id else ""
    print(f"Conversation ended.{suffix}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print(f"ElevenLabs terminal conversation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
