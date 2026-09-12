import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowUpRight,
  Bed,
  Check,
  CheckCircle,
  FileText,
  Headphones,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  Pause,
  PhoneCall,
  Play,
  SealCheck,
  ShieldCheck,
  SpinnerGap,
  Star,
  Target,
  UserPlus,
  WarningCircle,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { api, toCarProfile } from "./api.js";
import { HOTELS, PRICE_STEPS } from "./data.js";
import { hotelImageFor, hotelTintFor } from "./hotelImage.js";
import { IosCallView } from "./IosCallView.jsx";
import { Waveform } from "./Waveform.jsx";

const STEP_META = {
  vehicle: { index: 1, label: "Stay profile", title: "Set up your group stay", description: "Confirm the details hotels need to return comparable group rates." },
  calling: { index: 2, label: "Hotels found", title: "Hotels and aggregator prices", description: "Review the properties StayScout found, then choose which ones to call." },
  agentcalls: { index: 3, label: "Agent quotes", title: "StayScout called the hotels", description: "Every hotel came back under its public aggregator price. Listen to the calls." },
  quotes: { index: 4, label: "Compare", title: "Negotiated group rates, normalized", description: "Choose an offer and set the private target for the live negotiation." },
  negotiating: { index: 5, label: "Negotiate", title: "Negotiator is working the selected hotel", description: "The target stays private while verified concessions are recorded." },
  result: { index: 6, label: "Evidence", title: "A better group rate, with the proof", description: "Review the outcome, unchanged stay details, full call, and decisive moments." },
};

const NAV_ITEMS = [
  { id: "vehicle", label: "Stay profile", icon: Bed },
  { id: "calling", label: "Hotels found", icon: MagnifyingGlass },
  { id: "agentcalls", label: "Agent quotes", icon: Headphones },
  { id: "quotes", label: "Compare", icon: ListChecks },
  { id: "negotiating", label: "Negotiate", icon: PhoneCall },
  { id: "result", label: "Evidence", icon: FileText },
];

const TOTAL_STEPS = NAV_ITEMS.length;

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrency(value) {
  return CURRENCY.format(Number(value) || 0);
}

function initials(name) {
  return (name || "You")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "You";
}

function formatClock(seconds) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Plays the real ElevenLabs call recording (proxied through the BFF) via a
// native <audio> element, replacing the simulated speech-synthesis player.
function RecordingPlayer({ url }) {
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => undefined);
    else audio.pause();
  }

  function seekToClientX(clientX) {
    const audio = audioRef.current;
    const bar = barRef.current;
    if (!audio || !bar || !audio.duration) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = fraction * audio.duration;
    setProgress(fraction);
  }

  function onBarPointerDown(event) {
    event.preventDefault();
    seekToClientX(event.clientX);
    const move = (moveEvent) => seekToClientX(moveEvent.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onBarKeyDown(event) {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    if (event.key === "ArrowRight") { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); event.preventDefault(); }
    else if (event.key === "ArrowLeft") { audio.currentTime = Math.max(0, audio.currentTime - 5); event.preventDefault(); }
  }

  return (
    <div className="audio-player">
      <div className="audio-label"><span>Full negotiation recording</span><small>{duration ? formatClock(duration) : "—:—"}</small></div>
      <Waveform active={playing} progress={progress} />
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
        }}
        onEnded={() => { setPlaying(false); setProgress(1); }}
      />
      <div className="audio-controls">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause recording" : "Play recording"}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek recording"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onPointerDown={onBarPointerDown}
          onKeyDown={onBarKeyDown}
          style={{ padding: "9px 0", cursor: "pointer", touchAction: "none" }}
        >
          <div className="audio-progress" ref={barRef}><span style={{ transform: `scaleX(${progress})` }} /><i style={{ left: `${progress * 100}%` }} /></div>
        </div>
        <span>{formatClock(progress * duration)}</span>
      </div>
    </div>
  );
}

function SourceLabel({ type, children }) {
  const Icon = type === "declaration" ? FileText : type === "hidden" ? LockKey : type === "required" ? WarningCircle : CheckCircle;
  return <span className={`source-label source-label--${type}`}><Icon size={12} weight={type === "hidden" ? "fill" : "regular"} /> {children}</span>;
}

function StepHeader({ step }) {
  const meta = STEP_META[step];
  return (
    <header className="demo-header">
      <div>
        <p className="eyebrow">Step {meta.index} of {TOTAL_STEPS} · {meta.label}</p>
        <h2>{meta.title}</h2>
        <p>{meta.description}</p>
      </div>
      <div className="step-context" aria-label="Stay context">
        <span>Case STAY-8K42</span>
        <small>Live workflow</small>
      </div>
    </header>
  );
}

function SignupGate({ onRequireSignup }) {
  return (
    <motion.div className="vehicle-view view-enter" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="call-sheet" style={{ display: "grid", placeItems: "center", textAlign: "center", padding: "64px 32px", gap: 18 }}>
        <span className="section-kicker">Account required</span>
        <h3 style={{ margin: 0 }}>Create your StayScout account to start</h3>
        <p style={{ maxWidth: 460, color: "var(--ink-soft)" }}>
          Sign up first, then enter your group stay details. StayScout will research hotels for your destination, collect group rates, and negotiate the best one down to your private target.
        </p>
        <button className="primary-button" type="button" onClick={onRequireSignup}>
          <UserPlus size={16} weight="bold" /> Sign up to begin
        </button>
      </section>
    </motion.div>
  );
}

