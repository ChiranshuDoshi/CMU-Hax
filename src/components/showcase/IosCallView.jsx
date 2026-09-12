"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Microphone, MicrophoneSlash, Phone, PhoneDisconnect, SpinnerGap } from "@phosphor-icons/react";
import { api } from "./api.js";

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 4000,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "72px 24px 56px",
  color: "#fff",
  background: "radial-gradient(120% 80% at 50% -10%, #2b3a37 0%, #131b1a 45%, #05090880 75%), rgba(4,8,7,0.72)",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  textAlign: "center",
};

const avatarStyle = {
  width: 116,
  height: 116,
  borderRadius: "50%",
  background: "linear-gradient(160deg, #0e8f80, #075e56)",
  display: "grid",
  placeItems: "center",
  fontSize: 44,
  fontWeight: 600,
  letterSpacing: 1,
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  margin: "0 auto 22px",
};

function circleButton(background) {
  return {
    width: 74,
    height: 74,
    borderRadius: "50%",
    border: "none",
    background,
    color: "#fff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  };
}

const buttonColumn = { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, fontSize: 13, opacity: 0.92 };

export function IosCallView(props) {
  // @elevenlabs/react requires useConversation() to run inside a ConversationProvider.
  return (
    <ConversationProvider>
      <IosCall {...props} />
    </ConversationProvider>
  );
}

function IosCall({ callContext, negotiation, onConnected, onEnded, onError }) {
  const [phase, setPhase] = useState("incoming"); // incoming | connecting | active | ended
  const [captions, setCaptions] = useState([]);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const startedRef = useRef(false);
  const conversationIdRef = useRef(null);
  const endedRef = useRef(false);
  const autoEndTimerRef = useRef(null);
  const agentSummaryHistoryRef = useRef([]);
  const conversation = useConversation();

  useEffect(() => {
    if (phase !== "active") return undefined;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => window.clearTimeout(autoEndTimerRef.current), []);

  // Ends the call exactly once (button, agent close, or disconnect), then hands
  // off to the result page via onEnded.
  function finishCall() {
    if (endedRef.current) return;
    endedRef.current = true;
    window.clearTimeout(autoEndTimerRef.current);
    setPhase("ended");
    try { conversation.endSession?.(); } catch { /* ignore */ }
    onEnded?.(conversationIdRef.current);
  }

  // After the agent records the confirmed deal it closes verbally; give it a
  // moment to finish speaking, then drop the call so we advance to the result.
  function scheduleAutoEnd(delayMs = 5000) {
    if (endedRef.current || autoEndTimerRef.current) return;
    autoEndTimerRef.current = window.setTimeout(finishCall, delayMs);
  }

  async function answer() {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      startedRef.current = false;
      setPhase("incoming");
      onError?.("Microphone access is required to take the call.");
      return;
    }

    const cred = callContext.credential;
    const callbacks = {
      dynamicVariables: callContext.dynamicVariables,
      clientTools: {
        get_verified_competing_quote: () => JSON.stringify({
          allowedLeverageText: "No verified comparable quote is available; do not cite competitor pricing.",
          verifiedComparableMonthlyEffectiveCost: "not available",
        }),
        record_negotiation_event: async (parameters) => {
          // The deal is confirmed — drop the call shortly after the agent's close
          // so it can't loop the summary.
          scheduleAutoEnd();
          try {
            await api.recordNegotiationEvent(parameters);
            return JSON.stringify({ accepted: true, requiresHumanReview: true, ingested: true });
          } catch {
            return JSON.stringify({ accepted: false, requiresHumanReview: true, ingested: false });
          }
        },
      },
      onConnect: ({ conversationId }) => {
        conversationIdRef.current = conversationId;
        setPhase("active");
        onConnected?.(conversationId);
      },
      onMessage: ({ message, role }) => {
        if (!message) return;
        setCaptions((current) => [...current.slice(-6), { role, message }]);
        // Backstop: if the agent repeats a long summary, it's stuck validating —
        // conclude the call so we don't loop forever.
        if (role === "agent") {
          const normalized = message.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          if (normalized.length > 90) {
            if (agentSummaryHistoryRef.current.includes(normalized)) scheduleAutoEnd(2500);
            agentSummaryHistoryRef.current = [...agentSummaryHistoryRef.current.slice(-4), normalized];
          }
        }
      },
      onError: (message) => {
        onError?.(typeof message === "string" ? message : "The call ran into an error.");
      },
      onDisconnect: () => {
        finishCall();
      },
    };

    try {
      if (cred.transport === "webrtc") {
        await conversation.startSession({ conversationToken: cred.conversationToken, connectionType: "webrtc", ...callbacks });
      } else {
        await conversation.startSession({ signedUrl: cred.signedUrl, connectionType: "websocket", ...callbacks });
      }
    } catch (cause) {
      startedRef.current = false;
      setPhase("incoming");
      onError?.(cause?.message || "Could not connect the call.");
    }
  }

  function hangUp() {
    finishCall();
  }

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    try { await conversation.setMicMuted?.(next); } catch { /* best effort */ }
  }

  const providerName = negotiation?.providerName ?? "Insurance provider";
  const lastCaption = captions[captions.length - 1];
  const statusText =
    phase === "incoming"
      ? "PolicyScout Negotiator — incoming call"
      : phase === "connecting"
        ? "Connecting…"
        : phase === "active"
          ? formatClock(seconds)
          : "Call ended · preparing your results";

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="PolicyScout negotiation call">
      <div>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 14, letterSpacing: 0.4 }}>PolicyScout</p>
        <div style={avatarStyle} aria-hidden="true">PS</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 30, fontWeight: 600 }}>PolicyScout Negotiator</h2>
        <p style={{ margin: 0, opacity: 0.82, fontSize: 16 }}>{statusText}</p>
        <p style={{ margin: "6px 0 0", opacity: 0.6, fontSize: 14 }}>Negotiating against {providerName}</p>
        {phase === "incoming" && (
          <p style={{ margin: "18px auto 0", maxWidth: 320, opacity: 0.72, fontSize: 13, lineHeight: 1.5 }}>
            Answer and role-play the insurance rep. The agent will negotiate your quote down — try to hold your price, then give ground.
          </p>
        )}
      </div>

      <div style={{ minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: 460 }}>
        {phase === "active" && lastCaption && (
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.45, opacity: 0.95 }}>
            <strong style={{ opacity: 0.7 }}>{lastCaption.role === "agent" ? "Agent" : "You"}:</strong> {lastCaption.message}
          </p>
        )}
        {phase === "active" && !lastCaption && (
          <p style={{ margin: 0, opacity: 0.6 }}>Listening… say hello as the insurance rep.</p>
        )}
        {phase === "ended" && (
          <p style={{ margin: 0, display: "inline-flex", gap: 10, alignItems: "center", opacity: 0.85 }}>
            <SpinnerGap className="spin" size={20} weight="bold" /> Transcribing and saving the recording…
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 64, alignItems: "flex-end", justifyContent: "center" }}>
        {phase === "incoming" && (
          <>
            <div style={buttonColumn}>
              <button type="button" style={circleButton("#ff3b30")} onClick={() => onEnded?.(null)} aria-label="Decline call"><PhoneDisconnect size={30} weight="fill" /></button>
              <span>Decline</span>
            </div>
            <div style={buttonColumn}>
              <button type="button" style={circleButton("#34c759")} onClick={answer} aria-label="Answer call"><Phone size={30} weight="fill" /></button>
              <span>Answer</span>
            </div>
          </>
        )}
        {phase === "connecting" && (
          <div style={buttonColumn}>
            <button type="button" style={circleButton("#ff3b30")} onClick={hangUp} aria-label="Cancel call"><PhoneDisconnect size={30} weight="fill" /></button>
            <span>Cancel</span>
          </div>
        )}
        {phase === "active" && (
          <>
            <div style={buttonColumn}>
              <button type="button" style={circleButton(muted ? "#8e8e93" : "rgba(255,255,255,0.16)")} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>{muted ? <MicrophoneSlash size={26} weight="fill" /> : <Microphone size={26} weight="fill" />}</button>
              <span>{muted ? "Muted" : "Mute"}</span>
            </div>
            <div style={buttonColumn}>
              <button type="button" style={circleButton("#ff3b30")} onClick={hangUp} aria-label="End call"><PhoneDisconnect size={30} weight="fill" /></button>
              <span>End</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
