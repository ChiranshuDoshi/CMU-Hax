import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowUpRight,
  Bed,
  Check,
  CheckCircle,
  Clock,
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
import { HOTELS, PRICE_STEPS, REPLAY_CLIPS, TRANSCRIPT } from "./data.js";
import { IosCallView } from "./IosCallView.jsx";
import { Waveform } from "./Waveform.jsx";

const STEP_META = {
  vehicle: { index: 1, label: "Stay profile", title: "Set up your group stay", description: "Confirm the details hotels need to return comparable group rates." },
  calling: { index: 2, label: "Top 5 hotels", title: "StayScout is researching the market", description: "Every hotel receives the same verified group-stay request." },
  quotes: { index: 3, label: "Compare", title: "Five group rates, normalized", description: "Choose an offer and set the private target for the negotiation." },
  negotiating: { index: 4, label: "Negotiate", title: "Negotiator is working the selected hotel", description: "The target stays private while verified concessions are recorded." },
  result: { index: 5, label: "Evidence", title: "A better group rate, with the proof", description: "Review the outcome, unchanged stay details, full call, and decisive moments." },
};

const NAV_ITEMS = [
  { id: "vehicle", label: "Stay profile", icon: Bed },
  { id: "calling", label: "Top 5 hotels", icon: MagnifyingGlass },
  { id: "quotes", label: "Compare", icon: ListChecks },
  { id: "negotiating", label: "Negotiate", icon: PhoneCall },
  { id: "result", label: "Evidence", icon: FileText },
];

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

function StatusBadge({ status }) {
  if (status === "Verified") {
    return <span className="status-badge status-badge--verified"><SealCheck size={14} weight="fill" /> Verified</span>;
  }
  if (status === "Calling") {
    return <span className="status-badge status-badge--active"><SpinnerGap className="spin" size={14} weight="bold" /> Calling</span>;
  }
  if (status === "Needs review") {
    return <span className="status-badge status-badge--review"><WarningCircle size={14} weight="fill" /> Needs review</span>;
  }
  return <span className="status-badge status-badge--pending"><Clock size={14} /> {status === "Pending" ? "Pending" : "Queued"}</span>;
}

