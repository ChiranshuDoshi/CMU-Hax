"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpinnerGap, X } from "@phosphor-icons/react";
import { CinematicShowcase } from "./CinematicShowcase.jsx";
import { ProductDemo } from "./ProductDemo.jsx";
import { api } from "./api.js";

function SignupModal({ open, onClose, onSignedUp }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    try {
      const res = await api.signup(displayName, email);
      onSignedUp(res.account);
    } catch (cause) {
      setError(cause.message || "Could not create your account");
    } finally {
      setBusy(false);
    }
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
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close sign up">
          <X size={20} weight="bold" />
        </button>
        <div className="brand-lockup brand-lockup--dark">
          <span className="brand-mark" aria-hidden="true" />
          <span>PolicyScout</span>
        </div>
        <p className="eyebrow">Create your account</p>
        <h2 id="login-title">Sign up to start negotiating</h2>
        <p className="modal-copy">Create a PolicyScout workspace, then enter your vehicle to run the live demo.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Full name
            <input name="name" type="text" defaultValue="Alex Morgan" autoComplete="name" spellCheck="false" autoFocus required />
          </label>
          <label>
            Email
            <input name="email" type="email" defaultValue="alex@policyscout.demo" autoComplete="email" spellCheck="false" required />
          </label>
          {error && <p className="disclosure" role="alert" style={{ color: "var(--coral)" }}>{error}</p>}
          <button className="primary-button primary-button--wide" type="submit" disabled={busy}>
            {busy ? (<><SpinnerGap className="spin" size={18} weight="bold" /> Creating…</>) : "Create account & open workspace"}
          </button>
        </form>
        <p className="disclosure">A lightweight demo account is created for this browser session. Providers and calls are simulated.</p>
      </section>
    </div>
  );
}

export function App() {
  const demoRef = useRef(null);
  const [signupOpen, setSignupOpen] = useState(false);
  const [account, setAccount] = useState(null);

  // Restore an existing session (cookie) on load.
  useEffect(() => {
    let cancelled = false;
    api
      .workflow()
      .then((data) => {
        if (!cancelled && data?.snapshot?.displayName) {
          setAccount({ displayName: data.snapshot.displayName });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollToDemo = useCallback(() => {
    demoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const openSignup = useCallback(() => setSignupOpen(true), []);

  const handleSignedUp = useCallback(
    (nextAccount) => {
      setAccount(nextAccount);
      setSignupOpen(false);
      window.setTimeout(scrollToDemo, 120);
    },
    [scrollToDemo],
  );

  const handleShowcaseAction = useCallback(() => {
    if (account) {
      scrollToDemo();
    } else {
      setSignupOpen(true);
    }
  }, [account, scrollToDemo]);

  return (
    <div className="app-shell">
      <CinematicShowcase onSkip={handleShowcaseAction} onLogin={openSignup} />
      <ProductDemo ref={demoRef} account={account} onRequireSignup={openSignup} />
      <SignupModal open={signupOpen} onClose={() => setSignupOpen(false)} onSignedUp={handleSignedUp} />
    </div>
  );
}
