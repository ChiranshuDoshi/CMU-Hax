import { CalendarBlank, CheckCircle, MapPin, Users } from "@phosphor-icons/react";
import { BrandMark } from "./BrandMark.jsx";

function mixColor(from, to, progress) {
  const amount = Math.min(1, Math.max(0, progress));
  const channels = from.map((value, index) => value + (to[index] - value) * amount);
  return `rgba(${channels[0].toFixed(1)}, ${channels[1].toFixed(1)}, ${channels[2].toFixed(1)}, ${channels[3].toFixed(3)})`;
}

const rooms = [
  { name: "The Plaza Suite", detail: "King · Fifth Avenue", nights: "3 nights", rate: "$2,180", status: "Held", held: true },
  { name: "Carlyle Residence", detail: "King · park quiet", nights: "3 nights", rate: "$1,640", status: "Open" },
  { name: "Mark Studio", detail: "Queen · evening court", nights: "3 nights", rate: "$1,120", status: "Open" },
];

export function HotelBookingDashboard({ contentOpacity = 1, style, themeProgress = 0 }) {
  const theme = {
    "--command-bg": mixColor([252, 248, 240, 0.96], [255, 255, 255, 0.94], themeProgress),
    "--command-topbar": mixColor([255, 255, 255, 0.42], [255, 255, 255, 0.62], themeProgress),
    "--command-surface": mixColor([255, 255, 255, 0.5], [255, 255, 255, 0.72], themeProgress),
    "--command-savings-bg": mixColor([110, 32, 36, 0.08], [110, 32, 36, 0.06], themeProgress),
    "--command-evidence-bg": mixColor([255, 255, 255, 0.46], [255, 255, 255, 0.7], themeProgress),
    "--command-text": "rgb(28, 22, 18)",
    "--command-heading": "rgb(22, 16, 12)",
    "--command-muted": "rgba(92, 78, 64, 0.88)",
    "--command-muted-weak": "rgb(110, 96, 80)",
    "--command-line": mixColor([40, 28, 20, 0.1], [40, 28, 20, 0.08], themeProgress),
    "--command-line-strong": mixColor([120, 84, 52, 0.18], [120, 84, 52, 0.16], themeProgress),
    "--command-accent": "rgb(110, 28, 32)",
    "--command-price-muted": "rgb(92, 78, 64)",
  };

  return (
    <div className="full-command-center hotel-dashboard hotel-dashboard--glass" style={{ ...theme, ...style, opacity: contentOpacity }} aria-hidden="true">
      <header className="full-command-topbar hotel-glass-bar">
        <div className="full-command-brand">
          <BrandMark />
          <div>
            <strong>Atrium</strong>
            <small>Private arrivals</small>
          </div>
        </div>
        <div className="full-command-path">
          <span>Reception</span>
          <i />
          <strong>Your stay</strong>
        </div>
        <div className="full-command-verified">
          <CheckCircle size={17} weight="fill" /> Suite held
        </div>
      </header>

      <main className="full-command-main hotel-dashboard-main">
        <div className="full-command-title">
          <div>
            <span className="scene-index">Manhattan · Oct 14–17</span>
            <h2>The Plaza Suite is held.</h2>
            <p>Three nights. Two guests. The key is already cut.</p>
          </div>
          <div className="full-command-status">
            <CheckCircle size={18} weight="fill" /> Arrival from 15:00
          </div>
        </div>

        <section className="hotel-search-bar hotel-glass-panel">
          <div>
            <MapPin size={15} weight="fill" />
            <span>Atrium New York</span>
          </div>
          <div>
            <CalendarBlank size={15} weight="fill" />
            <span>Oct 14 — Oct 17</span>
          </div>
          <div>
            <Users size={15} weight="fill" />
            <span>2 guests · 1 residence</span>
          </div>
          <strong>Amend</strong>
        </section>

        <section className="full-command-outcome hotel-stay-outcome hotel-glass-panel">
          <div className="command-metrics">
            <div className="command-metric">
              <span>Nightly</span>
              <strong>$2,180</strong>
            </div>
            <div className="command-final-price">
              <span>The stay</span>
              <strong>$6,540</strong>
              <small>3 nights · breakfast in apartment</small>
            </div>
            <div className="command-metric command-metric--target">
              <span>Hold until</span>
              <strong>18:00</strong>
              <small>
                <CheckCircle size={13} weight="fill" /> Confirmed
              </small>
            </div>
          </div>
          <div className="full-command-savings">
            <span>Private rate</span>
            <strong>−$420</strong>
            <small>Beneath the published tariff</small>
          </div>
        </section>

        <section className="hotel-room-ledger hotel-glass-panel">
          <header>
            <span>Residences</span>
            <strong>3 held for these dates</strong>
          </header>
          {rooms.map((room) => (
            <div className={`hotel-room-row${room.held ? " hotel-room-row--held" : ""}`} key={room.name}>
              <strong>{room.name}</strong>
              <span>{room.detail}</span>
              <span>{room.nights}</span>
              <b>{room.rate}</b>
              <em>{room.status}</em>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
