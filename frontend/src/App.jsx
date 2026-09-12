import { useCallback, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { CinematicShowcase } from "./CinematicShowcase.jsx";
import { ProductDemo } from "./ProductDemo.jsx";

function LoginModal({ open, onClose, onContinue }) {
  if (!open) return null;

  function handleSubmit(event) {
    event.preventDefault();
    onContinue();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close login">
          <X size={20} weight="bold" />
        </button>
        <div className="brand-lockup brand-lockup--dark">
          <span className="brand-mark" aria-hidden="true" />
          <span>PolicyScout</span>
        </div>
        <p className="eyebrow">Welcome back</p>
        <h2 id="login-title">Continue your negotiation</h2>
        <p className="modal-copy">This prototype opens a simulated PolicyScout workspace.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input name="email" type="email" defaultValue="alex@policyscout.demo" autoComplete="email" spellCheck="false" autoFocus />
          </label>
          <label>
            Password
            <input name="password" type="password" defaultValue="demopassword" autoComplete="current-password" />
          </label>
          <button className="primary-button primary-button--wide" type="submit">
            Open demo workspace
          </button>
        </form>
        <p className="disclosure">No account is created. Demo data stays in this browser session.</p>
      </section>
    </div>
  );
}

export function App() {
  const demoRef = useRef(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const scrollToDemo = useCallback(() => {
    demoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const continueFromLogin = useCallback(() => {
    setLoginOpen(false);
    window.setTimeout(scrollToDemo, 120);
  }, [scrollToDemo]);

  return (
    <div className="app-shell">
      <CinematicShowcase onSkip={scrollToDemo} onLogin={() => setLoginOpen(true)} />
      <ProductDemo ref={demoRef} />
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onContinue={continueFromLogin}
      />
    </div>
  );
}