function VehicleView({ profile, setProfile, bodyType, setBodyType, driverName, onStart, busy, error }) {
  function updateField(field, value) {
    setProfile((current) => {
      const next = { ...current, [field]: value };
      if (field === "rooms") next.mileage = value;
      if (field === "budget") {
        const match = String(value).match(/(\d{2,4})/);
        next.premium = match ? `$${match[1]}` : current.premium || "$248";
      }
      if (field === "location") {
        const city = String(value).split(",")[0]?.trim() || "Chicago";
        next.make = city;
        const stateMatch = String(value).match(/,\s*([A-Za-z]{2})\b/);
        if (stateMatch) next.state = stateMatch[1].toUpperCase();
      }
      return next;
    });
  }

  function selectRoomType(type) {
    setBodyType(type);
    setProfile((current) => ({ ...current, model: type }));
  }

  return (
    <motion.div className="vehicle-view view-enter" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <form className="vehicle-form call-sheet" onSubmit={onStart}>
        <div className="form-section-head call-sheet-head">
          <div>
            <span className="section-kicker">Agent-ready call sheet</span>
            <h3>Group, room, and stay facts</h3>
            <p>Only confirmed facts will be sent to hotel sales teams.</p>
          </div>
          <div className="sheet-head-actions"><div className="readiness-summary"><strong>12 / 12</strong><span>required facts ready</span></div><button className="primary-button" type="submit" disabled={busy}>{busy ? <><SpinnerGap className="spin" size={16} weight="bold" /> Researching…</> : <>Start research <ArrowRight size={16} weight="bold" /></>}</button></div>
        </div>

        {error && <div className="disclosure-rule" role="alert" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}><WarningCircle size={16} weight="fill" /><span><strong>Could not start research</strong>{error}</span></div>}

        <div className="call-sheet-section">
          <div className="sheet-section-title"><span>01</span><div><strong>Hotel &amp; room preferences</strong><small>Required for availability and group pricing</small></div></div>
          <div className="body-type-row">
            <span><strong>Room type</strong><SourceLabel type="user">Group confirmed</SourceLabel></span>
            <div className="body-type-control" aria-label="Preferred room type">
              {["Standard", "Deluxe", "Ultra deluxe"].map((type) => (
                <button className={bodyType === type ? "segment segment--active" : "segment"} type="button" key={type} aria-pressed={bodyType === type} onClick={() => selectRoomType(type)}>
                  <Bed size={17} weight={bodyType === type ? "fill" : "regular"} /> {type}
                </button>
              ))}
            </div>
          </div>

          <div className="field-grid">
            <label><span>Hotel class <SourceLabel type="user">Group confirmed</SourceLabel></span><input name="stars" value={profile.stars} onChange={(event) => updateField("stars", event.target.value)} autoComplete="off" /></label>
            <label><span>Location <SourceLabel type="user">Group confirmed</SourceLabel></span><input name="location" value={profile.location} onChange={(event) => updateField("location", event.target.value)} autoComplete="off" /></label>
            <label><span>Check-in / check-out <SourceLabel type="declaration">Event itinerary</SourceLabel></span><input name="dates" value={profile.dates} onChange={(event) => updateField("dates", event.target.value)} autoComplete="off" /></label>
            <label><span>Number of rooms <SourceLabel type="required">Sales required</SourceLabel></span><input name="rooms" value={profile.rooms} onChange={(event) => updateField("rooms", event.target.value)} inputMode="numeric" autoComplete="off" /></label>
            <label><span>Guests per room <SourceLabel type="user">Group confirmed</SourceLabel></span><input name="guests" value={profile.guests} onChange={(event) => updateField("guests", event.target.value)} inputMode="numeric" autoComplete="off" /></label>
            <label><span>Nightly price range <SourceLabel type="hidden">Hidden first round</SourceLabel></span><input name="budget" value={profile.budget} onChange={(event) => updateField("budget", event.target.value)} autoComplete="off" /></label>
          </div>
        </div>

        <div className="call-sheet-section call-sheet-section--compact">
          <div className="sheet-section-title"><span>02</span><div><strong>Group &amp; booking needs</strong><small>Details that affect the group offer</small></div></div>
          <div className="fact-ledger">
            <div><span>Group organizer</span><strong>{driverName}</strong><SourceLabel type="user">Group confirmed</SourceLabel></div>
            <div><span>Guest total</span><strong>{Number(profile.rooms) * Number(profile.guests) || 48} guests</strong><SourceLabel type="required">Sales required</SourceLabel></div>
            <div><span>Meeting space</span><strong>1 breakout room</strong><SourceLabel type="user">Group confirmed</SourceLabel></div>
          </div>
        </div>

        <div className="call-sheet-section call-sheet-section--compact">
          <div className="sheet-section-title"><span>03</span><div><strong>Stay baseline</strong><small>Every hotel receives the same inclusions</small></div><SourceLabel type="declaration">Event brief</SourceLabel></div>
          <div className="coverage-baseline" aria-label="Stay baseline">
            <div><span>Breakfast</span><strong>Included daily</strong></div>
            <div><span>Facilities</span><strong>Pool &amp; gym</strong></div>
            <div><span>Wi-Fi</span><strong>Included</strong></div>
            <div><span>Cancellation</span><strong>14-day flexible</strong></div>
          </div>
        </div>

        <div className="form-actions">
          <div className="disclosure-rule"><LockKey size={16} weight="fill" /><span><strong>First-round disclosure rule</strong>Your budget range and target stay private until you approve a negotiation.</span></div>
        </div>
      </form>

      <aside className="vehicle-identity vehicle-dossier">
        <div className="dossier-head"><span className="section-kicker">Stay dossier</span><span className="dossier-id">Request STAY-8K42</span></div>
        <div className="vehicle-image-wrap"><img src="/assets/hotel-dossier.webp" width="640" height="442" alt="Contemporary Chicago hotel exterior" /></div>
        <div className="vehicle-meta">
          <h3>{profile.stars} · {profile.location}</h3>
          <p>{bodyType} rooms · Group booking · 3 nights</p>
          <dl>
            <div><dt>Dates</dt><dd>{profile.dates}</dd></div>
            <div><dt>Rooms</dt><dd>{profile.rooms} requested</dd></div>
            <div><dt>Guests</dt><dd>{Number(profile.rooms) * Number(profile.guests) || 48} total</dd></div>
          </dl>
        </div>
        <div className="dossier-evidence">
          <div><FileText size={16} /><span><strong>Event brief parsed</strong><small>8 stay and group facts</small></span></div>
          <div><CheckCircle size={16} /><span><strong>Group confirmation complete</strong><small>4 room and guest facts</small></span></div>
          <div><LockKey size={16} /><span><strong>Private budget isolated</strong><small>Not included in first-round call scripts</small></span></div>
        </div>
        <div className="dossier-footer"><span>Request status</span><strong><CheckCircle size={15} weight="fill" /> Ready for hotel research</strong></div>
      </aside>
    </motion.div>
  );
}

/** Placeholder hotel photo with a deterministic gradient behind it. */
function HotelThumb({ name, size = 46 }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span
      className="hotel-thumb"
      style={{ width: size, height: size, background: hotelTintFor(name) }}
      aria-hidden="true"
    >
      <img
        src={hotelImageFor(name)}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0 }}
      />
      {!loaded && <i>{name.slice(0, 1)}</i>}
    </span>
  );
}

