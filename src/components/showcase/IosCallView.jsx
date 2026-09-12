"use client";

import { useEffect, useRef, useState } from "react";
import { Microphone, MicrophoneSlash, Phone, PhoneDisconnect, SpinnerGap } from "@phosphor-icons/react";
import { api } from "./api.js";
import { createGrokVoiceSession } from "./grokVoiceSession.js";

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
  background: "radial-gradient(120% 80% at 50% -10%, #3a2e22 0%, #1a140c 45%, #120e0b80 75%), rgba(18,14,11,0.72)",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  textAlign: "center",
};

const avatarStyle = {
  width: 116,
  height: 116,
  borderRadius: "50%",
  background: "linear-gradient(160deg, #dcb978, #8a6425)",
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
  return <IosCall {...props} />;
}

function IosCall({ callContext, negotiation, onConnected, onEnded, onError }) {
  const [phase, setPhase] = useState("incoming"); // incoming | connecting | active | ended
  const [captions, setCaptions] = useState([]);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const startedRef = useRef(false);
  const conversationIdRef = useRef(null);
  const endedRef = useRef(false);
  const sessionRef = useRef(null);

  useEffect(() => {
    if (phase !== "active") return undefined;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => {
    void sessionRef.current?.end();
  }, []);

  async function finishCall() {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase("ended");
    const session = sessionRef.current;
    sessionRef.current = null;
    const conversationId = conversationIdRef.current || session?.getSessionId?.() || null;
    // Close the overlay immediately; wait for the saved transcript before
    // filling the dashboard so we don't show a canned outcome.
    onEnded?.(conversationId, null, { pending: true });
    const transcript = session ? await session.end() : [];
    try {
      if (conversationId) {
        const res = await api.completeCall({ conversationId, transcript });
        onEnded?.(conversationId, res.snapshot ?? null);
        return;
      }
    } catch {
      // Fall through and still open the dashboard.
    }
    onEnded?.(conversationId, null);
  }

  async function answer() {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("connecting");

    const cred = callContext?.credential;
    if (!cred || cred.transport !== "grok" || !cred.clientSecret) {
      startedRef.current = false;
      setPhase("incoming");
      onError?.("Live negotiation is not configured for this call.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      startedRef.current = false;
      setPhase("incoming");
      onError?.("Microphone access is required to take the call.");
      return;
    }

    const session = createGrokVoiceSession({
      credential: cred,
      onSessionId: (conversationId) => {
        if (!conversationId || conversationIdRef.current === conversationId) return;
        conversationIdRef.current = conversationId;
        setPhase("active");
        onConnected?.(conversationId);
      },
      onMessage: ({ message, role }) => {
        if (!message) return;
        // Update the open turn in place — STT/agent events re-send the full line.
        setCaptions((current) => {
          const last = current[current.length - 1];
          if (last?.role === role) {
            if (last.message === message) return current;
            return [...current.slice(0, -1), { role, message }];
          }
          return [...current.slice(-6), { role, message }];
        });
      },
      onError: (message) => {
        const detail = typeof message === "string" ? message : "The call ran into an error.";
        // Start-up failures still abort. Mid-call Grok errors are usually
        // recoverable (active response, barge-in) and must not unmount the UI.
        if (!sessionRef.current || endedRef.current) {
          onError?.(detail);
          return;
        }
        setCaptions((current) => [...current.slice(-5), { role: "agent", message: "One moment — still on the line." }]);
      },
      onHangup: () => {
        void finishCall();
      },
      onDisconnect: () => {
        void finishCall();
      },
    });

    sessionRef.current = session;
    try {
      await session.start();
      setPhase("active");
      if (!conversationIdRef.current) {
        conversationIdRef.current = session.getSessionId();
        onConnected?.(conversationIdRef.current);
      }
    } catch (cause) {
      startedRef.current = false;
      sessionRef.current = null;
      setPhase("incoming");
      onError?.(cause?.message || "Could not connect the call.");
    }
  }

  function hangUp() {
    void finishCall();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }

  const providerName = negotiation?.providerName ?? "Hotel sales";
  const lastCaption = captions[captions.length - 1];
  const statusText =
    phase === "incoming"
      ? "Atrium — incoming call"
      : phase === "connecting"
        ? "Connecting…"
        : phase === "active"
          ? formatClock(seconds)
          : "Call ended";

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Atrium negotiation call">
      <div>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 14, letterSpacing: 0.4 }}>Atrium</p>
        <div style={avatarStyle} aria-hidden="true">A</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 30, fontWeight: 600 }}>Atrium</h2>
        <p style={{ margin: 0, opacity: 0.82, fontSize: 16 }}>{statusText}</p>
        <p style={{ margin: "6px 0 0", opacity: 0.6, fontSize: 14 }}>Negotiating against {providerName}</p>
        {phase === "incoming" && (
          <p style={{ margin: "18px auto 0", maxWidth: 320, opacity: 0.72, fontSize: 13, lineHeight: 1.5 }}>
            Answer and role-play hotel sales. The agent will negotiate your nightly group rate down — try to hold your price, then give ground.
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
          <p style={{ margin: 0, opacity: 0.6 }}>Listening… say hello as hotel sales.</p>
        )}
        {phase === "ended" && (
          <p style={{ margin: 0, display: "inline-flex", gap: 10, alignItems: "center", opacity: 0.85 }}>
            <SpinnerGap className="spin" size={20} weight="bold" /> Saving the call…
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
              <button type="button" style={circleButton("#b8893d")} onClick={() => void answer()} aria-label="Answer call"><Phone size={30} weight="fill" /></button>
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
