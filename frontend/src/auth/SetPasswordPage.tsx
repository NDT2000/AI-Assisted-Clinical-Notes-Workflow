import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  checkSetupLink,
  setPassword as savePassword,
  type SetupLinkInfo,
} from "./accountApi";
import "./AuthPages.css";
import type { SignInLocationState } from "./SignInPage";

// The same rule as the API's.
export const MIN_PASSWORD_LENGTH = 12;

type LinkState =
  | { status: "checking" }
  | { status: "invalid"; message: string }
  | { status: "valid"; info: SetupLinkInfo };

const NO_TOKEN =
  "This page needs the setup link an administrator gave you.";

function readToken(): string {
  // The token is after "#", which browsers never send to a server.
  const token = decodeURIComponent(window.location.hash.slice(1));

  if (token !== "") {
    // Keep it out of the address bar and the browser history.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }

  return token;
}

export function SetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(readToken);
  const [link, setLink] = useState<LinkState>(() =>
    token === ""
      ? { status: "invalid", message: NO_TOKEN }
      : { status: "checking" },
  );
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (token === "") {
      return;
    }

    let cancelled = false;

    void checkSetupLink(token).then((outcome) => {
      if (!cancelled) {
        setLink(
          outcome.ok
            ? { status: "valid", info: outcome.value }
            : { status: "invalid", message: outcome.message },
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (link.status !== "valid" || isSaving) {
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }

    if (password !== repeat) {
      setError("The two passwords do not match.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const outcome = await savePassword(token, password);

    if (outcome.ok) {
      const state: SignInLocationState = {
        username: link.info.username,
        notice: "Your password is set. Sign in with it.",
      };
      navigate("/sign-in", { replace: true, state });
      return;
    }

    setError(outcome.message);
    setIsSaving(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="set-password-heading">
        <p className="auth-card__eyebrow">Clinical Notes Workspace</p>
        <h1 id="set-password-heading">Choose your password</h1>

        {link.status === "checking" && (
          <p role="status">Checking your setup link…</p>
        )}

        {link.status === "invalid" && (
          <>
            <p className="auth-message auth-message--error" role="alert">
              {link.message}
            </p>
            <Link to="/sign-in">Go to sign in</Link>
          </>
        )}

        {link.status === "valid" && (
          <>
            <p>
              Welcome, <strong>{link.info.displayName}</strong>. You will sign
              in as <strong>{link.info.username}</strong>.
            </p>

            {error !== null && (
              <p className="auth-message auth-message--error" role="alert">
                {error}
              </p>
            )}

            <form onSubmit={(event) => void handleSubmit(event)} noValidate>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={link.info.username}
                readOnly
                hidden
              />

              <div className="auth-field">
                <label htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  aria-describedby="new-password-hint"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <small id="new-password-hint">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </small>
              </div>

              <div className="auth-field">
                <label htmlFor="repeat-password">Repeat the password</label>
                <input
                  id="repeat-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={isSaving || password === "" || repeat === ""}
              >
                {isSaving ? "Saving…" : "Set password"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
