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
  WarningCircle,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { HOTELS, PRICE_STEPS, REPLAY_CLIPS, TRANSCRIPT } from "./data.js";
import { Waveform } from "./Waveform.jsx";

const STEP_META = {
  vehicle: { index: 1, label: "Stay profile", title: "Set up your group stay", description: "Confirm the details hotels need to return comparable group rates." },
  calling: { index: 2, label: "Top 5 hotels", title: "StayScout is researching the market", description: "Every hotel receives the same verified group-stay request." },
  quotes: { index: 3, label: "Compare", title: "Five group rates, normalized", description: "Choose an offer and set the private target for the negotiation." },
  negotiating: { index: 4, label: "Negotiate", title: "Negotiator is working the selected hotel", description: "The target stays private while verified concessions are recorded." },
  result: { index: 5, label: "Final result", title: "A better group rate, with the proof", description: "Review the outcome, unchanged stay details, full call, and decisive moments." },
};

const NAV_ITEMS = [
  { id: "vehicle", label: "Stay profile", icon: Bed },
  { id: "calling", label: "Top 5 hotels", icon: MagnifyingGlass },
  { id: "quotes", label: "Quotes", icon: ListChecks },
  { id: "negotiating", label: "Negotiation", icon: PhoneCall },
  { id: "result", label: "Evidence & calls", icon: FileText },
];

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCurrency(value) {
  return CURRENCY.format(Number(value));
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
      <div className="step-context" aria-label="Policy context">
        <span>Case PS-AUTO-7F31</span>
        <small>Last updated 2 min ago</small>
      </div>
    </header>
  );
}

