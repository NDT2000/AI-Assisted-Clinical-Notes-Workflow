import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import "./AuthPages.css";
import { session } from "./session";
import { useSession } from "./useCurrentActor";

export interface SignInLocationState {
  // Where to go after signing in (set by RequireSignIn).
  from?: string;
  // Filled in after choosing a password from a setup link.
  username?: string;
  notice?: string;
}

function safeDestination(from: string | undefined): string {
  // Only paths inside the app, never another site.
  return from !== undefined && from.startsWith("/") && !from.startsWith("//")
    ? from
    : "/notes";
}

export function SignInPage() {
  const state = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = (location.state ?? {}) as SignInLocationState;

  const [username, setUsername] = useState(locationState.username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const destination = safeDestination(locationState.from);

  if (state.status === "signedIn") {
    return <Navigate to={destination} replace />;
  }

  const notice =
    locationState.notice ??
    (state.status === "signedOut" ? state.notice : null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await session.signIn(username.trim(), password);

    if (result.ok) {
      navigate(destination, { replace: true });
      return;
    }

    setPassword("");
    setError(result.message);
    setIsSubmitting(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="sign-in-heading">
        <p className="auth-card__eyebrow">Clinical Notes Workspace</p>
        <h1 id="sign-in-heading">Sign in</h1>

        {notice !== null && error === null && (
          <p className="auth-message" role="status">
            {notice}
          </p>
        )}

        {error !== null && (
          <p className="auth-message auth-message--error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="auth-field">
            <label htmlFor="sign-in-username">Username</label>
            <input
              id="sign-in-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="sign-in-password">Password</label>
            <input
              id="sign-in-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={
              isSubmitting || username.trim() === "" || password === ""
            }
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