function CallingView({ calls, complete, live, onContinue, locationLabel, selectedHotels, onToggleHotel, busy }) {
  const completedCount = calls.filter((call) => call.status === "Verified").length;
  const total = calls.length || 5;
  const progress = (completedCount / total) * 100;
  const place = locationLabel || "your destination";
  const chosen = calls.filter((call) => selectedHotels.has(call.quoteId)).length;

  return (
    <motion.div className="calling-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="call-board" aria-live="polite" aria-busy={!complete}>
        <div className="call-board-head">
          <div><span className="section-kicker">Querit hotel search &amp; aggregator pricing</span><h3>{complete ? "Individual hotels priced across aggregators" : `${completedCount} of ${total} hotels priced`}</h3><p>StayScout searches Querit for real hotel properties in {place}, then checks Booking, Expedia, Hotels.com, Kayak, and Tripadvisor for nightly rates. Choose the hotels you want StayScout to call.</p></div>
          <span className="live-indicator"><span /> {complete ? "Complete" : "Agent active"}</span>
        </div>
        <div className="progress-track" aria-hidden="true"><motion.span initial={false} animate={{ scaleX: progress / 100 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} /></div>

        <div className="call-list">
          <div className="call-table-head call-table-head--picker"><span>#</span><span>Hotel</span><span>Rating evidence</span><span>Aggregator rates</span><span>Best nightly</span><span>Call</span></div>
          {calls.map((call, index) => {
            const picked = selectedHotels.has(call.quoteId);
            const priced = call.status === "Verified" && call.annual != null;
            return (
              <label className={picked ? "call-row call-row--picked" : "call-row"} key={call.id} style={{ opacity: priced ? 1 : 0.78 }}>
                <span className="call-order">0{index + 1}</span>
                <div className="call-provider"><HotelThumb name={call.name} size={64} /><span><strong>{call.name}</strong><small>{place} · {call.roomType || "individual property"}</small></span></div>
                <div className="rating-source"><strong><Star size={13} weight="fill" /> {call.rating ?? "—"}</strong><SourceLabel type="declaration">{call.reviews} reviews</SourceLabel></div>
                <div className="aggregator-cell">
                  {call.aggregators?.length ? call.aggregators.slice(0, 4).map((agg) => (
                    <span className="aggregator-chip" key={agg.name}><em>{agg.name}</em><strong>{formatCurrency(agg.nightly)}</strong></span>
                  )) : <small>{priced ? "Market estimate" : "Checking aggregators…"}</small>}
                </div>
                <span className="call-price">{priced ? <><strong>{formatCurrency(call.annual)}</strong><small>lowest of {call.aggregators?.length || 1} · per night</small></> : <><span className="pending-line" /><small>Pricing…</small></>}</span>
                <span className="radio-wrap"><input type="checkbox" name="callHotel" value={call.quoteId} checked={picked} disabled={!priced} onChange={() => onToggleHotel(call.quoteId)} /><i /></span>
              </label>
            );
          })}
        </div>

        <div className="call-board-footer">
          <span><ShieldCheck size={15} /> Dates, rooms, and inclusions locked across every call</span>
          <button className="primary-button" type="button" disabled={!complete || chosen === 0 || busy} onClick={onContinue}>
            {busy ? <><SpinnerGap className="spin" size={16} weight="bold" /> Calling hotels…</> : <>Call {chosen || ""} {chosen === 1 ? "hotel" : "hotels"} <PhoneCall size={17} weight="fill" /></>}
          </button>
        </div>
      </section>

      <aside className="research-evidence">
        <p className="section-kicker">Research basis</p>
        <h3>Why these hotels</h3>
        <p>{live ? "Hotels were discovered with Querit from your stay params" : "Demo hotels matched your stay params"} and priced on major aggregators.</p>
        <ol>
          <li><span className="evidence-index">01</span><span><strong>Stay search</strong>City, room count, class, and dates.</span><SourceLabel type="user">Matched</SourceLabel></li>
          <li><span className="evidence-index">02</span><span><strong>Aggregator rates</strong>Booking, Expedia, Hotels.com, Kayak, Tripadvisor.</span><SourceLabel type="declaration">Querit</SourceLabel></li>
          <li><span className="evidence-index">03</span><span><strong>You pick the calls</strong>StayScout only calls the hotels you check.</span><SourceLabel type={chosen > 0 ? "user" : "required"}>{chosen > 0 ? `${chosen} selected` : "Select hotels"}</SourceLabel></li>
        </ol>
        <div className="evidence-policy-note"><FileText size={16} /><span><strong>Evidence standard</strong>Nightly rates prefer aggregator snippets; estimates are labeled when a price cannot be parsed.</span></div>
      </aside>
    </motion.div>
  );
}


/**
 * Streams a Grok-generated negotiation recording. The clip is synthesized on
 * demand (a few seconds), so fetching is deferred until the user hits play.
 */
function AgentCallRecording({ url, label }) {
  const audioRef = useRef(null);
  const [state, setState] = useState("ready");
  const [progress, setProgress] = useState(0);

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    document.querySelectorAll("audio[data-agent-call]").forEach((other) => {
      if (other !== audio) other.pause();
    });
    audio.play().then(() => setState("playing")).catch(() => setState("ready"));
  }

  return (
    <div className="agent-recording">
      <div className="agent-recording-controls">
        <button
          type="button"
          className="call-audio-button"
          onClick={toggle}
          disabled={!url}
          aria-label={state === "playing" ? `Pause ${label} negotiation recording` : `Play ${label} negotiation recording`}
        >
          {state === "playing" ? <Pause size={11} weight="fill" /> : <Play size={11} weight="fill" />}
        </button>
        <Waveform active={state === "playing"} compact progress={progress} playedColor="#71e0c1" unplayedColor="rgba(213, 226, 221, 0.22)" label={`${label} negotiation waveform`} />
        <small>{state === "playing" ? "Playing" : url ? "Call recording" : "Recording unavailable"}</small>
      </div>
      <audio
        ref={audioRef}
        src={url || undefined}
        preload="auto"
        data-agent-call
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
        }}
        onPause={() => setState((current) => (current === "playing" ? "ready" : current))}
        onEnded={() => { setState("ready"); setProgress(0); }}
      />
    </div>
  );
}

function AgentCallsLoadingView({ hotels, locationLabel }) {
  const place = locationLabel || "your destination";
  return (
    <motion.div className="agent-calls-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="call-board" aria-busy="true" aria-live="polite">
        <div className="call-board-head">
          <div>
            <span className="section-kicker">Calling hotels</span>
            <h3>StayScout is calling the hotels</h3>
            <p>Group rates are coming back for {place}. This page opens when every call is finished.</p>
          </div>
          <span className="live-indicator"><span /> {hotels.length} {hotels.length === 1 ? "call" : "calls"} in progress</span>
        </div>
        <div className="agent-loading-list">
          {hotels.map((hotel, index) => (
            <div className="agent-loading-row" key={hotel.quoteId || hotel.id || hotel.name}>
              <HotelThumb name={hotel.name} size={52} />
              <div>
                <strong>{hotel.name}</strong>
                <small>On the line with group sales</small>
              </div>
              <SpinnerGap className="spin" size={18} weight="bold" />
              <span className="agent-call-index">0{index + 1}</span>
            </div>
          ))}
        </div>
      </section>
      <aside className="research-evidence">
        <p className="section-kicker">What is happening</p>
        <h3>No live hotel call yet</h3>
        <p>StayScout is asking each hotel for a group rate on the same dates, rooms, and inclusions.</p>
        <ol>
          <li><span className="evidence-index">01</span><span><strong>Group rate</strong>Targeted 10–18% under the best aggregator price.</span><SourceLabel type="declaration">In progress</SourceLabel></li>
          <li><span className="evidence-index">02</span><span><strong>Call recording</strong>Each finished call is saved before this screen advances.</span><SourceLabel type="declaration">Recording</SourceLabel></li>
        </ol>
      </aside>
    </motion.div>
  );
}

