import {
  ArrowDownRight,
  CheckCircle,
  LockKey,
  PhoneCall,
  SealCheck,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Waveform } from "./Waveform.jsx";

const concessions = [
  { time: "00:42", label: "Loyalty credit", price: "$1,546" },
  { time: "01:18", label: "Bundle match", price: "$1,472" },
  { time: "02:06", label: "Final approval", price: "$1,428" },
];

function mixColor(from, to, progress) {
  const amount = Math.min(1, Math.max(0, progress));
  const channels = from.map((value, index) => value + (to[index] - value) * amount);
  return `rgba(${channels[0].toFixed(1)}, ${channels[1].toFixed(1)}, ${channels[2].toFixed(1)}, ${channels[3].toFixed(3)})`;
}

function OutcomeMetrics({ compact = false }) {
  return (
    <div className={compact ? "command-metrics command-metrics--compact" : "command-metrics"}>
      <div className="command-metric command-metric--muted">
        <span>Original quote</span>
        <strong>$1,684</strong>
      </div>
      <div className="command-final-price">
        <span>Negotiated annual premium</span>
        <strong>$1,428</strong>
        <small>$119 / month</small>
      </div>
      <div className="command-metric command-metric--target">
        <span>Private target</span>
        <strong>$1,450</strong>
        <small><CheckCircle size={13} weight="fill" /> Achieved</small>
      </div>
    </div>
  );
}

export function CarCommandCenter({ style }) {
  return (
    <div className="car-command-center" style={style} aria-hidden="true">
      <header className="car-command-head">
        <div>
          <span className="car-command-mark">PS</span>
          <strong>PolicyScout</strong>
        </div>
        <span className="car-command-live"><i /> Negotiation complete</span>
        <LockKey size={14} weight="fill" />
      </header>

      <OutcomeMetrics compact />

      <div className="car-command-lower">
        <div className="car-command-audio">
          <div>
            <PhoneCall size={14} weight="fill" />
            <span>AutoSource · 02:31</span>
          </div>
          <Waveform compact progress={0.82} label="Completed negotiation waveform" />
        </div>
        <div className="car-command-proof">
          <span><ShieldCheck size={14} weight="fill" /> Coverage unchanged</span>
          <span><ArrowDownRight size={14} weight="bold" /> $256 saved · 15.2%</span>
        </div>
      </div>
    </div>
  );
}

export function FullCommandCenter({ contentOpacity = 1, style, themeProgress = 0 }) {
  const contrastProgress = themeProgress < 0.5 ? 0 : 1;
  const theme = {
    "--command-bg": mixColor([8, 17, 15, 1], [243, 245, 246, 1], themeProgress),
    "--command-topbar": mixColor([10, 21, 19, 1], [255, 255, 255, 1], themeProgress),
    "--command-surface": mixColor([13, 26, 23, 1], [255, 255, 255, 1], themeProgress),
    "--command-savings-bg": mixColor([18, 48, 39, 1], [232, 245, 241, 1], themeProgress),
    "--command-evidence-bg": mixColor([5, 11, 10, 1], [255, 255, 255, 1], themeProgress),
    "--command-text": mixColor([237, 247, 243, 1], [20, 32, 30, 1], contrastProgress),
    "--command-heading": mixColor([245, 250, 248, 1], [20, 32, 30, 1], contrastProgress),
    "--command-muted": mixColor([230, 244, 239, 0.58], [77, 91, 88, 0.82], contrastProgress),
    "--command-muted-weak": mixColor([225, 242, 236, 0.5], [103, 115, 111, 1], contrastProgress),
    "--command-line": mixColor([255, 255, 255, 0.1], [216, 223, 220, 1], themeProgress),
    "--command-line-strong": mixColor([113, 224, 193, 0.2], [187, 200, 195, 1], themeProgress),
    "--command-accent": mixColor([125, 226, 196, 1], [8, 123, 112, 1], contrastProgress),
    "--command-price-muted": mixColor([215, 229, 224, 1], [77, 91, 88, 1], contrastProgress),
    "--command-mark-bg": mixColor([9, 28, 25, 0.62], [232, 239, 236, 1], themeProgress),
    "--command-mark-border": mixColor([255, 255, 255, 0.38], [187, 200, 195, 1], themeProgress),
    "--command-wave-muted": mixColor([213, 226, 221, 0.28], [77, 91, 88, 0.28], contrastProgress),
  };

  return (
    <div className="full-command-center" style={{ ...theme, ...style, opacity: contentOpacity }} aria-hidden="true">
      <header className="full-command-topbar">
        <div className="full-command-brand">
          <span className="brand-mark" aria-hidden="true" />
          <div><strong>PolicyScout</strong><small>Auto insurance</small></div>
        </div>
        <div className="full-command-path"><span>Quotes</span><i /> <strong>Negotiation result</strong></div>
        <div className="full-command-verified"><SealCheck size={17} weight="fill" /> Verified evidence</div>
      </header>

      <main className="full-command-main">
        <div className="full-command-title">
          <div>
            <span className="scene-index">Negotiation complete</span>
            <h2>Your target was reached.</h2>
            <p>AutoSource approved a lower premium with the selected coverage unchanged.</p>
          </div>
          <div className="full-command-status"><CheckCircle size={18} weight="fill" /> Target achieved</div>
        </div>

        <section className="full-command-outcome">
          <OutcomeMetrics />
          <div className="full-command-savings">
            <span>Total annual savings</span>
            <strong>$256</strong>
            <small>15.2% below the original quote</small>
          </div>
        </section>

        <section className="full-command-evidence">
          <div className="full-command-call">
            <header>
              <div><PhoneCall size={17} weight="fill" /><span>Negotiation call · AutoSource</span></div>
              <strong>02:31</strong>
            </header>
            <Waveform
              active
              progress={0.82}
              playedColor={theme["--command-accent"]}
              unplayedColor={theme["--command-wave-muted"]}
              label="Negotiation call waveform"
            />
            <footer><LockKey size={14} weight="fill" /> Recording and transcript verified</footer>
          </div>

          <div className="full-command-timeline">
            <header><span>Verified concessions</span><strong>3 price improvements</strong></header>
            {concessions.map((item, index) => (
              <div className="full-command-concession" key={item.time}>
                <span className="concession-index">0{index + 1}</span>
                <time>{item.time}</time>
                <span>{item.label}</span>
                <strong>{item.price}</strong>
              </div>
            ))}
            <footer><ShieldCheck size={15} weight="fill" /> Liability, collision, comprehensive, and roadside limits unchanged.</footer>
          </div>
        </section>
      </main>
    </div>
  );
}