function StepHeader({ step }) {
  const meta = STEP_META[step];
  return (
    <header className="demo-header">
      <div>
        <p className="eyebrow">Step {meta.index} of 5 · {meta.label}</p>
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

// Recorded demo call audio, mapped by row position. Row 1 → $1,485 quote,
// row 3 → $1,199 quote. The other rows expose the control but have no clip.
const CALL_AUDIO = ["/assets/quote-1.m4a", null, "/assets/quote-3.m4a", null, null];

function CallAudioPlayer({ src, label }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("pause", () => setPlaying(false));
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // Only one clip should play at a time across the board.
      document.querySelectorAll("audio[data-call-audio]").forEach((other) => {
        if (other !== audio) other.pause();
      });
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  const disabled = !src;
  return (
    <div className={disabled ? "call-audio call-audio--empty" : "call-audio"}>
      <button
        type="button"
        className="call-audio-button"
        onClick={toggle}
        aria-label={disabled ? `Play ${label} recording (no clip available)` : playing ? `Pause ${label} recording` : `Play ${label} recording`}
      >
        {playing ? <Pause size={11} weight="fill" /> : <Play size={11} weight="fill" />}
      </button>
      <Waveform active={playing} compact progress={disabled ? 0 : progress} label={disabled ? "No recording available" : `${label} recording waveform`} />
      {src && <audio ref={audioRef} src={src} preload="none" data-call-audio />}
    </div>
  );
}

function CallingView({ calls, complete, live, onContinue, locationLabel }) {
  const completedCount = calls.filter((call) => call.status === "Verified").length;
  const total = calls.length || 5;
  const progress = (completedCount / total) * 100;
  const place = locationLabel || "your destination";

  return (
    <motion.div className="calling-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="call-board" aria-live="polite" aria-busy={!complete}>
        <div className="call-board-head">
          <div><span className="section-kicker">Querit hotel search &amp; aggregator pricing</span><h3>{complete ? "Individual hotels priced across aggregators" : `${completedCount} of ${total} hotels verified`}</h3><p>StayScout searches Querit for real hotel properties in {place}, then checks Booking, Expedia, Hotels.com, Kayak, and Tripadvisor for nightly rates.</p></div>
          <span className="live-indicator"><span /> {complete ? "Complete" : "Agent active"}</span>
        </div>
        <div className="progress-track" aria-hidden="true"><motion.span initial={false} animate={{ scaleX: progress / 100 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} /></div>

        <div className="call-list">
          <div className="call-table-head"><span>#</span><span>Hotel</span><span>Rating evidence</span><span>Eligibility</span><span>Call state</span><span>Quote</span></div>
          {calls.map((call, index) => (
            <article className={call.status === "Calling" ? "call-row call-row--active" : "call-row"} key={call.id}>
              <span className="call-order">0{index + 1}</span>
              <div className="call-provider"><span className="provider-monogram">{call.name.slice(0, 1)}</span><span><strong>{call.name}</strong><small>{place} · individual property</small></span></div>
              <div className="rating-source"><strong><Star size={13} weight="fill" /> {call.rating ?? "—"}</strong><SourceLabel type="declaration">{call.reviews} reviews</SourceLabel></div>
              <div className="eligibility-state"><Check size={13} weight="bold" /><span><strong>{place}</strong><small>{live ? "Web-verified" : "Eligible"}</small></span></div>
              <div className="call-state-cell"><CallAudioPlayer src={CALL_AUDIO[index] ?? null} label={call.name} /><StatusBadge status={call.status} /></div>
              <span className="call-price">{call.status === "Verified" && call.annual != null ? <><strong>{formatCurrency(call.annual)}</strong><small>{call.aggregators?.length ? call.aggregators.map((agg) => agg.name).slice(0, 2).join(" · ") : "per room / night"}</small></> : call.status === "Calling" ? <><span className="pending-line" /><small>Checking aggregators…</small></> : <><span className="pending-line pending-line--muted" /><small>Queued for Querit</small></>}</span>
            </article>
          ))}
        </div>

        <div className="call-board-footer">
          <span><ShieldCheck size={15} /> Dates, rooms, and inclusions locked across all five calls</span>
          <button className="primary-button" type="button" disabled={!complete} onClick={onContinue}>Review verified rates <ArrowRight size={17} weight="bold" /></button>
        </div>
      </section>

      <aside className="research-evidence">
        <p className="section-kicker">Research basis</p>
        <h3>Why these hotels</h3>
        <p>{live ? "Hotels were discovered with Querit from your stay params" : "Demo hotels matched your stay params"} and priced on major aggregators.</p>
        <ol>
          <li><span className="evidence-index">01</span><span><strong>Stay search</strong>City, room count, class, and dates.</span><SourceLabel type="user">Matched</SourceLabel></li>
          <li><span className="evidence-index">02</span><span><strong>Aggregator rates</strong>Booking, Expedia, Hotels.com, Kayak, Tripadvisor.</span><SourceLabel type="declaration">Querit</SourceLabel></li>
          <li><span className="evidence-index">03</span><span><strong>Shortlist ready</strong>You choose which hotels to negotiate.</span><SourceLabel type={complete ? "user" : "required"}>{complete ? "Complete" : "Collecting"}</SourceLabel></li>
        </ol>
        <div className="evidence-policy-note"><FileText size={16} /><span><strong>Evidence standard</strong>Nightly rates prefer aggregator snippets; estimates are labeled when a price cannot be parsed.</span></div>
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
  recommendedId,
  selectedHotels,
  setSelectedHotels,
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
  const shortlisted = quotes.filter((quote) => selectedHotels.has(quote.id));
  const selectedQuote =
    shortlisted.find((quote) => quote.id === selectedProvider) ??
    shortlisted.find((quote) => quote.recommended) ??
    shortlisted[0] ??
    quotes[0];
  const recommended = quotes.find((quote) => quote.id === recommendedId);

  function toggleHotel(quoteId) {
    setSelectedHotels((current) => {
      const next = new Set(current);
      const removing = next.has(quoteId);
      if (removing) next.delete(quoteId);
      else next.add(quoteId);

      setSelectedProvider((primary) => {
        if (!removing) return primary ?? quoteId;
        if (primary !== quoteId && next.has(primary)) return primary;
        return next.values().next().value ?? null;
      });

      return next;
    });
  }

  return (
    <motion.div className="quotes-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="quote-comparison">
        <div className="comparison-head">
          <div><span className="section-kicker">Querit hotel + aggregator rates</span><h3>Select hotels to negotiate with</h3><p>Rates were pulled from major travel aggregators for your stay params. Check every hotel you want on the shortlist, then pick which one to call first.</p></div>
          <details className="evidence-drawer">
            <summary><FileText size={15} /> Evidence index <span>{quotes.length * 4}</span></summary>
            <div><strong>Rate evidence</strong><p>Querit hotel discovery plus Booking, Expedia, Hotels.com, Kayak, and Tripadvisor price snippets when available.</p></div>
          </details>
        </div>
        {recommended && <div className="recommendation-strip"><span><SealCheck size={16} weight="fill" /></span><div><strong>System recommendation</strong><p>{recommended.name} has the strongest verified value: lowest matched nightly rate of {formatCurrency(recommended.annual)}, {roomTypeLabel(recommended)}, and aggregator-backed evidence.</p></div><small>Recommendation only · you decide</small></div>}
        <div className="quote-table" role="group" aria-label="Hotel group rates">
          <div className="quote-table-head"><span>Hotel</span><span>Aggregators</span><span>Nightly rate</span><span>Room type</span><span>Negotiate</span><span>Shortlist</span></div>
          {quotes.map((hotel) => {
            const shortlistedHotel = selectedHotels.has(hotel.id);
            const primary = selectedProvider === hotel.id;
            const aggregatorLabel = (hotel.aggregators?.length
              ? hotel.aggregators.map((agg) => `${agg.name} ${formatCurrency(agg.nightly)}`).join(" · ")
              : "Market estimate");
            return (
              <label className={shortlistedHotel ? (primary ? "quote-row quote-row--selected" : "quote-row") : "quote-row"} key={hotel.id} style={{ opacity: shortlistedHotel ? 1 : 0.72 }}>
                <span className="quote-provider"><span className="provider-monogram">{hotel.name.slice(0, 1)}</span><span><strong>{hotel.name}</strong><small><Star size={12} weight="fill" /> {hotel.rating ?? "—"} · {hotel.reviews} reviews</small></span>{hotel.recommended && <em>Recommended</em>}</span>
                <span className="coverage-match"><strong><Check size={13} weight="bold" /> Live search</strong><small style={{ display: "block", maxWidth: 180, whiteSpace: "normal" }}>{aggregatorLabel}</small></span>
                <span className="quote-amount"><strong>{formatCurrency(hotel.annual)}</strong><small>per room / night</small></span>
                <span className="deductible-cell"><strong>{roomTypeLabel(hotel)}</strong><small>room category</small></span>
                <span className="radio-wrap"><input type="radio" name="primaryHotel" value={hotel.id} checked={primary} disabled={!shortlistedHotel} onChange={() => { setSelectedHotels((current) => new Set(current).add(hotel.id)); setSelectedProvider(hotel.id); }} /><i /></span>
                <span className="radio-wrap"><input type="checkbox" name="shortlistHotel" value={hotel.id} checked={shortlistedHotel} onChange={() => toggleHotel(hotel.id)} /><i /></span>
              </label>
            );
          })}
        </div>
      </section>

      <aside className="target-panel">
        <div className="target-panel-head"><Target size={20} weight="fill" /><span><p className="section-kicker">Private negotiation goal</p><h3>Set your target</h3></span></div>
        <div className="selection-context"><span>Calling first</span><strong>{selectedQuote?.name ?? "Select a hotel"}</strong><small>{shortlisted.length} hotel{shortlisted.length === 1 ? "" : "s"} shortlisted · {formatCurrency(selectedQuote?.annual)} / night</small></div>
        <p>StayScout will negotiate the selected hotel without disclosing your ceiling. Other shortlisted hotels stay available for a follow-up call.</p>
        <label className="target-input"><span>$</span><input name="targetNightlyRate" aria-label="Target nightly room rate" value={target} onChange={(event) => setTarget(event.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="off" /><small>/ night</small></label>
        <div className="range-presets">
          {presets.map((amount) => <button className={Number(target) === amount ? "preset preset--active" : "preset"} type="button" key={amount} onClick={() => setTarget(String(amount))}>${amount.toLocaleString()}</button>)}
        </div>
        <div className="privacy-confirm"><SourceLabel type="hidden">Hidden from hotel</SourceLabel><span>Only the negotiator uses this threshold.</span></div>
        {liveAvailable && <p className="disclosure" style={{ margin: "4px 0 0" }}>StayScout will place an in-app voice call so you can negotiate live with hotel sales.</p>}
        {error && <div className="disclosure-rule" role="alert" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}><WarningCircle size={16} weight="fill" /><span>{error}</span></div>}
        <button className="primary-button primary-button--wide" type="button" onClick={onNegotiate} disabled={busy || shortlisted.length === 0 || !selectedQuote}>{busy ? <><SpinnerGap className="spin" size={17} weight="bold" /> Starting…</> : liveAvailable ? <>Call me &amp; negotiate <PhoneCall size={17} weight="fill" /></> : <>Negotiate selected rate <PhoneCall size={17} weight="fill" /></>}</button>
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

function ResultView({ negotiation, playing, audioProgress, activeClip, replayClips, onToggleAudio, onClip, onRestart }) {
  const { original, final, savings, savingsPct, targetMet, providerName, steps, target } = negotiation;
  const transcript = negotiation.transcript?.length ? negotiation.transcript : TRANSCRIPT;
  const clips = replayClips.length ? replayClips : REPLAY_CLIPS;

  return (
    <motion.div className="result-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <div className="result-main">
        <section className="outcome-summary" aria-label="Negotiation outcome">
          <div className="outcome-column"><span>Original group rate</span><strong className="old-price">{formatCurrency(original)}</strong><small>{providerName} · per room / night</small></div>
          <ArrowRight className="outcome-arrow" size={26} weight="bold" />
          <div className="outcome-column outcome-column--final"><span>Final negotiated rate</span><strong>{formatCurrency(final)}</strong><small>Transcript evidence · 06:11</small></div>
          <div className="savings-column"><span>Group stay savings</span><strong>{formatCurrency(savings)}</strong><em>{savingsPct}%</em><small><CheckCircle size={14} weight="fill" /> {targetMet ? `Target under ${formatCurrency(target)} achieved` : `Best achievable near ${formatCurrency(target)}`}</small></div>
        </section>

        <section className="concession-trail">
          <div className="section-title-row"><div><span className="section-kicker">Before and after</span><h3>Concession trail</h3></div><SourceLabel type="declaration">Transcript-backed</SourceLabel></div>
          <div className="price-timeline">
            {steps.map((step, index) => (
              <div className={index === steps.length - 1 ? "timeline-stop timeline-stop--final" : "timeline-stop"} key={step.time}>
                <div className="timeline-meta"><span>{index === 0 ? "Original" : index === steps.length - 1 ? "Final" : `Counter ${index}`}</span><time>{step.time}</time></div>
                <strong>{formatCurrency(step.price)}</strong>
                <span className="timeline-action">{step.label}</span>
                <small className="timeline-impact">{step.impact ? `${formatCurrency(step.impact)} / room / night` : "Baseline recorded"}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="coverage-proof" id="evidence">
          <div className="section-title-row"><div><span className="section-kicker">Stay details and evidence</span><h3>Rate changed. Your stay did not.</h3></div><span className="coverage-status"><ShieldCheck size={16} weight="fill" /> Stay package unchanged</span></div>
          <div className="coverage-table">
            <div className="coverage-row coverage-row--head"><span>Stay detail</span><span>Before</span><span>After</span><span>Status</span></div>
            {[
              ["Breakfast", "Included daily", "Included daily"],
              ["Pool & gym", "Included", "Included"],
              ["Wi-Fi", "Included", "Included"],
              ["Cancellation", "14-day flexible", "14-day flexible"],
            ].map((row) => <div className="coverage-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><span><SealCheck size={14} weight="fill" /> Verified</span></div>)}
          </div>
        </section>

        <section className="selection-proof">
          <div><span>Your selection</span><strong>{providerName} · {formatCurrency(final)}/room/night</strong><small><CheckCircle size={14} weight="fill" /> Selected by you</small></div>
          <div><span>StayScout recommendation</span><strong>{providerName} · Best overall value</strong><small><SealCheck size={14} weight="fill" /> Recommendation matched</small></div>
          <button className="secondary-button" type="button" onClick={onRestart}><ArrowCounterClockwise size={17} weight="bold" /> Replay demo</button>
        </section>
      </div>

      <aside className="voice-proof">
        <header><div className="voice-title"><span className="voice-shield"><ShieldCheck size={21} weight="fill" /></span><div><strong>StayScout Negotiator</strong><small>Call evidence · STAY-CALL-0198</small></div></div><span className="voice-call-state"><CheckCircle size={13} weight="fill" /> Complete</span></header>
        {negotiation.recordingUrl ? (
          <RecordingPlayer url={negotiation.recordingUrl} />
        ) : (
          <div className="audio-player">
            <div className="audio-label"><span>Full negotiation audio</span><small>06:42</small></div>
            <Waveform active={playing} progress={audioProgress} />
            <div className="audio-controls">
              <button type="button" onClick={onToggleAudio} aria-label={playing ? "Pause negotiation audio" : "Play negotiation audio"}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button>
              <div className="audio-progress"><span style={{ transform: `scaleX(${audioProgress})` }} /><i style={{ left: `${audioProgress * 100}%` }} /></div>
              <span>{String(Math.floor(audioProgress * 6)).padStart(2, "0")}:{String(Math.floor((audioProgress * 402) % 60)).padStart(2, "0")}</span>
            </div>
          </div>
        )}
        {negotiation.callSummary && (
          <div className="transcript-panel">
            <div className="voice-section-title"><span>Call summary</span><small><FileText size={13} weight="fill" /> Analyzed</small></div>
            <p style={{ display: "block", margin: "10px 0 0", color: "#bdccc8", fontSize: 11, lineHeight: 1.65 }}>{negotiation.callSummary}</p>
          </div>
        )}

        <div className="transcript-panel">
          <div className="voice-section-title"><span>Transcript excerpt</span><small><FileText size={13} weight="fill" /> Synchronized</small></div>
          {transcript.map((line, index) => <p key={`${line.time}-${index}`}><time>{line.time}</time><span><strong>{line.speaker}:</strong> {line.text}</span></p>)}
        </div>

        <div className="replay-panel">
          <div className="voice-section-title"><span>Good negotiation replay</span><small>Key moments that moved the price</small></div>
          {clips.map((clip) => (
            <button className={activeClip === clip.id ? "replay-clip replay-clip--active" : "replay-clip"} type="button" key={clip.id} onClick={() => onClip(clip)}>
              <span className="replay-play"><Play size={15} weight="fill" /></span>
              <time>{clip.time}</time>
              <span><strong>{clip.title}</strong><small>{clip.detail}</small></span>
              <em>{clip.impact}/night</em>
            </button>
          ))}
        </div>

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

  const presets = useMemo(() => {
    const rec = quotes.find((quote) => quote.id === recommendedId) ?? quotes[0];
    const base = rec?.annual ?? HOTELS[0]?.nightly ?? PRICE_STEPS[0]?.price ?? 248;
    return [base - 150, base - 100, base - 50].map((value) => Math.max(0, Math.round(value / 10) * 10));
  }, [quotes, recommendedId]);

  const replayClips = useMemo(() => {
    if (!negotiation) return [];
    return negotiation.steps.slice(1).map((step, index) => ({
      id: `clip-${index}`,
      time: step.time,
      title: step.label,
      detail: index === 0 ? "Presented a stay-matched competing group rate." : index === 1 ? "Confirmed breakfast package and amenity match." : "Asked for a final discretionary reduction to reach target.",
      impact: step.impact ?? 0,
      speech: `${step.label}. The verified nightly group rate is now ${formatCurrency(step.price)} with unchanged stay details.`,
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
    const nightlyById = new Map(research.providers.map((provider) => [provider.id, provider.nightly]));
    setCalls(research.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      rating: provider.rating,
      reviews: provider.reviews,
      deductible: provider.roomType ?? 500,
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
        if (next?.callStatus === "completed") { setCallContext(null); setStep("result"); return; }
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

  const currentStepIndex = STEP_META[step].index;
  const completedNav = useMemo(() => new Set(NAV_ITEMS.filter((item) => STEP_META[item.id].index < currentStepIndex).map((item) => item.id)), [currentStepIndex]);

  function getNavState(item) {
    const itemIndex = STEP_META[item.id].index;
    if (item.id === step) return { key: "current", label: (step === "calling" && callsComplete) || step === "result" ? "Complete" : "In progress" };
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
      const rec = items.find((item) => item.recommended) ?? items[0];
      if (rec?.annual) setTarget(String(Math.max(0, Math.round((rec.annual - 40) / 10) * 10)));
    } catch (cause) {
      setError(cause.message || "Research failed");
      setStep("vehicle");
    } finally {
      setBusy(false);
    }
  }

  async function startNegotiation() {
    setError(null);
    if (!selectedHotels.has(selectedProvider)) {
      setError("Select at least one hotel to negotiate with.");
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

  async function handleCallEnded(conversationId) {
    if (!conversationId) {
      // Declined before connecting — return to the quotes step.
      setCallContext(null);
      setNegotiation(null);
      setStep("quotes");
      return;
    }
    // IosCallView already posts the transcript to /complete; refresh snapshot so
    // the poller (or this path) can advance to the result screen.
    try {
      const res = await api.pollNegotiation();
      if (res.snapshot.negotiation) setNegotiation(res.snapshot.negotiation);
      if (res.snapshot.negotiation?.callStatus === "completed") {
        setCallContext(null);
        setStep("result");
      }
    } catch {
      // The poll effect keeps retrying.
    }
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
              const active = item.id === step;
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
          <div className="mobile-demo-bar"><div className="brand-lockup brand-lockup--dark"><span className="brand-mark" aria-hidden="true" /><span>StayScout</span></div><span>Step {currentStepIndex} / 5</span></div>
          <div className="demo-topbar"><div className="topbar-breadcrumb"><span>Group bookings</span><ArrowRight size={12} /><strong>Request STAY-8K42</strong></div><div className="global-verification"><SealCheck size={16} weight="fill" /><span><strong>{account ? "Request verified" : "Sign up to begin"}</strong><small>{account ? "12 facts · 2 sources" : "No account yet"}</small></span></div></div>
          <div className="demo-content">
            <StepHeader step={step} />
            <div className="sr-only" aria-live="polite">Step {currentStepIndex} of 5. {STEP_META[step].title}</div>
            <AnimatePresence mode="wait">
              {!account && <SignupGate key="gate" onRequireSignup={onRequireSignup} />}
              {account && step === "vehicle" && <VehicleView key="vehicle" profile={profile} setProfile={setProfile} bodyType={bodyType} setBodyType={setBodyType} driverName={driverName} onStart={startResearch} busy={busy} error={error} />}
              {account && step === "calling" && <CallingView key="calling" calls={calls} complete={callsComplete} live={research?.live ?? false} locationLabel={profile.location || profile.make || "Destination"} onContinue={() => setStep("quotes")} />}
              {account && step === "quotes" && <QuotesView key="quotes" quotes={quotes} recommendedId={recommendedId} selectedHotels={selectedHotels} setSelectedHotels={setSelectedHotels} selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} target={target} setTarget={setTarget} presets={presets} liveAvailable={liveAvailable} onNegotiate={startNegotiation} busy={busy} error={error} />}
              {account && step === "negotiating" && negotiation && (negotiation.mode === "live"
                ? <LiveNegotiationPanel key="live-panel" negotiation={negotiation} />
                : <NegotiatingView key="negotiating" steps={negotiation.steps} priceIndex={priceIndex} target={target} providerName={negotiation.providerName} />)}
              {account && step === "result" && negotiation && <ResultView key="result" negotiation={negotiation} playing={playing} audioProgress={audioProgress} activeClip={activeClip} replayClips={replayClips} onToggleAudio={toggleAudio} onClip={playClip} onRestart={restartDemo} />}
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