function AgentCallsView({ agentCalls, locationLabel, onContinue, busy }) {
  const totalSaved = agentCalls.reduce((sum, call) => sum + (call.totalSaved || 0), 0);
  const bestPct = agentCalls.reduce((best, call) => Math.max(best, call.savedPct || 0), 0);
  const place = locationLabel || "your destination";

  return (
    <motion.div className="agent-calls-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="call-board">
        <div className="call-board-head">
          <div>
            <span className="section-kicker">First-round agent calls</span>
            <h3>StayScout called {agentCalls.length} {agentCalls.length === 1 ? "hotel" : "hotels"} and got quotes</h3>
            <p>Each hotel was asked for a group rate on identical dates, room counts, and inclusions. Every quote came back below the best public aggregator price.</p>
          </div>
          <span className="live-indicator"><span /> {agentCalls.length} calls complete</span>
        </div>

        <div className="agent-savings-strip">
          <div><span>Best reduction</span><strong>{bestPct}%</strong><small>under aggregator price</small></div>
          <div><span>Quotes received</span><strong>{agentCalls.length}</strong><small>of {agentCalls.length} calls placed</small></div>
          <div><span>Group stay savings</span><strong>{formatCurrency(totalSaved)}</strong><small>across all rooms &amp; nights</small></div>
        </div>

        <div className="agent-call-list">
          {agentCalls.map((call, index) => (
            <article className="agent-call-card" key={call.providerId}>
              <div className="agent-call-head">
                <HotelThumb name={call.name} size={60} />
                <div className="agent-call-title">
                  <strong>{call.name}</strong>
                  <small>{place} · {call.roomType || "group block"} · {call.rooms} rooms × {call.nights} nights</small>
                </div>
                <span className="status-badge status-badge--verified"><SealCheck size={14} weight="fill" /> Quote received</span>
              </div>

              <div className="agent-price-compare">
                <div className="agent-price-col">
                  <span>Best aggregator</span>
                  <strong className="old-price">{formatCurrency(call.aggregatorLow)}</strong>
                  <small>{call.aggregatorName}</small>
                </div>
                <ArrowRight className="outcome-arrow" size={22} weight="bold" />
                <div className="agent-price-col agent-price-col--final">
                  <span>Agent-negotiated quote</span>
                  <strong>{formatCurrency(call.agentQuote)}</strong>
                  <small>per room / night</small>
                </div>
                <div className="agent-price-col agent-price-col--saved">
                  <span>Reduction</span>
                  <strong>{call.savedPct}%</strong>
                  <em>−{formatCurrency(call.saved)} / night</em>
                  <small><CheckCircle size={13} weight="fill" /> {formatCurrency(call.totalSaved)} group total</small>
                </div>
              </div>

              <div className="agent-call-footer">
                <span className="agent-concession"><Check size={13} weight="bold" /> {call.concession}</span>
                <AgentCallRecording url={call.recordingUrl} label={call.name} />
              </div>
              <span className="agent-call-index">0{index + 1}</span>
            </article>
          ))}
        </div>

        <div className="call-board-footer">
          <span><LockKey size={15} weight="fill" /> Your private target was never mentioned on these calls</span>
          <button className="primary-button" type="button" onClick={onContinue} disabled={busy}>Compare &amp; pick a hotel <ArrowRight size={17} weight="bold" /></button>
        </div>
      </section>

      <aside className="research-evidence">
        <p className="section-kicker">How these quotes were reached</p>
        <h3>First round, no target disclosed</h3>
        <p>StayScout opened with the public aggregator rate, confirmed the block size, and asked for a group tier.</p>
        <ol>
          <li><span className="evidence-index">01</span><span><strong>Anchored on public price</strong>The aggregator rate opened every call.</span><SourceLabel type="declaration">Querit</SourceLabel></li>
          <li><span className="evidence-index">02</span><span><strong>Block size leverage</strong>{agentCalls[0]?.rooms ?? 24} rooms across {agentCalls[0]?.nights ?? 3} nights.</span><SourceLabel type="user">Confirmed</SourceLabel></li>
          <li><span className="evidence-index">03</span><span><strong>Ceiling stayed hidden</strong>No target or budget was shared.</span><SourceLabel type="hidden">Private</SourceLabel></li>
        </ol>
        <div className="evidence-policy-note"><WarningCircle size={16} /><span><strong>Next step</strong>Pick a hotel and StayScout will negotiate the rate live.</span></div>
      </aside>
    </motion.div>
  );
}

function roomTypeLabel(quote) {
  if (typeof quote?.roomType === "string" && quote.roomType.trim()) return quote.roomType;
  if (typeof quote?.deductible === "string" && quote.deductible.trim() && Number.isNaN(Number(quote.deductible))) {
    return quote.deductible;
  }
  return HOTELS.find((hotel) => hotel.name === quote?.name)?.roomType ?? "Deluxe king";
}