function VehicleView({ profile, setProfile, onStart }) {
  const [roomType, setRoomType] = useState("Deluxe");

  function updateField(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
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
          <div className="sheet-head-actions"><div className="readiness-summary"><strong>12 / 12</strong><span>required facts ready</span></div><button className="primary-button" type="submit">Start research <ArrowRight size={16} weight="bold" /></button></div>
        </div>

        <div className="call-sheet-section">
          <div className="sheet-section-title"><span>01</span><div><strong>Hotel &amp; room preferences</strong><small>Required for availability and group pricing</small></div></div>
          <div className="body-type-row">
            <span><strong>Room type</strong><SourceLabel type="user">Group confirmed</SourceLabel></span>
            <div className="body-type-control" aria-label="Preferred room type">
              {['Standard', 'Deluxe', 'Ultra deluxe'].map((type) => (
                <button className={roomType === type ? "segment segment--active" : "segment"} type="button" key={type} aria-pressed={roomType === type} onClick={() => setRoomType(type)}>
                  <Bed size={17} weight={roomType === type ? "fill" : "regular"} /> {type}
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
            <div><span>Group organizer</span><strong>Alex Morgan</strong><SourceLabel type="user">Group confirmed</SourceLabel></div>
            <div><span>Guest total</span><strong>48 guests</strong><SourceLabel type="required">Sales required</SourceLabel></div>
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
          <p>{roomType} rooms · Group booking · 3 nights</p>
          <dl>
            <div><dt>Dates</dt><dd>{profile.dates}</dd></div>
            <div><dt>Rooms</dt><dd>{profile.rooms} requested</dd></div>
            <div><dt>Guests</dt><dd>48 total</dd></div>
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

function CallingView({ calls, complete, onContinue }) {
  const completedCount = calls.filter((call) => call.status === "Verified").length;
  const progress = (completedCount / calls.length) * 100;

  return (
    <motion.div className="calling-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="call-board" aria-live="polite" aria-busy={!complete}>
        <div className="call-board-head">
          <div><span className="section-kicker">Hotel research &amp; sales outreach</span><h3>{complete ? "All five group rates received" : `${completedCount} of 5 group rates verified`}</h3><p>Ranked hotels are contacted with the same group-stay request and inclusion baseline.</p></div>
          <span className="live-indicator"><span /> {complete ? "Complete" : "Agent active"}</span>
        </div>
        <div className="progress-track" aria-hidden="true"><motion.span initial={false} animate={{ scaleX: progress / 100 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} /></div>

        <div className="call-list">
          <div className="call-table-head"><span>#</span><span>Provider</span><span>Rating evidence</span><span>Eligibility</span><span>Call state</span><span>Quote</span></div>
          {calls.map((call, index) => (
            <article className={call.status === "Calling" ? "call-row call-row--active" : "call-row"} key={call.id}>
              <span className="call-order">0{index + 1}</span>
              <div className="call-provider"><span className="provider-monogram">{call.name.slice(0, 1)}</span><span><strong>{call.name}</strong><small>Chicago · 4–5 star hotel</small></span></div>
              <div className="rating-source"><strong><Star size={13} weight="fill" /> {call.rating}</strong><SourceLabel type="declaration">Demo rating index</SourceLabel></div>
              <div className="eligibility-state"><Check size={13} weight="bold" /><span><strong>Downtown Chicago</strong><small>Eligible</small></span></div>
              <div className="call-state-cell"><CallAudioPlayer src={CALL_AUDIO[index] ?? null} label={call.name} /><StatusBadge status={call.status} /></div>
              <span className="call-price">{call.status === "Verified" ? <><strong>{formatCurrency(call.nightly)}</strong><small>per room / night</small></> : call.status === "Calling" ? <><span className="pending-line" /><small>Collecting rate…</small></> : <><span className="pending-line pending-line--muted" /><small>Waiting for call</small></>}</span>
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
        <h3>Why these five</h3>
        <p>Five hotels passed location, group capacity, and stay-fit checks before outreach started.</p>
        <ol>
          <li><span className="evidence-index">01</span><span><strong>Rating model</strong>Score, review volume, and complaint signal.</span><SourceLabel type="declaration">Recorded</SourceLabel></li>
          <li><span className="evidence-index">02</span><span><strong>Stay eligibility</strong>Chicago location, dates, and group capacity fit.</span><SourceLabel type="user">Matched</SourceLabel></li>
          <li><span className="evidence-index">03</span><span><strong>Rate evidence</strong>Transcript timestamps and normalized stay terms.</span><SourceLabel type={complete ? "user" : "required"}>{complete ? "Complete" : "Collecting"}</SourceLabel></li>
        </ol>
        <div className="evidence-policy-note"><FileText size={16} /><span><strong>Evidence standard</strong>No hotel can rank first until rate, room type, and inclusions are transcript-backed.</span></div>
      </aside>
    </motion.div>
  );
}

function QuotesView({ selectedProvider, setSelectedProvider, target, setTarget, onNegotiate }) {
  const selectedQuote = HOTELS.find((hotel) => hotel.id === selectedProvider);

  return (
    <motion.div className="quotes-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <section className="quote-comparison">
        <div className="comparison-head">
          <div><span className="section-kicker">Normalized group-rate ledger</span><h3>Choose the hotel you want to negotiate</h3><p>Nightly rates use the same dates, room count, and stay baseline.</p></div>
          <details className="evidence-drawer">
            <summary><FileText size={15} /> Evidence index <span>20</span></summary>
            <div><strong>Rate evidence</strong><p>Five call transcripts, five stay-equivalency checks, five rate confirmations, and five rating records.</p></div>
          </details>
        </div>
        <div className="recommendation-strip"><span><SealCheck size={16} weight="fill" /></span><div><strong>System recommendation</strong><p>Lakeside Grand has the strongest verified value: lowest matched rate, deluxe rooms, and complete call evidence.</p></div><small>Recommendation only · you decide</small></div>
        <div className="quote-table" role="radiogroup" aria-label="Hotel group rates">
          <div className="quote-table-head"><span>Hotel</span><span>Stay match</span><span>Nightly rate</span><span>Room type</span><span>Evidence</span><span>Select</span></div>
          {HOTELS.map((hotel) => {
            const selected = selectedProvider === hotel.id;
            return (
              <label className={selected ? "quote-row quote-row--selected" : "quote-row"} key={hotel.id}>
                <span className="quote-provider"><span className="provider-monogram">{hotel.name.slice(0, 1)}</span><span><strong>{hotel.name}</strong><small><Star size={12} weight="fill" /> {hotel.rating} · {hotel.reviews} reviews</small></span>{hotel.recommended && <em>Recommended</em>}</span>
                <span className="coverage-match"><strong><Check size={13} weight="bold" /> Exact match</strong><small>24 rooms · 3 nights · breakfast</small></span>
                <span className="quote-amount"><strong>{formatCurrency(hotel.nightly)}</strong><small>per room / night</small></span>
                <span className="deductible-cell"><strong>{hotel.roomType}</strong><small>room category</small></span>
                <span className="quote-evidence"><StatusBadge status={hotel.confidence} /><small>4 call facts</small></span>
                <span className="radio-wrap"><input type="radio" name="hotel" value={hotel.id} checked={selected} onChange={() => setSelectedProvider(hotel.id)} /><i /></span>
              </label>
            );
          })}
        </div>
      </section>

      <aside className="target-panel">
        <div className="target-panel-head"><Target size={20} weight="fill" /><span><p className="section-kicker">Private negotiation goal</p><h3>Set your target</h3></span></div>
        <div className="selection-context"><span>Your selection</span><strong>{selectedQuote?.name}</strong><small>{formatCurrency(selectedQuote?.nightly)} per room / night</small></div>
        <p>StayScout will ask for this outcome without disclosing your ceiling.</p>
        <label className="target-input"><span>$</span><input name="targetNightlyRate" aria-label="Target nightly room rate" value={target} onChange={(event) => setTarget(event.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="off" /><small>/ night</small></label>
        <div className="range-presets">
          {[205, 215, 225].map((amount) => <button className={Number(target) === amount ? "preset preset--active" : "preset"} type="button" key={amount} onClick={() => setTarget(String(amount))}>${amount}</button>)}
        </div>
        <div className="privacy-confirm"><SourceLabel type="hidden">Hidden from hotel</SourceLabel><span>Only the negotiator uses this threshold.</span></div>
        <button className="primary-button primary-button--wide" type="button" onClick={onNegotiate}>Negotiate selected rate <PhoneCall size={17} weight="fill" /></button>
      </aside>
    </motion.div>
  );
}

function NegotiatingView({ priceIndex, target }) {
  const current = PRICE_STEPS[priceIndex];
  const progress = ((priceIndex + 1) / PRICE_STEPS.length) * 100;

  return (
    <motion.div className="negotiating-view" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} aria-live="polite">
      <section className="command-panel" aria-label="Live negotiation command center">
        <header className="command-head">
          <div><span className="live-indicator live-indicator--dark"><span /> Live negotiation</span><h3>Lakeside Grand Chicago</h3></div>
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
          {PRICE_STEPS.slice(1).map((step, index) => (
            <li className={priceIndex > index ? "concession concession--reached" : "concession"} key={step.time}>
              <span>{priceIndex > index ? <Check size={14} weight="bold" /> : index + 1}</span>
              <div><small>{step.time}</small><strong>{step.label}</strong></div>
              <em>{priceIndex > index ? `${formatCurrency(step.impact)}/night` : "Pending"}</em>
            </li>
          ))}
        </ol>
        <div className="privacy-confirm privacy-confirm--dark"><LockKey size={17} weight="fill" /><span><strong>Private target protected</strong>The hotel never sees your ceiling.</span></div>
      </aside>
    </motion.div>
  );
}

function ResultView({ target, playing, audioProgress, activeClip, onToggleAudio, onClip, onRestart }) {
  return (
    <motion.div className="result-layout" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <div className="result-main">
        <section className="outcome-summary" aria-label="Negotiation outcome">
          <div className="outcome-column"><span>Original group rate</span><strong className="old-price">{formatCurrency(248)}</strong><small>Lakeside Grand · per room / night</small></div>
          <ArrowRight className="outcome-arrow" size={26} weight="bold" />
          <div className="outcome-column outcome-column--final"><span>Final negotiated rate</span><strong>{formatCurrency(208)}</strong><small>Transcript evidence · 06:11</small></div>
          <div className="savings-column"><span>Group stay savings</span><strong>{formatCurrency(2_880)}</strong><em>16.1%</em><small><CheckCircle size={14} weight="fill" /> Target under {formatCurrency(target)} achieved</small></div>
        </section>

        <section className="concession-trail">
          <div className="section-title-row"><div><span className="section-kicker">Before and after</span><h3>Concession trail</h3></div><SourceLabel type="declaration">Transcript-backed</SourceLabel></div>
          <div className="price-timeline">
            {PRICE_STEPS.map((step, index) => (
              <div className={index === PRICE_STEPS.length - 1 ? "timeline-stop timeline-stop--final" : "timeline-stop"} key={step.time}>
                <div className="timeline-meta"><span>{index === 0 ? "Original" : index === PRICE_STEPS.length - 1 ? "Final" : `Counter ${index}`}</span><time>{step.time}</time></div>
                <strong>{formatCurrency(step.price)}</strong>
                <span className="timeline-action">{step.label}</span>
                <small className="timeline-impact">{step.impact ? `${formatCurrency(step.impact)} / room / night` : "Baseline recorded"}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="coverage-proof" id="evidence">
          <div className="section-title-row"><div><span className="section-kicker">Stay details and evidence</span><h3>Rate changed. Your stay did not.</h3></div><span className="coverage-status"><ShieldCheck size={16} weight="fill" /> Stay details unchanged</span></div>
          <div className="coverage-table">
            <div className="coverage-row coverage-row--head"><span>Stay detail</span><span>Before</span><span>After</span><span>Status</span></div>
            {[
              ["Room allocation", "24 deluxe rooms", "24 deluxe rooms"],
              ["Meals", "Breakfast included", "Breakfast included"],
              ["Facilities", "Pool & gym access", "Pool & gym access"],
              ["Cancellation", "14-day flexible", "14-day flexible"],
            ].map((row) => <div className="coverage-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><span><SealCheck size={14} weight="fill" /> Verified</span></div>)}
          </div>
        </section>

        <section className="selection-proof">
          <div><span>Your selection</span><strong>Lakeside Grand · {formatCurrency(208)}/room/night</strong><small><CheckCircle size={14} weight="fill" /> Selected by you</small></div>
          <div><span>StayScout recommendation</span><strong>Lakeside Grand · Best overall value</strong><small><SealCheck size={14} weight="fill" /> Recommendation matched</small></div>
          <button className="secondary-button" type="button" onClick={onRestart}><ArrowCounterClockwise size={17} weight="bold" /> Replay demo</button>
        </section>
      </div>

      <aside className="voice-proof">
        <header><div className="voice-title"><span className="voice-shield"><ShieldCheck size={21} weight="fill" /></span><div><strong>StayScout Negotiator</strong><small>Call evidence · STAY-CALL-0198</small></div></div><span className="voice-call-state"><CheckCircle size={13} weight="fill" /> Complete</span></header>
        <div className="audio-player">
          <div className="audio-label"><span>Full negotiation audio</span><small>06:42</small></div>
          <Waveform active={playing} progress={audioProgress} />
          <div className="audio-controls">
            <button type="button" onClick={onToggleAudio} aria-label={playing ? "Pause negotiation audio" : "Play negotiation audio"}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button>
            <div className="audio-progress"><span style={{ transform: `scaleX(${audioProgress})` }} /><i style={{ left: `${audioProgress * 100}%` }} /></div>
            <span>{String(Math.floor(audioProgress * 6)).padStart(2, "0")}:{String(Math.floor((audioProgress * 402) % 60)).padStart(2, "0")}</span>
          </div>
        </div>

        <div className="transcript-panel">
          <div className="voice-section-title"><span>Transcript excerpt</span><small><FileText size={13} weight="fill" /> Synchronized</small></div>
          {TRANSCRIPT.map((line) => <p key={line.time}><time>{line.time}</time><span><strong>{line.speaker}:</strong> {line.text}</span></p>)}
        </div>

        <div className="replay-panel">
          <div className="voice-section-title"><span>Good negotiation replay</span><small>Key moments that moved the price</small></div>
          {REPLAY_CLIPS.map((clip) => (
            <button className={activeClip === clip.id ? "replay-clip replay-clip--active" : "replay-clip"} type="button" key={clip.id} onClick={() => onClip(clip)}>
              <span className="replay-play"><Play size={15} weight="fill" /></span>
              <time>{clip.time}</time>
              <span><strong>{clip.title}</strong><small>{clip.detail}</small></span>
              <em>{clip.impact}/yr</em>
            </button>
          ))}
        </div>

        <div className="voice-privacy"><LockKey size={19} weight="fill" /><span><strong>Private target protected</strong>Your target stayed private throughout the call.</span></div>
      </aside>
    </motion.div>
  );
}

export const ProductDemo = forwardRef(function ProductDemo(_, ref) {
  const [step, setStep] = useState("vehicle");
  const [profile, setProfile] = useState({ stars: "4–5 stars", location: "Downtown Chicago", dates: "Oct 14–17, 2026", rooms: "24", guests: "2", budget: "$200–$260" });
  const [calls, setCalls] = useState(() => HOTELS.map((hotel) => ({ ...hotel, status: "Queued" })));
  const [callsComplete, setCallsComplete] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("lakeside-grand");
  const [target, setTarget] = useState("215");
  const [priceIndex, setPriceIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0.62);
  const [activeClip, setActiveClip] = useState(null);
  const audioTimerRef = useRef(null);

  useEffect(() => {
    if (step !== "calling") return undefined;

    setCallsComplete(false);
    setCalls(HOTELS.map((hotel) => ({ ...hotel, status: "Queued" })));
    const timers = [];

    HOTELS.forEach((hotel, index) => {
      timers.push(window.setTimeout(() => {
        setCalls((current) => current.map((call, callIndex) => callIndex === index ? { ...call, status: "Calling" } : call));
      }, index * 680));
      timers.push(window.setTimeout(() => {
        setCalls((current) => current.map((call, callIndex) => callIndex === index ? { ...call, status: "Verified" } : call));
      }, index * 680 + 560));
    });

    timers.push(window.setTimeout(() => setCallsComplete(true), HOTELS.length * 680 + 300));
    return () => timers.forEach(window.clearTimeout);
  }, [step]);

  useEffect(() => {
    if (step !== "negotiating") return undefined;
    setPriceIndex(0);
    const timers = [
      window.setTimeout(() => setPriceIndex(1), 900),
      window.setTimeout(() => setPriceIndex(2), 2100),
      window.setTimeout(() => setPriceIndex(3), 3400),
      window.setTimeout(() => setStep("result"), 4800),
    ];
    return () => timers.forEach(window.clearTimeout);
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

  function startCalls(event) {
    event.preventDefault();
    setStep("calling");
  }

  function startNegotiation() {
    setStep("negotiating");
  }

  function stopAudio() {
    window.clearInterval(audioTimerRef.current);
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }

  function toggleAudio() {
    if (playing) {
      stopAudio();
      return;
    }

    setActiveClip(null);
    setPlaying(true);
    setAudioProgress(0);
    const spokenText = TRANSCRIPT.map((line) => `${line.speaker}. ${line.text}`).join(" ");
    if (window.speechSynthesis) {
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
    setAudioProgress(clip.seconds / 402);
    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(clip.speech);
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    }
  }

  function restartDemo() {
    stopAudio();
    setStep("vehicle");
    setCallsComplete(false);
    setPriceIndex(0);
    setAudioProgress(0.62);
    setActiveClip(null);
    window.setTimeout(() => ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  return (
    <section className="demo-section" id="demo" ref={ref} aria-label="Interactive StayScout demo">
      <div className="demo-app">
        <aside className="demo-sidebar">
          <div className="brand-lockup brand-lockup--dark"><span className="brand-mark" aria-hidden="true" /><span>StayScout<small>Group booking operations</small></span></div>
          <div className="sidebar-case"><span>Active group stay</span><strong>Chicago leadership retreat</strong><small>Request STAY-8K42</small></div>
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
          <div className="sidebar-user"><span>AM</span><div><strong>Alex Morgan</strong><small>Group organizer</small></div></div>
          <div className="simulated-note"><WarningCircle size={15} /><span><strong>Demo environment</strong>Hotels and calls are simulated.</span></div>
        </aside>

        <div className="demo-workspace">
          <div className="mobile-demo-bar"><div className="brand-lockup brand-lockup--dark"><span className="brand-mark" aria-hidden="true" /><span>StayScout</span></div><span>Step {currentStepIndex} / 5</span></div>
          <div className="demo-topbar"><div className="topbar-breadcrumb"><span>Group bookings</span><ArrowRight size={12} /><strong>Request STAY-8K42</strong></div><div className="global-verification"><SealCheck size={16} weight="fill" /><span><strong>Request verified</strong><small>12 facts · 2 sources</small></span></div></div>
          <div className="demo-content">
            <StepHeader step={step} />
            <div className="sr-only" aria-live="polite">Step {currentStepIndex} of 5. {STEP_META[step].title}</div>
            <AnimatePresence mode="wait">
              {step === "vehicle" && <VehicleView key="vehicle" profile={profile} setProfile={setProfile} onStart={startCalls} />}
              {step === "calling" && <CallingView key="calling" calls={calls} complete={callsComplete} onContinue={() => setStep("quotes")} />}
              {step === "quotes" && <QuotesView key="quotes" selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider} target={target} setTarget={setTarget} onNegotiate={startNegotiation} />}
              {step === "negotiating" && <NegotiatingView key="negotiating" priceIndex={priceIndex} target={target} />}
              {step === "result" && <ResultView key="result" target={target} playing={playing} audioProgress={audioProgress} activeClip={activeClip} onToggleAudio={toggleAudio} onClip={playClip} onRestart={restartDemo} />}
            </AnimatePresence>
          </div>
          <footer className="demo-footer"><span>Simulated hotels for demonstration purposes only.</span><a href="#evidence">Evidence policy <ArrowUpRight size={13} weight="bold" /></a><span><Headphones size={14} /> Call evidence retained for this session</span></footer>
        </div>
      </div>
    </section>
  );
});
