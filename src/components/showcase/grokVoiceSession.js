/**
 * Browser Grok Voice (xAI Realtime) session for the in-app negotiation call.
 * Streams mic PCM to the WebSocket and plays assistant PCM audio back.
 */

import { looksLikeNegotiationClose, shouldAutoEndCall } from "./negotiationClose.js";

const SAMPLE_RATE = 24000;

function floatTo16BitPCM(float32) {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const RECOVERABLE_ERROR = /active response|already in progress|cancelled|canceled|interruption|conversation already|no item/i;

function downsampleTo24k(float32, inputRate) {
  if (inputRate === SAMPLE_RATE) return float32;
  const ratio = inputRate / SAMPLE_RATE;
  const length = Math.floor(float32.length / ratio);
  const result = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    result[i] = float32[Math.floor(i * ratio)] ?? 0;
  }
  return result;
}

export function createGrokVoiceSession({
  credential,
  clientTools,
  onSessionId,
  onMessage,
  onError,
  onDisconnect,
  onHangup,
}) {
  let ws = null;
  let mediaStream = null;
  let captureContext = null;
  let playbackContext = null;
  let processor = null;
  let source = null;
  let muted = false;
  let closed = false;
  let startedSpeaking = false;
  let waitingForSessionUpdate = Boolean(credential.session);
  let responseInFlight = false;
  let continueAfterResponse = false;
  let nextPlayTime = 0;
  let pcmCarry = new Uint8Array(0);
  let agentSpeaking = false;
  let hangupRequested = false;
  let hangupTimer = null;
  let sessionId = crypto.randomUUID();
  const playingNodes = new Set();
  const pendingToolCalls = new Map();
  const transcript = [];
  const startedAt = Date.now();

  function timeInCallSecs() {
    return Math.max(0, (Date.now() - startedAt) / 1000);
  }

  function emitMessage(role, message) {
    onMessage?.({ role, message });
  }

  /** Agent audio transcript arrives as small deltas — append into the open turn. */
  function appendAgentDelta(delta) {
    const chunk = String(delta ?? "");
    if (!chunk) return;
    const last = transcript[transcript.length - 1];
    if (last?.role === "agent" && !last.final) {
      last.message = `${last.message}${chunk}`.replace(/\s+/g, " ").trim();
      emitMessage("agent", last.message);
      return;
    }
    transcript.push({
      role: "agent",
      message: chunk.trim(),
      timeInCallSecs: timeInCallSecs(),
      final: false,
    });
    emitMessage("agent", chunk.trim());
  }

  function finalizeAgentTranscript(fullText) {
    const text = String(fullText ?? "").trim();
    if (!text) return;
    const last = transcript[transcript.length - 1];
    if (last?.role === "agent") {
      last.message = text;
      last.final = true;
      emitMessage("agent", text);
      return;
    }
    transcript.push({
      role: "agent",
      message: text,
      timeInCallSecs: timeInCallSecs(),
      final: true,
    });
    emitMessage("agent", text);
  }

  /**
   * User STT "updated"/"completed" send the full utterance so far (not deltas).
   * Replacing avoids "hello hello" when both fire with the same text.
   */
  function upsertUserTranscript(fullText, { final = false } = {}) {
    const text = String(fullText ?? "").trim();
    if (!text) return;
    const last = transcript[transcript.length - 1];
    if (last?.role === "user" && !last.final) {
      if (text === last.message) {
        if (final) last.final = true;
        emitMessage("user", last.message);
        return;
      }
      // Prefer the longer progressive transcript; ignore stale shorter updates.
      if (text.startsWith(last.message) || last.message.startsWith(text)) {
        last.message = text.length >= last.message.length ? text : last.message;
      } else {
        last.message = text;
      }
      if (final) last.final = true;
      emitMessage("user", last.message);
      return;
    }
    if (last?.role === "user") {
      const same =
        text === last.message ||
        text.startsWith(last.message) ||
        last.message.startsWith(text) ||
        text.includes(last.message);
      if (same) {
        last.message = text.length >= last.message.length ? text : last.message;
        if (final) last.final = true;
        emitMessage("user", last.message);
        return;
      }
    }
    transcript.push({
      role: "user",
      message: text,
      timeInCallSecs: timeInCallSecs(),
      final,
    });
    emitMessage("user", text);
  }

  /** True incremental STT chunks (delta events) — append into the open user turn. */
  function appendUserDelta(delta) {
    const chunk = String(delta ?? "");
    if (!chunk) return;
    const last = transcript[transcript.length - 1];
    if (last?.role === "user" && !last.final) {
      last.message = `${last.message}${chunk}`.replace(/\s+/g, " ").trim();
      emitMessage("user", last.message);
      return;
    }
    transcript.push({
      role: "user",
      message: chunk.trim(),
      timeInCallSecs: timeInCallSecs(),
      final: false,
    });
    emitMessage("user", chunk.trim());
  }

  function send(event) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  function userTurnCount() {
    return transcript.filter((turn) => turn.role === "user").length;
  }

  function lastAgentText() {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      if (transcript[i].role === "agent") return transcript[i].message;
    }
    return "";
  }

  function playbackRemainingMs() {
    if (!playbackContext || nextPlayTime <= 0) return 0;
    return Math.max(0, (nextPlayTime - playbackContext.currentTime) * 1000);
  }

  function finishFromAgent() {
    if (closed) return;
    (onHangup ?? onDisconnect)?.();
  }

  function flushHangupIfReady() {
    if (!hangupRequested || closed) return;
    if (responseInFlight) return;
    if (hangupTimer) window.clearTimeout(hangupTimer);
    const wait = playbackRemainingMs() + 450;
    hangupTimer = window.setTimeout(() => {
      if (closed) return;
      const extra = playbackRemainingMs();
      if (extra > 80) {
        hangupTimer = window.setTimeout(finishFromAgent, extra + 250);
        return;
      }
      finishFromAgent();
    }, wait);
  }

  function requestHangup() {
    if (closed || hangupRequested) {
      flushHangupIfReady();
      return;
    }
    hangupRequested = true;
    muted = true;
    agentSpeaking = true;
    mediaStream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    flushHangupIfReady();
  }

  function considerAutoEnd() {
    if (hangupRequested || closed) return;
    if (shouldAutoEndCall({ userTurns: userTurnCount(), lastAgentText: lastAgentText() })) {
      requestHangup();
    }
  }

  function canAcceptEndCall() {
    return userTurnCount() >= 2 || looksLikeNegotiationClose(lastAgentText());
  }

  function handleEndCall(event) {
    const accepted = canAcceptEndCall();
    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(
          accepted
            ? { ended: true }
            : { ended: false, reason: "Keep negotiating until a final rate is confirmed or refused twice." },
        ),
      },
    });
    if (accepted) {
      requestHangup();
      return;
    }
    requestResponse();
  }

  function requestResponse() {
    if (closed || hangupRequested || ws?.readyState !== WebSocket.OPEN) return;
    if (responseInFlight) {
      continueAfterResponse = true;
      return;
    }
    responseInFlight = true;
    send({ type: "response.create" });
  }

  function maybeStartSpeaking() {
    if (startedSpeaking || waitingForSessionUpdate) return;
    startedSpeaking = true;
    requestResponse();
  }

  function stopPlayback() {
    nextPlayTime = 0;
    pcmCarry = new Uint8Array(0);
    agentSpeaking = false;
    for (const node of playingNodes) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    playingNodes.clear();
  }

  async function ensurePlayback() {
    if (!playbackContext) {
      playbackContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    if (playbackContext.state === "suspended") await playbackContext.resume();
    return playbackContext;
  }

  async function playPcmBase64(base64) {
    try {
      const incoming = base64ToBytes(base64);
      if (!incoming.length) return;
      const merged = new Uint8Array(pcmCarry.length + incoming.length);
      merged.set(pcmCarry);
      merged.set(incoming, pcmCarry.length);
      const even = merged.byteLength - (merged.byteLength % 2);
      pcmCarry = even < merged.byteLength ? merged.slice(even) : new Uint8Array(0);
      if (even < 2) return;
      const int16 = new Int16Array(merged.buffer, merged.byteOffset, even / 2);
      const ctx = await ensurePlayback();
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i += 1) float32[i] = int16[i] / 0x8000;
      const audioBuffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
      audioBuffer.copyToChannel(float32, 0);
      const node = ctx.createBufferSource();
      node.buffer = audioBuffer;
      node.connect(ctx.destination);
      node.onended = () => playingNodes.delete(node);
      const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTime);
      playingNodes.add(node);
      node.start(startAt);
      nextPlayTime = startAt + audioBuffer.duration;
      agentSpeaking = true;
    } catch {
      /* A bad audio frame must not tear down the call. */
    }
  }

  async function handleToolCall(event) {
    const name = event.name;
    const callId = event.call_id;
    let args = {};
    try {
      args = event.arguments ? JSON.parse(event.arguments) : {};
    } catch {
      args = {};
    }

    pendingToolCalls.set(callId, name);
    let result;
    try {
      const handler = clientTools?.[name];
      result = handler ? await handler(args) : JSON.stringify({ error: `Unknown tool: ${name}` });
    } catch (cause) {
      result = JSON.stringify({ error: cause?.message || "Tool failed" });
    }

    send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: typeof result === "string" ? result : JSON.stringify(result),
      },
    });
    pendingToolCalls.delete(callId);
    if (pendingToolCalls.size === 0) requestResponse();
  }

  function handleServerEvent(event) {
    switch (event.type) {
      case "session.created":
        if (event.session?.id) sessionId = event.session.id;
        onSessionId?.(sessionId);
        maybeStartSpeaking();
        break;
      case "session.updated":
        waitingForSessionUpdate = false;
        if (event.session?.id) sessionId = event.session.id;
        onSessionId?.(sessionId);
        maybeStartSpeaking();
        break;
      case "conversation.created":
        if (event.conversation?.id) {
          sessionId = event.conversation.id;
          onSessionId?.(sessionId);
        }
        break;
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const chunk = event.delta ?? event.audio;
        if (chunk) {
          agentSpeaking = true;
          void playPcmBase64(chunk);
        }
        break;
      }
      case "response.output_audio_transcript.delta":
        if (event.delta) appendAgentDelta(event.delta);
        break;
      case "response.output_audio_transcript.done":
        if (event.transcript) finalizeAgentTranscript(event.transcript);
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) upsertUserTranscript(event.transcript, { final: true });
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) appendUserDelta(event.delta);
        break;
      case "conversation.item.input_audio_transcription.updated":
        if (event.transcript) upsertUserTranscript(event.transcript, { final: false });
        break;
      case "response.created":
        responseInFlight = true;
        break;
      case "response.done":
      case "response.output_audio.done":
        responseInFlight = event.type === "response.done" ? false : responseInFlight;
        if (event.type === "response.done") {
          if (!hangupRequested) agentSpeaking = false;
          if (continueAfterResponse && !hangupRequested) {
            continueAfterResponse = false;
            requestResponse();
          } else if (hangupRequested) {
            flushHangupIfReady();
          } else {
            considerAutoEnd();
          }
        }
        break;
      case "input_audio_buffer.speech_started":
        // Echo of the agent's own speakers must not cancel playback.
        if (agentSpeaking || hangupRequested) break;
        stopPlayback();
        break;
      case "response.function_call_arguments.done":
        if ((event.name ?? event.item?.name) === "end_call") {
          handleEndCall(event);
          break;
        }
        void handleToolCall(event);
        break;
      case "error": {
        const detail = event.error?.message || event.message || "Grok Voice error";
        responseInFlight = false;
        if (RECOVERABLE_ERROR.test(String(detail))) break;
        onError?.(detail);
        break;
      }
      default:
        break;
    }
  }

  async function startMic() {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    captureContext = new AudioContext();
    source = captureContext.createMediaStreamSource(mediaStream);
    processor = captureContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (audioEvent) => {
      if (closed || muted || hangupRequested || agentSpeaking || ws?.readyState !== WebSocket.OPEN) return;
      const input = audioEvent.inputBuffer.getChannelData(0);
      const downsampled = downsampleTo24k(input, captureContext.sampleRate);
      const pcm = floatTo16BitPCM(downsampled);
      send({ type: "input_audio_buffer.append", audio: arrayBufferToBase64(pcm) });
    };
    source.connect(processor);
    const silent = captureContext.createGain();
    silent.gain.value = 0;
    processor.connect(silent);
    silent.connect(captureContext.destination);
  }

  function connect() {
    return new Promise((resolve, reject) => {
      const protocols = [`xai-client-secret.${credential.clientSecret}`];
      ws = new WebSocket(credential.websocketUrl, protocols);
      ws.addEventListener("open", () => {
        if (credential.session) {
          send({ type: "session.update", session: credential.session });
        }
        resolve();
      });
      ws.addEventListener("error", () => reject(new Error("Could not connect to Grok Voice")));
      ws.addEventListener("message", (message) => {
        try {
          handleServerEvent(JSON.parse(message.data));
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.addEventListener("close", () => {
        if (!closed) onDisconnect?.();
      });
    });
  }

  return {
    getSessionId: () => sessionId,
    getTranscript: () =>
      transcript.map(({ role, message, timeInCallSecs }) => ({ role, message, timeInCallSecs })),
    async start() {
      await connect();
      await startMic();
      onSessionId?.(sessionId);
    },
    setMuted(next) {
      muted = Boolean(next);
      mediaStream?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    async end() {
      if (closed) return this.getTranscript();
      closed = true;
      hangupRequested = true;
      if (hangupTimer) window.clearTimeout(hangupTimer);
      try {
        processor?.disconnect();
        source?.disconnect();
      } catch {
        /* ignore */
      }
      mediaStream?.getTracks().forEach((track) => track.stop());
      try {
        await captureContext?.close();
      } catch {
        /* ignore */
      }
      try {
        await playbackContext?.close();
      } catch {
        /* ignore */
      }
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      return this.getTranscript();
    },
  };
}