function QuotesView({
  quotes,
  agentCalls,
  selectedProvider,
  setSelectedProvider,
  target,
  setTarget,
  presets,
  liveAvailable,
  onNegotiate,
  busy,
  error,
}) {
  // Only hotels that returned an agent quote are selectable here.
  const rows = agentCalls;
  const selectedCall = rows.find((call) => call.quoteId === selectedProvider) ?? rows[0];
  const best = rows.reduce((lowest, call) => (!lowest || call.agentQuote < lowest.agentQuote ? call : lowest), null);

  return (
    <motion.div className="quotes-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="quote-comparison">
        <div className="comparison-head">
          <div><span className="section-kicker">Agent-negotiated group rates</span><h3>Pick the hotel to negotiate live</h3><p>These are the quotes StayScout brought back from the first-round calls. Choose one and set a private target — the negotiator will then call it live.</p></div>
          <details className="evidence-drawer">
            <summary><FileText size={15} /> Evidence index <span>{rows.length * 4}</span></summary>
            <div><strong>Rate evidence</strong><p>Querit hotel discovery, aggregator price snippets, and the first-round agent call for each hotel.</p></div>
          </details>
        </div>
        {best && <div className="recommendation-strip"><span><SealCheck size={16} weight="fill" /></span><div><strong>System recommendation</strong><p>{best.name} has the strongest negotiated value: {formatCurrency(best.agentQuote)} per night, {best.savedPct}% under its best aggregator price, with {best.concession.toLowerCase()}.</p></div><small>Recommendation only · you decide</small></div>}
        <div className="quote-table" role="group" aria-label="Negotiated hotel group rates">
          <div className="quote-table-head quote-table-head--agent"><span>Hotel</span><span>Aggregator</span><span>Agent quote</span><span>Saved</span><span>Negotiate live</span></div>
          {rows.map((call) => {
            const primary = (selectedCall?.quoteId ?? null) === call.quoteId;
            const quote = quotes.find((item) => item.id === call.quoteId);
            return (
              <label className={primary ? "quote-row quote-row--selected" : "quote-row"} key={call.quoteId}>
                <span className="quote-provider"><HotelThumb name={call.name} size={52} /><span><strong>{call.name}</strong><small><Star size={12} weight="fill" /> {quote?.rating ?? "—"} · {roomTypeLabel(quote ?? { roomType: call.roomType })}</small></span>{best?.quoteId === call.quoteId && <em>Best rate</em>}</span>
                <span className="coverage-match"><strong className="old-price">{formatCurrency(call.aggregatorLow)}</strong><small style={{ display: "block" }}>{call.aggregatorName}</small></span>
                <span className="quote-amount"><strong>{formatCurrency(call.agentQuote)}</strong><small>per room / night</small></span>
                <span className="deductible-cell"><strong>{call.savedPct}%</strong><small>−{formatCurrency(call.saved)} / night</small></span>
                <span className="radio-wrap"><input type="radio" name="primaryHotel" value={call.quoteId} checked={primary} onChange={() => setSelectedProvider(call.quoteId)} /><i /></span>
              </label>
            );
          })}
        </div>
      </section>

      <aside className="target-panel">
        <div className="target-panel-head"><Target size={20} weight="fill" /><span><p className="section-kicker">Private negotiation goal</p><h3>Set your target</h3></span></div>
        <div className="selection-context"><span>Negotiating with</span><strong>{selectedCall?.name ?? "Select a hotel"}</strong><small>Agent quote {formatCurrency(selectedCall?.agentQuote)} / night · {selectedCall?.savedPct ?? 0}% already saved</small></div>
        <p>StayScout will push below the first-round quote without disclosing your ceiling. The other quotes stay available as leverage.</p>
        <label className="target-input"><span>$</span><input name="targetNightlyRate" aria-label="Target nightly room rate" value={target} onChange={(event) => setTarget(event.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="off" /><small>/ night</small></label>
        <div className="range-presets">
          {presets.map((amount) => <button className={Number(target) === amount ? "preset preset--active" : "preset"} type="button" key={amount} onClick={() => setTarget(String(amount))}>${amount.toLocaleString()}</button>)}
        </div>
        <div className="privacy-confirm"><SourceLabel type="hidden">Hidden from hotel</SourceLabel><span>Only the negotiator uses this threshold.</span></div>
        {liveAvailable && <p className="disclosure" style={{ margin: "4px 0 0" }}>StayScout will place an in-app voice call so you can negotiate live with hotel sales.</p>}
        {error && <div className="disclosure-rule" role="alert" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}><WarningCircle size={16} weight="fill" /><span>{error}</span></div>}
        <button className="primary-button primary-button--wide" type="button" onClick={onNegotiate} disabled={busy || !selectedCall}>{busy ? <><SpinnerGap className="spin" size={17} weight="bold" /> Starting…</> : liveAvailable ? <>Call me &amp; negotiate <PhoneCall size={17} weight="fill" /></> : <>Negotiate selected rate <PhoneCall size={17} weight="fill" /></>}</button>
      </aside>
    </motion.div>
  );
}

function NegotiatingView({ steps, priceIndex, target, providerName }) {
  const current = steps[priceIndex] ?? steps[0];
  const progress = ((priceIndex + 1) / steps.length) * 100;

  return (
    <motion.div className="negotiating-view" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} aria-live="polite">
      <section className="command-panel" aria-label="Live negotiation command center">
        <header className="command-head">
          <div><span className="live-indicator live-indicator--dark"><span /> Live negotiation</span><h3>{providerName}</h3></div>
          <span className="call-timer"><PhoneCall size={15} weight="fill" /> 04:{String(12 + priceIndex * 27).padStart(2, "0")}</span>
        </header>
        <div className="command-price">
          <span>Current verified group rate</span>
          <div><motion.strong key={current.price} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>{formatCurrency(current.price)}</motion.strong><small>/ room / night</small></div>
          <p>{current.label}</p>
        </div>
        <Waveform active progress={progress / 100} label="Live negotiation waveform" />
        <div className="negotiation-progress" aria-hidden="true"><motion.span initial={false} animate={{ scaleX: progress / 100 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} /></div>
        <div className="live-transcript">
          <span>StayScout</span>
          <p>{priceIndex < 2 ? "We have a verified competing offer with the same dates, rooms, and amenities. Can you improve this without changing the stay?" : "If the final room rate lands under the private target, our group is ready to book today."}</p>
        </div>
      </section>

      <aside className="concession-panel">
        <p className="section-kicker">Verified concession trail</p>
        <h3>Every movement, recorded</h3>
        <div className="target-marker"><Target size={17} weight="fill" /><span>Private target</span><strong>{formatCurrency(target || 0)}</strong></div>
        <ol>
          {steps.slice(1).map((step, index) => (
            <li className={priceIndex > index ? "concession concession--reached" : "concession"} key={step.time}>
              <span>{priceIndex > index ? <Check size={14} weight="bold" /> : index + 1}</span>
              <div><small>{step.time}</small><strong>{step.label}</strong></div>
              <em>{priceIndex > index && step.impact ? `${step.impact}/night` : "Pending"}</em>
            </li>
          ))}
        </ol>
        <div className="privacy-confirm privacy-confirm--dark"><LockKey size={17} weight="fill" /><span><strong>Private target protected</strong>The hotel never sees your ceiling.</span></div>
      </aside>
    </motion.div>
  );
}

function ResultView({ negotiation, stay, playing, audioProgress, activeClip, replayClips, onToggleAudio, onClip, onRestart }) {
  const { original, final, savings, savingsPct, targetMet, providerName, steps, target, transcript = [] } = negotiation;
  const rateMoved = Number(final) < Number(original);
  const lastLine = transcript[transcript.length - 1];
  const stayRows = [
    ["Destination", stay.location, stay.location],
    ["Dates", stay.dates, stay.dates],
    ["Rooms", stay.rooms, stay.rooms],
    ["Room type", stay.roomType, stay.roomType],
  ];

  return (
    <motion.div className="result-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <div className="result-main">
        <section className="outcome-summary" aria-label="Negotiation outcome">
          <div className="outcome-column"><span>Original group rate</span><strong className="old-price">{formatCurrency(original)}</strong><small>{providerName} · per room / night</small></div>
          <ArrowRight className="outcome-arrow" size={26} weight="bold" />
          <div className="outcome-column outcome-column--final"><span>{rateMoved ? "Final negotiated rate" : "Rate after the call"}</span><strong>{formatCurrency(final)}</strong><small>{lastLine?.time ? `Call · ${lastLine.time}` : "From this call"}</small></div>
          <div className="savings-column"><span>Group stay savings</span><strong>{formatCurrency(savings)}</strong><em>{savingsPct}%</em><small><CheckCircle size={14} weight="fill" /> {rateMoved ? (targetMet ? `Target under ${formatCurrency(target)} achieved` : `Best rate from this call`) : "No price change on this call"}</small></div>
        </section>

        <section className="concession-trail">
          <div className="section-title-row"><div><span className="section-kicker">Before and after</span><h3>What happened on the call</h3></div><SourceLabel type="declaration">From this call</SourceLabel></div>
          <div className="price-timeline">
            {steps.map((step, index) => (
              <div className={index === steps.length - 1 ? "timeline-stop timeline-stop--final" : "timeline-stop"} key={`${step.time}-${step.label}-${step.price}`}>
                <div className="timeline-meta"><span>{index === 0 ? "Original" : index === steps.length - 1 ? "Final" : `Update ${index}`}</span><time>{step.time}</time></div>
                <strong>{formatCurrency(step.price)}</strong>
                <span className="timeline-action">{step.label}</span>
                <small className="timeline-impact">{step.impact ? `${formatCurrency(step.impact)} / room / night` : "Opening rate"}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="coverage-proof" id="evidence">
          <div className="section-title-row"><div><span className="section-kicker">Stay details</span><h3>{rateMoved ? "Rate changed. Your stay did not." : "Nightly rate unchanged. Your stay did not."}</h3></div><span className="coverage-status"><ShieldCheck size={16} weight="fill" /> Stay package unchanged</span></div>
          <div className="coverage-table">
            <div className="coverage-row coverage-row--head"><span>Stay detail</span><span>Before</span><span>After</span><span>Status</span></div>
            {stayRows.map((row) => <div className="coverage-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><span><SealCheck size={14} weight="fill" /> Unchanged</span></div>)}
          </div>
        </section>

        <section className="selection-proof">
          <div><span>Hotel on this call</span><strong>{providerName} · {formatCurrency(final)}/room/night</strong><small><CheckCircle size={14} weight="fill" /> Selected by you</small></div>
          <div><span>Outcome</span><strong>{rateMoved ? `${formatCurrency(savings)} saved vs opening rate` : "Opened and closed at the same rate"}</strong><small><SealCheck size={14} weight="fill" /> From the live call</small></div>
          <button className="secondary-button" type="button" onClick={onRestart}><ArrowCounterClockwise size={17} weight="bold" /> Replay demo</button>
        </section>
      </div>

      <aside className="voice-proof">
        <header><div className="voice-title"><span className="voice-shield"><ShieldCheck size={21} weight="fill" /></span><div><strong>StayScout Negotiator</strong><small>{providerName} · live call</small></div></div><span className="voice-call-state"><CheckCircle size={13} weight="fill" /> Complete</span></header>
        {negotiation.recordingUrl && <RecordingPlayer url={negotiation.recordingUrl} />}
        {negotiation.callSummary && (
          <div className="transcript-panel">
            <div className="voice-section-title"><span>Call summary</span><small><FileText size={13} weight="fill" /> From this call</small></div>
            <p style={{ display: "block", margin: "10px 0 0", color: "#bdccc8", fontSize: 11, lineHeight: 1.65 }}>{negotiation.callSummary}</p>
          </div>
        )}
        <div className="transcript-panel">
          <div className="voice-section-title"><span>Call</span><small>{transcript.length ? `${transcript.length} turns` : "No speech captured"}</small></div>
          {transcript.length ? transcript.map((line, index) => (
            <p key={`${line.time}-${index}`}>
              <time>{line.time}</time>
              <span><strong>{line.speaker}:</strong> {line.text}</span>
            </p>
          )) : (
            <p style={{ display: "block", margin: "10px 0 0", color: "#bdccc8", fontSize: 11, lineHeight: 1.65 }}>No lines were captured from this call.</p>
          )}
        </div>

        {replayClips.length > 0 && (
          <div className="replay-panel">
            <div className="voice-section-title"><span>Price moves</span><small>Rates named on the call</small></div>
            {replayClips.map((clip) => (
              <button className={activeClip === clip.id ? "replay-clip replay-clip--active" : "replay-clip"} type="button" key={clip.id} onClick={() => onClip(clip)}>
                <span className="replay-play"><Play size={15} weight="fill" /></span>
                <time>{clip.time}</time>
                <span><strong>{clip.title}</strong><small>{clip.detail}</small></span>
                <em>{clip.impact}/night</em>
              </button>
            ))}
          </div>
        )}

        <div className="voice-privacy"><LockKey size={19} weight="fill" /><span><strong>Private target protected</strong>Your target stayed private throughout the call.</span></div>
      </aside>
    </motion.div>
  );
}

function LiveNegotiationPanel({ negotiation }) {
  const status = negotiation.callStatus;
  const label =
    status === "ringing"
      ? "Answer the incoming call to begin the negotiation."
      : status === "processing"
        ? "Wrapping up — preparing your recording…"
        : status === "completed"
          ? "Call complete — loading your result…"
          : "On the call — negotiating your group rate…";
  const latest = negotiation.transcript.length ? negotiation.transcript[negotiation.transcript.length - 1] : null;

  return (
    <motion.div className="negotiating-view" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} aria-live="polite">
      <section className="command-panel" aria-label="In-app voice negotiation">
        <header className="command-head">
          <div><span className="live-indicator live-indicator--dark"><span /> In-app voice negotiation</span><h3>{negotiation.providerName}</h3></div>
          <span className="call-timer"><PhoneCall size={15} weight="fill" /> {status === "ringing" ? "Ringing" : "Live"}</span>
        </header>
        <div className="command-price">
          <span>Starting group rate</span>
          <div><strong>{formatCurrency(negotiation.original)}</strong><small>/ room / night</small></div>
          <p>{label}</p>
        </div>
        <Waveform active progress={0.5} label="In-app call waveform" />
        <div className="live-transcript">
          <span>{latest ? latest.speaker : "StayScout"}</span>
          <p>{latest ? latest.text : "Answer the call and role-play hotel sales — the agent negotiates your nightly group rate."}</p>
        </div>
      </section>

      <aside className="concession-panel">
        <p className="section-kicker">Live call</p>
        <h3>Negotiating your rate</h3>
        <div className="target-marker"><Target size={17} weight="fill" /><span>Private target</span><strong>{formatCurrency(negotiation.target || 0)}</strong></div>
        <div className="privacy-confirm privacy-confirm--dark"><LockKey size={17} weight="fill" /><span><strong>Private target protected</strong>Only hotel-safe price context is shared on the call.</span></div>
      </aside>
    </motion.div>
  );
}

export const ProductDemo = forwardRef(function ProductDemo({ account, onRequireSignup }, ref) {
  const [step, setStep] = useState("vehicle");
  const [profile, setProfile] = useState({ stars: "4-star", location: "Chicago, IL", dates: "Apr 14–17", rooms: "24", guests: "2", budget: "$200–$260", premium: "$248", year: "2024", make: "Chicago", model: "Deluxe", state: "IL", zip: "60601", mileage: "24" });
  const [bodyType, setBodyType] = useState("Deluxe");
  const [research, setResearch] = useState(null);
  const [quotesData, setQuotesData] = useState(null);
  const [agentCalls, setAgentCalls] = useState([]);
  const [calls, setCalls] = useState([]);
  const [callsComplete, setCallsComplete] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedHotels, setSelectedHotels] = useState(() => new Set());
  const [target, setTarget] = useState("");
  const [negotiation, setNegotiation] = useState(null);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [callContext, setCallContext] = useState(null);
  const [priceIndex, setPriceIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0.62);
  const [activeClip, setActiveClip] = useState(null);
  const audioTimerRef = useRef(null);
  const negotiationRef = useRef(null);

  const quotes = quotesData?.items ?? [];
  const recommendedId = quotesData?.recommendedQuoteId ?? null;

  // Presets sit under the first-round agent quote once the calls have run.
  const presets = useMemo(() => {
    const selectedCall = agentCalls.find((call) => call.quoteId === selectedProvider) ?? agentCalls[0];
    const rec = quotes.find((quote) => quote.id === recommendedId) ?? quotes[0];
    const base = selectedCall?.agentQuote ?? rec?.annual ?? HOTELS[0]?.nightly ?? PRICE_STEPS[0]?.price ?? 248;
    return [base * 0.94, base * 0.88, base * 0.82].map((value) => Math.max(0, Math.round(value / 5) * 5));
  }, [agentCalls, selectedProvider, quotes, recommendedId]);

  const replayClips = useMemo(() => {
    if (!negotiation?.steps) return [];
    return negotiation.steps.slice(1).map((step, index) => ({
      id: `clip-${index}`,
      time: step.time,
      title: step.label,
      detail: `${formatCurrency(step.price)} per room / night`,
      impact: step.impact ?? 0,
      speech: step.label,
    }));
  }, [negotiation]);

  // Track the latest negotiation so the live poller can read its mode without
  // restarting on every state update.
  useEffect(() => {
    negotiationRef.current = negotiation;
  }, [negotiation]);

  // Reveal the five calls with real provider names + real quote amounts.
  useEffect(() => {
    if (step !== "calling" || !research || !quotesData) return undefined;
    const amount = new Map(quotesData.items.map((item) => [item.providerId, item.annual]));
    const recommended = new Map(quotesData.items.map((item) => [item.providerId, item.recommended]));
    const quoteIdByProvider = new Map(quotesData.items.map((item) => [item.providerId, item.id]));
    const nightlyById = new Map(research.providers.map((provider) => [provider.id, provider.nightly]));
    setCalls(research.providers.map((provider) => ({
      id: provider.id,
      // Selection is tracked by quote id because that is what the API expects.
      quoteId: quoteIdByProvider.get(provider.id) ?? provider.id,
      name: provider.name,
      rating: provider.rating,
      reviews: provider.reviews,
      roomType: provider.roomType,
      status: "Queued",
      annual: null,
      aggregators: provider.aggregators ?? [],
      recommended: recommended.get(provider.id) ?? false,
    })));
    setCallsComplete(false);
    const timers = [];
    research.providers.forEach((provider, index) => {
      timers.push(window.setTimeout(() => {
        setCalls((current) => current.map((call) => call.id === provider.id ? { ...call, status: "Calling" } : call));
      }, index * 750 + 250));
      timers.push(window.setTimeout(() => {
        setCalls((current) => current.map((call) => call.id === provider.id ? {
          ...call,
          status: "Verified",
          annual: amount.get(provider.id) ?? nightlyById.get(provider.id) ?? null,
        } : call));
      }, index * 750 + 850));
    });
    timers.push(window.setTimeout(() => setCallsComplete(true), research.providers.length * 750 + 700));
    return () => timers.forEach(window.clearTimeout);
  }, [step, research, quotesData]);

  // Animate the simulated concession trail. Live calls are driven by polling.
  useEffect(() => {
    if (step !== "negotiating" || !negotiation || negotiation.mode === "live") return undefined;
    setPriceIndex(0);
    const steps = negotiation.steps;
    const timers = [];
    for (let i = 1; i < steps.length; i += 1) {
      timers.push(window.setTimeout(() => setPriceIndex(i), i * 1200));
    }
    timers.push(window.setTimeout(() => setStep("result"), steps.length * 1200 + 700));
    return () => timers.forEach(window.clearTimeout);
  }, [step, negotiation]);

  // Poll a live negotiation call until it completes, then reveal the result.
  useEffect(() => {
    if (step !== "negotiating" || negotiationRef.current?.mode !== "live") return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const res = await api.pollNegotiation();
        if (!active) return;
        const next = res.snapshot.negotiation;
        if (next) setNegotiation(next);
        if (next?.callStatus === "completed") {
          goToDashboard(next);
          return;
        }
        if (next?.callStatus === "failed") return;
        timer = window.setTimeout(poll, 3500);
      } catch {
        if (active) timer = window.setTimeout(poll, 4000);
      }
    };
    poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [step]);

  useEffect(() => () => {
    window.clearInterval(audioTimerRef.current);
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (step === "vehicle") return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => ref?.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
  }, [step, ref]);

  const viewStep = step === "agentloading" ? "agentcalls" : step;
  const currentStepIndex = STEP_META[viewStep].index;
  const completedNav = useMemo(() => new Set(NAV_ITEMS.filter((item) => STEP_META[item.id].index < currentStepIndex).map((item) => item.id)), [currentStepIndex]);

  function getNavState(item) {
    const itemIndex = STEP_META[item.id].index;
    if (item.id === viewStep) return { key: "current", label: step === "agentloading" ? "Calling hotels" : (viewStep === "calling" && callsComplete) || viewStep === "result" ? "Complete" : "In progress" };
    if (completedNav.has(item.id)) return { key: "complete", label: "Complete" };
    if (itemIndex === currentStepIndex + 1) {
      if (step === "calling" && !callsComplete) return { key: "pending", label: "Pending" };
      if (step === "negotiating") return { key: "pending", label: "Pending" };
      return { key: "ready", label: "Ready" };
    }
    return { key: "locked", label: "Locked" };
  }

  async function startResearch(event) {
    event.preventDefault();
    if (!account) { onRequireSignup?.(); return; }
    setError(null);
    setBusy(true);
    setStep("calling");
    setCallsComplete(false);
    setResearch(null);
    setQuotesData(null);
    setAgentCalls([]);
    setCalls([]);
    try {
      const payload = toCarProfile(profile, bodyType);
      const researchRes = await api.research(payload);
      setResearch(researchRes.snapshot.research);
      const quotesRes = await api.quotes();
      setQuotesData(quotesRes.snapshot.quotes);
      setLiveAvailable(Boolean(quotesRes.snapshot.liveAvailable));
      const items = quotesRes.snapshot.quotes?.items ?? [];
      const recommendedQuoteId = quotesRes.snapshot.quotes?.recommendedQuoteId ?? items[0]?.id ?? null;
      setSelectedProvider(recommendedQuoteId);
      setSelectedHotels(new Set(items.map((item) => item.id)));
    } catch (cause) {
      setError(cause.message || "Research failed");
      setStep("vehicle");
    } finally {
      setBusy(false);
    }
  }

  function toggleCallHotel(quoteId) {
    setSelectedHotels((current) => {
      const next = new Set(current);
      if (next.has(quoteId)) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
  }

  /** Places the simulated first-round calls for the hotels the user checked. */
  async function startAgentCalls() {
    setError(null);
    setBusy(true);
    setStep("agentloading");
    try {
      const res = await api.agentCalls([...selectedHotels]);
      const calls = res.snapshot.agentCalls ?? [];
      setAgentCalls(calls);
      const best = calls[0];
      setSelectedProvider(best?.quoteId ?? null);
      // Seed the private target just under the best first-round quote.
      if (best?.agentQuote) {
        setTarget(String(Math.max(0, Math.round((best.agentQuote * 0.9) / 5) * 5)));
      }
      setStep("agentcalls");
    } catch (cause) {
      setError(cause.message || "The agent calls could not be completed.");
      setStep("calling");
    } finally {
      setBusy(false);
    }
  }

  async function startNegotiation() {
    setError(null);
    if (!selectedProvider) {
      setError("Select a hotel to negotiate with.");
      return;
    }
    setBusy(true);
    try {
      const targetCents = (Number(String(target).replace(/\D/g, "")) || 0) * 100;
      if (liveAvailable) {
        const res = await api.startCall(targetCents, selectedProvider ?? undefined);
        setCallContext({ credential: res.credential, dynamicVariables: res.dynamicVariables });
        setNegotiation(res.snapshot.negotiation);
        setStep("negotiating");
      } else {
        const res = await api.negotiate(targetCents, selectedProvider ?? undefined);
        setNegotiation(res.snapshot.negotiation);
        setStep("negotiating");
      }
    } catch (cause) {
      setError(cause.message || "Negotiation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCallConnected(conversationId) {
    try {
      const res = await api.callConnected(conversationId);
      setNegotiation(res.snapshot.negotiation);
    } catch {
      // Non-fatal: the poller still finalizes by conversation id.
    }
  }

  function goToDashboard(nextNegotiation) {
    setCallContext(null);
    if (nextNegotiation) setNegotiation(nextNegotiation);
    setStep("result");
  }

  function handleCallEnded(conversationId, snapshot, options = {}) {
    if (!conversationId) {
      // Declined before connecting — return to the quotes step.
      setCallContext(null);
      setNegotiation(null);
      setStep("quotes");
      return;
    }
    setCallContext(null);
    if (snapshot?.negotiation) {
      goToDashboard(snapshot.negotiation);
      return;
    }
    if (options.pending) return;
    goToDashboard(negotiation);
  }

  function handleCallError(message) {
    setCallContext(null);
    setNegotiation(null);
    setError(message || "The call could not be completed.");
    setStep("quotes");
  }

  function stopAudio() {
    window.clearInterval(audioTimerRef.current);
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }

  function toggleAudio() {
    if (playing) { stopAudio(); return; }
    setActiveClip(null);
    setPlaying(true);
    setAudioProgress(0);
    const lines = negotiation?.transcript ?? [];
    const spokenText = lines.map((line) => `${line.speaker}. ${line.text}`).join(" ");
    if (window.speechSynthesis && spokenText) {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.rate = 0.94;
      utterance.onend = () => { setPlaying(false); setAudioProgress(1); window.clearInterval(audioTimerRef.current); };
      window.speechSynthesis.speak(utterance);
    }
    const startedAt = Date.now();
    audioTimerRef.current = window.setInterval(() => {
      const next = Math.min(1, (Date.now() - startedAt) / 16000);
      setAudioProgress(next);
      if (next >= 1) stopAudio();
    }, 120);
  }

  function playClip(clip) {
    stopAudio();
    setActiveClip(clip.id);
    setAudioProgress(clip.time === "06:11" ? 0.92 : clip.time === "03:29" ? 0.52 : 0.28);
    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(clip.speech);
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    }
  }

  function restartDemo() {
    stopAudio();
    setStep("vehicle");
    setResearch(null);
    setQuotesData(null);
    setAgentCalls([]);
    setCalls([]);
    setCallsComplete(false);
    setSelectedProvider(null);
    setSelectedHotels(new Set());
    setNegotiation(null);
    setCallContext(null);
    setPriceIndex(0);
    setAudioProgress(0.62);
    setActiveClip(null);
    setError(null);
    window.setTimeout(() => ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  const driverName = account?.displayName ?? "Alex Morgan";
  const activeStay = `${profile.location || profile.make} · ${profile.rooms || profile.mileage} rooms`.trim();

  return (
    <section className="demo-section" id="demo" ref={ref} aria-label="Interactive StayScout demo">
      <div className="demo-app">
        <aside className="demo-sidebar">
          <div className="brand-lockup brand-lockup--dark"><span className="brand-mark" aria-hidden="true" /><span>StayScout<small>Group booking operations</small></span></div>
          <div className="sidebar-case"><span>Active group stay</span><strong>{activeStay}</strong><small>Case STAY-8K42</small></div>
          <p className="sidebar-label">Workflow</p>
          <nav aria-label="Demo journey">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.id === viewStep;
              const complete = completedNav.has(item.id);
              const navState = getNavState(item);
              return (
                <div className={`sidebar-item sidebar-item--${navState.key}`} key={item.id} aria-current={active ? "step" : undefined} aria-disabled={navState.key === "locked" || navState.key === "pending"}>
                  <span className="sidebar-item-icon">{complete ? <CheckCircle size={17} weight="fill" /> : navState.key === "locked" ? <LockKey size={15} /> : <Icon size={17} weight={active ? "fill" : "regular"} />}</span>
                  <span className="sidebar-item-copy"><strong>{item.label}</strong><small>{navState.label}</small></span>
                </div>
              );
            })}
          </nav>
          <div className="sidebar-user"><span>{initials(driverName)}</span><div><strong>{driverName}</strong><small>{account ? "Group organizer" : "Not signed in"}</small></div></div>
          <div className="simulated-note"><WarningCircle size={15} /><span><strong>Demo environment</strong>Hotels and calls are simulated.</span></div>
        </aside>

        <div className="demo-workspace">
          <div className="mobile-demo-bar"><div className="brand-lockup brand-lockup--dark"><span className="brand-mark" aria-hidden="true" /><span>StayScout</span></div><span>Step {currentStepIndex} / {TOTAL_STEPS}</span></div>
          <div className="demo-topbar"><div className="topbar-breadcrumb"><span>Group bookings</span><ArrowRight size={12} /><strong>Request STAY-8K42</strong></div><div className="global-verification"><SealCheck size={16} weight="fill" /><span><strong>{account ? "Request verified" : "Sign up to begin"}</strong><small>{account ? "12 facts · 2 sources" : "No account yet"}</small></span></div></div>
          <div className="demo-content">
            <StepHeader step={viewStep} />
            <div className="sr-only" aria-live="polite">Step {currentStepIndex} of {TOTAL_STEPS}. {STEP_META[viewStep].title}</div>
            <AnimatePresence mode="wait">
              {!account && <SignupGate key="gate" onRequireSignup={onRequireSignup} />}
              {account && step === "vehicle" && <VehicleView key="vehicle" profile={profile} setProfile={setProfile} bodyType={bodyType} setBodyType={setBodyType} driverName={driverName} onStart={startResearch} busy={busy} error={error} />}
              {account && step === "calling" && <CallingView key="calling" calls={calls} complete={callsComplete} live={research?.live ?? false} locationLabel={profile.location || profile.make || "Destination"} selectedHotels={selectedHotels} onToggleHotel={toggleCallHotel} onContinue={startAgentCalls} busy={busy} />}
              {account && step === "agentloading" && <AgentCallsLoadingView key="agentloading" hotels={calls.filter((call) => selectedHotels.has(call.quoteId))} locationLabel={profile.location || profile.make || "Destination"} />}
              {account && step === "agentcalls" && <AgentCallsView key="agentcalls" agentCalls={agentCalls} locationLabel={profile.location || profile.make || "Destination"} onContinue={() => setStep("quotes")} busy={busy} />}
              {account && step === "quotes" && <QuotesView key="quotes" quotes={quotes} agentCalls={agentCalls} selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} target={target} setTarget={setTarget} presets={presets} liveAvailable={liveAvailable} onNegotiate={startNegotiation} busy={busy} error={error} />}
              {account && step === "negotiating" && negotiation && (negotiation.mode === "live"
                ? <LiveNegotiationPanel key="live-panel" negotiation={negotiation} />
                : <NegotiatingView key="negotiating" steps={negotiation.steps} priceIndex={priceIndex} target={target} providerName={negotiation.providerName} />)}
              {account && step === "result" && negotiation && <ResultView key="result" negotiation={negotiation} stay={{ location: profile.location || profile.make || "Destination", dates: profile.dates || "Dates TBD", rooms: `${profile.rooms || profile.mileage || "—"} rooms`, roomType: bodyType || profile.model || "Standard" }} playing={playing} audioProgress={audioProgress} activeClip={activeClip} replayClips={replayClips} onToggleAudio={toggleAudio} onClip={playClip} onRestart={restartDemo} />}
            </AnimatePresence>
          </div>
          <footer className="demo-footer"><span>Simulated hotels for demonstration purposes only.</span><a href="#evidence">Evidence policy <ArrowUpRight size={13} weight="bold" /></a><span><Headphones size={14} /> Call evidence retained for this session</span></footer>
        </div>
      </div>
      {callContext && step === "negotiating" && negotiation?.mode === "live" && (
        <IosCallView callContext={callContext} negotiation={negotiation} onConnected={handleCallConnected} onEnded={handleCallEnded} onError={handleCallError} />
      )}
    </section>
  );
});
